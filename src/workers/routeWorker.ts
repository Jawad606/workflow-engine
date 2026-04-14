import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { workflowQueue } from '../core/queue.js';
import { appendGovernanceLog } from '../services/governanceLogService.js';

/**
 * Route Worker
 * 
 * Responsible for:
 * 1. Validating workflow is in INITIATED state
 * 2. Executing routing logic (classify workflow type)
 *3. Transitioning to ROUTING state
 * 4. Recording state transition in governance log
 * 5. Enqueueing decision job
 */
export async function processRoute(
  job: Job<{
    workflowId: string;
    traceId: string;
  }>
) {
  const { workflowId, traceId } = job.data;
  const prisma = new PrismaClient();

  try {
    const updatedRecord = await prisma.$transaction(async (tx) => {
      const workflow = await tx.workflowRecord.findUnique({
        where: { id: workflowId }
      });

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`);
      }

      if (workflow.status === 'ROUTING' || workflow.status === 'DECISION_PENDING' || workflow.status === 'ACTION_QUEUED' || workflow.status === 'COMPLETED') {
        return workflow;
      }

      if (workflow.status !== 'INITIATED') {
        throw new Error(`Invalid state transition: ${workflow.status} -> ROUTING`);
      }

      const contextData = asObject(workflow.contextData);
      const inputData = asObject(contextData.input);
      const routingDecision = classifyWorkflow(inputData);

      const updatedContext = {
        ...contextData,
        pathway_selected: routingDecision.recommended_pathway,
        routingDecision
      };

      const updated = await tx.workflowRecord.update({
        where: { id: workflowId },
        data: {
          status: 'ROUTING',
          recommendedPathway: routingDecision.recommended_pathway,
          contextData: updatedContext as never
        }
      });

      await appendGovernanceLog({
        prisma: tx,
        workflowId,
        traceId,
        fromState: 'INITIATED',
        toState: 'ROUTING',
        actor: 'route_worker',
        narrative: routingDecision.narrative,
        payloadSnapshot: {
          routingDecision,
          input: inputData
        }
      });

      return updated;
    });

    if (updatedRecord.status === 'ROUTING') {
      await workflowQueue.add('decision', {
        workflowId,
        traceId,
      });
    }

    console.log(
      `[ROUTE WORKER] Successfully processed ${workflowId}, decision job enqueued`
    );

    return {
      success: true,
      workflowId,
      newStatus: updatedRecord.status,
    };
  } catch (error) {
    console.error(`[ROUTE WORKER] Error processing ${workflowId}:`, error);

    try {
      const prismaError = new PrismaClient();
      await prismaError.$transaction(async (tx) => {
        const workflow = await tx.workflowRecord.findUnique({
          where: { id: workflowId }
        });

        if (workflow && workflow.status !== 'FAILED') {
          await tx.workflowRecord.update({
            where: { id: workflowId },
            data: { status: 'FAILED' }
          });

          await appendGovernanceLog({
            prisma: tx,
            workflowId,
            traceId,
            fromState: workflow.status,
            toState: 'FAILED',
            actor: 'route_worker',
            narrative: `Routing failed due to an unexpected error: ${(error as Error).message}`,
            payloadSnapshot: {
              error: (error as Error).message,
            }
          });
        }
      });
      prismaError.$disconnect();
    } catch (logError) {
      console.error(`[ROUTE WORKER] Failed to log error state:`, logError);
    }

    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Assign clinical pathway based on symptom and red-flag intake data.
 */
function classifyWorkflow(input: Record<string, unknown>): {
  recommended_pathway: 'MSK' | 'EMERGENCY' | 'GENERAL';
  confidence: 'high' | 'medium';
  rule_matched: 'musculoskeletal_symptoms_no_red_flags' | 'red_flag_detected' | 'default_general_pathway';
  override: null;
  narrative: string;
} {
  const symptom = String(input.symptom ?? '').toLowerCase();
  const redFlags = Boolean(input.red_flags);

  if (redFlags) {
    return {
      recommended_pathway: 'EMERGENCY',
      confidence: 'high',
      rule_matched: 'red_flag_detected',
      override: null,
      narrative: 'Red flags detected in intake. Patient routed to Emergency Pathway for immediate escalation.'
    };
  }

  const mskTerms = ['back pain', 'spine', 'neck pain', 'joint pain'];
  const hasMskSymptoms = mskTerms.some((term) => symptom.includes(term));

  if (hasMskSymptoms) {
    return {
      recommended_pathway: 'MSK',
      confidence: 'high',
      rule_matched: 'musculoskeletal_symptoms_no_red_flags',
      override: null,
      narrative: 'Symptoms matched MSK Pathway criteria. No red flags detected. Patient assigned to MSK Spine Pathway automatically.'
    };
  }

  return {
    recommended_pathway: 'GENERAL',
    confidence: 'medium',
    rule_matched: 'default_general_pathway',
    override: null,
    narrative: 'Symptoms did not match MSK-specific routing rules. Patient assigned to General Care Pathway.'
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}
