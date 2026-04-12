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
    console.log(
      `[DECISION WORKER] Processing workflow: ${workflowId} (trace: ${traceId})`
    );

    // Lock row using transaction
    const updatedRecord = await prisma.$transaction(async (tx: any) => {
      // Fetch current workflow
      const workflow = await tx.workflowRecord.findUnique({
        where: { id: workflowId },
      });

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`);
      }

      // Validate state transition
      if (workflow.status !== 'ROUTING') {
        throw new Error(
          `Invalid state transition: ${workflow.status} → DECISION_PENDING (expected ROUTING)`
        );
      }

      console.log(
        `[DECISION WORKER] Workflow ${workflowId} is in ROUTING state, proceeding with decision`
      );

      // Execute decision logic
      const decisionResult = evaluateWorkflow(workflow.contextData);

      console.log(
        `[DECISION WORKER] Decision for ${workflowId}: ${decisionResult.decision}`
      );

      // Update workflow status to DECISION_PENDING and append decision result
      const updated = await tx.workflowRecord.update({
        where: { id: workflowId },
        data: {
          status: 'DECISION_PENDING',
          contextData: {
            ...workflow.contextData,
            decisionResult,
          },
        },
      });

      // Create governance log entry
      await appendGovernanceLog({
        prisma: tx,
        workflowId,
        traceId,
        fromState: 'ROUTING',
        toState: 'DECISION_PENDING',
        actor: 'decision_worker',
        payloadSnapshot: updated.contextData,
      });

      console.log(
        `[DECISION WORKER] Governance log created: ROUTING → DECISION_PENDING for ${workflowId}`
      );

      return updated;
    });

    // Enqueue next job (action worker)
    await workflowQueue.add('action', {
      workflowId,
      traceId,
    });

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

    // Update workflow to FAILED state on error
    try {
      const prismaError = new PrismaClient();
      await prismaError.$transaction(async (tx: any) => {
        const workflow = await tx.workflowRecord.findUnique({
          where: { id: workflowId },
        });

        if (workflow && workflow.status !== 'FAILED') {
          await tx.workflowRecord.update({
            where: { id: workflowId },
            data: { status: 'FAILED' },
          });

          await appendGovernanceLog({
            prisma: tx,
            workflowId,
            traceId,
            fromState: workflow.status as any,
            toState: 'FAILED',
            actor: 'decision_worker',
            payloadSnapshot: {
              error: (error as Error).message,
            },
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
 * Evaluate workflow conditions based on route classification
 * This is the business logic for the decision stage
 */
function evaluateWorkflow(context: any): {
  decision: string;
  approved: boolean;
  riskLevel: string;
  reason?: string;
} {
  const routing = context.routingDecision;

  // Decision logic based on route type
  switch (routing?.route) {
    case 'PAYMENT_PROCESSING':
      return evaluatePayment(context.input, routing);

    case 'ORDER_FULFILLMENT':
      return evaluateOrder(context.input, routing);

    default:
      return {
        decision: 'APPROVE',
        approved: true,
        riskLevel: 'LOW',
        reason: 'Default approval for generic workflow',
      };
  }
}

/**
 * Evaluate payment workflow
 */
function evaluatePayment(input: any, routing: any): {
  decision: string;
  approved: boolean;
  riskLevel: string;
  reason?: string;
} {
  const amount = input.paymentAmount;
  let riskLevel = 'LOW';
  let approved = true;
  let reason = '';

  // Risk assessment
  if (amount > 10000) {
    riskLevel = 'HIGH';
    approved = false; // Requires manual review
    reason = `High-value payment ($${amount}) requires manual review`;
  } else if (amount > 5000) {
    riskLevel = 'MEDIUM';
    approved = true;
    reason = `Medium-risk payment ($${amount}), auto-approved with monitoring`;
  } else {
    riskLevel = 'LOW';
    approved = true;
    reason = `Low-risk payment ($${amount}), standard processing`;
  }

  return {
    decision: approved ? 'APPROVE' : 'MANUAL_REVIEW',
    approved,
    riskLevel,
    reason,
  };
}

/**
 * Evaluate order workflow
 */
function evaluateOrder(input: any, routing: any): {
  decision: string;
  approved: boolean;
  riskLevel: string;
  reason?: string;
} {
  const itemCount = input.items?.length || 0;
  const isExpedited = input.expedited === true;
  let riskLevel = 'LOW';
  let approved = true;
  let reason = '';

  // Availability check (simulated)
  if (isExpedited && itemCount > 10) {
    riskLevel = 'HIGH';
    approved = false;
    reason = 'Cannot fulfill expedited order with >10 items';
  } else if (itemCount > 50) {
    riskLevel = 'MEDIUM';
    approved = true;
    reason = `Bulk order (${itemCount} items) requires warehouse coordination`;
  } else {
    riskLevel = 'LOW';
    approved = true;
    reason = `Standard order (${itemCount} items)`;
  }

  return {
    decision: approved ? 'PROCEED' : 'HOLD_REVIEW',
    approved,
    riskLevel,
    reason,
  };
}
