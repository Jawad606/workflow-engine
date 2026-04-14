import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { workflowQueue } from '../core/queue.js';
import { appendGovernanceLog } from '../services/governanceLogService.js';

/**
 * Decision Worker
 * 
 * Responsible for:
 * 1. Validating workflow is in ROUTING state
 * 2. Executing decision logic (evaluate conditions based on routing classification)
 * 3. Transitioning to DECISION_PENDING state
 * 4. Recording state transition in governance log
 * 5. Enqueueing action job
 */
export async function processDecision(
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

      if (workflow.status === 'DECISION_PENDING' || workflow.status === 'ACTION_QUEUED' || workflow.status === 'COMPLETED') {
        return workflow;
      }

      if (workflow.status !== 'ROUTING') {
        throw new Error(`Invalid state transition: ${workflow.status} -> DECISION_PENDING`);
      }

      const contextData = asObject(workflow.contextData);
      const input = asObject(contextData.input);
      const pathway = workflow.recommendedPathway ?? String(contextData.pathway_selected ?? 'GENERAL');
      const decision = evaluateWorkflow(pathway, input);

      const updatedContext = {
        ...contextData,
        decision,
        pathway_selected: pathway
      };

      const updated = await tx.workflowRecord.update({
        where: { id: workflowId },
        data: {
          status: 'DECISION_PENDING',
          recommendedCare: decision.recommended_care,
          contextData: updatedContext as never
        }
      });

      await appendGovernanceLog({
        prisma: tx,
        workflowId,
        traceId,
        fromState: 'ROUTING',
        toState: 'DECISION_PENDING',
        actor: 'decision_worker',
        narrative: decision.narrative,
        payloadSnapshot: {
          decision,
          pathway,
          input
        }
      });

      return updated;
    });

    if (updatedRecord.status === 'DECISION_PENDING') {
      await workflowQueue.add('action', {
        workflowId,
        traceId,
      });
    }

    console.log(
      `[DECISION WORKER] Successfully processed ${workflowId}, action job enqueued`
    );

    return {
      success: true,
      workflowId,
      newStatus: updatedRecord.status,
    };
  } catch (error) {
    console.error(`[DECISION WORKER] Error processing ${workflowId}:`, error);

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
            actor: 'decision_worker',
            narrative: `Decisioning failed due to an unexpected error: ${(error as Error).message}`,
            payloadSnapshot: {
              error: (error as Error).message,
            }
          });
        }
      });
      prismaError.$disconnect();
    } catch (logError) {
      console.error(`[DECISION WORKER] Failed to log error state:`, logError);
    }

    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Evaluate care recommendation for the assigned clinical pathway.
 */
function evaluateWorkflow(pathway: string, input: Record<string, unknown>): {
  recommended_care: 'physical_therapy' | 'specialist_referral' | 'emergency' | 'general_care';
  care_type: 'telehealth' | 'in_person' | null;
  urgency: 'routine' | 'moderate' | 'urgent' | 'immediate';
  conditions_met: string[];
  override: null;
  is_adhered: null;
  narrative: string;
} {
  const painLevel = Number(input.pain_level ?? 0);
  const redFlags = Boolean(input.red_flags);
  const failedPtHistory = Boolean(input.failed_pt_history);

  if (pathway === 'EMERGENCY') {
    return {
      recommended_care: 'emergency',
      care_type: null,
      urgency: 'immediate',
      conditions_met: ['red_flags_detected', 'emergency_pathway'],
      override: null,
      is_adhered: null,
      narrative: 'Emergency pathway selected due to clinical red flags. Immediate emergency care is recommended.'
    };
  }

  if (pathway === 'MSK') {
    if (painLevel <= 4 && !redFlags && !failedPtHistory) {
      return {
        recommended_care: 'physical_therapy',
        care_type: 'telehealth',
        urgency: 'routine',
        conditions_met: ['pain_level <= 4', 'no_red_flags', 'MSK_pathway', 'no_failed_pt_history'],
        override: null,
        is_adhered: null,
        narrative: `PT-first pathway selected. Pain score mild (${painLevel}/10), no red flags, no prior failed PT on record. Telehealth Physical Therapy recommended as first line of care.`
      };
    }

    if (painLevel >= 5 && painLevel <= 7 && !redFlags) {
      return {
        recommended_care: 'physical_therapy',
        care_type: 'in_person',
        urgency: 'moderate',
        conditions_met: ['pain_level_5_to_7', 'no_red_flags', 'MSK_pathway'],
        override: null,
        is_adhered: null,
        narrative: `PT-first pathway selected. Pain score moderate (${painLevel}/10), no red flags. In-person Physical Therapy recommended with moderate urgency.`
      };
    }

    if (painLevel >= 8 || redFlags) {
      return {
        recommended_care: 'specialist_referral',
        care_type: null,
        urgency: 'urgent',
        conditions_met: ['pain_level >= 8_or_red_flags', 'MSK_pathway'],
        override: null,
        is_adhered: null,
        narrative: `High-risk MSK presentation detected (pain ${painLevel}/10 or red flags). Specialist referral recommended with urgent priority.`
      };
    }
  }

  return {
    recommended_care: 'general_care',
    care_type: null,
    urgency: 'routine',
    conditions_met: ['general_pathway_default'],
    override: null,
    is_adhered: null,
    narrative: 'General care recommendation issued because pathway-specific PT-first rules were not met.'
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}
