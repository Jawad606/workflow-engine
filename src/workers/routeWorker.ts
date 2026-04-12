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
    console.log(
      `[ROUTE WORKER] Processing workflow: ${workflowId} (trace: ${traceId})`
    );

    // Lock row using transaction to prevent concurrent updates
    const updatedRecord = await prisma.$transaction(async (tx: any) => {
      // Fetch current workflow
      const workflow = await tx.workflowRecord.findUnique({
        where: { id: workflowId },
      });

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`);
      }

      // Validate state transition
      if (workflow.status !== 'INITIATED') {
        throw new Error(
          `Invalid state transition: ${workflow.status} → ROUTING (expected INITIATED)`
        );
      }

      console.log(
        `[ROUTE WORKER] Workflow ${workflowId} is in INITIATED state, proceeding with routing`
      );

      // Execute routing logic
      const inputData = workflow.contextData.input;
      const routingDecision = classifyWorkflow(inputData);

      console.log(
        `[ROUTE WORKER] Routing decision for ${workflowId}: ${routingDecision.route}`
      );

      // Update workflow status to ROUTING and append routing result
      const updated = await tx.workflowRecord.update({
        where: { id: workflowId },
        data: {
          status: 'ROUTING',
          contextData: {
            ...workflow.contextData,
            routingDecision,
          },
        },
      });

      // Create governance log entry for state transition
      await appendGovernanceLog({
        prisma: tx,
        workflowId,
        traceId,
        fromState: 'INITIATED',
        toState: 'ROUTING',
        actor: 'route_worker',
        payloadSnapshot: updated.contextData,
      });

      console.log(
        `[ROUTE WORKER] Governance log created: INITIATED → ROUTING for ${workflowId}`
      );

      return updated;
    });

    // Enqueue next job (decision worker)
    await workflowQueue.add('decision', {
      workflowId,
      traceId,
    });

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
            actor: 'route_worker',
            payloadSnapshot: {
              error: (error as Error).message,
            },
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
 * Classify workflow type based on input data
 * This is the business logic for the routing stage
 */
function classifyWorkflow(input: any): {
  route: string;
  category: string;
  priority: string;
} {
  // Determine route based on input characteristics
  if (input.paymentAmount !== undefined) {
    // This is a payment workflow
    const amount = input.paymentAmount;
    return {
      route: 'PAYMENT_PROCESSING',
      category: amount > 1000 ? 'HIGH_VALUE' : 'STANDARD',
      priority: amount > 5000 ? 'URGENT' : 'NORMAL',
    };
  }

  if (input.orderId !== undefined) {
    // This is an order workflow
    const itemCount = input.items?.length || 0;
    return {
      route: 'ORDER_FULFILLMENT',
      category: itemCount > 5 ? 'BULK_ORDER' : 'STANDARD_ORDER',
      priority: input.expedited ? 'URGENT' : 'NORMAL',
    };
  }

  // Default route
  return {
    route: 'GENERIC_WORKFLOW',
    category: 'UNKNOWN',
    priority: 'NORMAL',
  };
}
