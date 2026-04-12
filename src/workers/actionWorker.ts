import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { appendGovernanceLog } from '../services/governanceLogService.js';

/**
 * Action Worker
 * 
 * Responsible for:
 * 1. Validating workflow is in DECISION_PENDING state
 * 2. Executing final side effects (trigger external systems, send notifications, etc.)
 * 3. Transitioning to ACTION_QUEUED then COMPLETED state
 * 4. Recording all state transitions in governance log
 * 5. Final workflow completion
 */
export async function processAction(
  job: Job<{
    workflowId: string;
    traceId: string;
  }>
) {
  const { workflowId, traceId } = job.data;
  const prisma = new PrismaClient();

  try {
    console.log(
      `[ACTION WORKER] Processing workflow: ${workflowId} (trace: ${traceId})`
    );

    // First transition: Move to ACTION_QUEUED
    let currentRecord = await prisma.$transaction(async (tx: any) => {
      const workflow = await tx.workflowRecord.findUnique({
        where: { id: workflowId },
      });

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`);
      }

      // Validate state transition
      if (workflow.status !== 'DECISION_PENDING') {
        throw new Error(
          `Invalid state transition: ${workflow.status} → ACTION_QUEUED (expected DECISION_PENDING)`
        );
      }

      console.log(
        `[ACTION WORKER] Workflow ${workflowId} is in DECISION_PENDING state, moving to ACTION_QUEUED`
      );

      // Update to ACTION_QUEUED
      const updated = await tx.workflowRecord.update({
        where: { id: workflowId },
        data: {
          status: 'ACTION_QUEUED',
        },
      });

      // Create governance log entry
      await appendGovernanceLog({
        prisma: tx,
        workflowId,
        traceId,
        fromState: 'DECISION_PENDING',
        toState: 'ACTION_QUEUED',
        actor: 'action_worker',
        payloadSnapshot: updated.contextData,
      });

      console.log(
        `[ACTION WORKER] Governance log created: DECISION_PENDING → ACTION_QUEUED for ${workflowId}`
      );

      return updated;
    });

    // Execute side effects
    console.log(`[ACTION WORKER] Executing side effects for ${workflowId}...`);
    const actionResult = await executeSideEffects(
      workflowId,
      currentRecord.contextData
    );

    console.log(
      `[ACTION WORKER] Side effects completed for ${workflowId}:`,
      actionResult
    );

    // Second transition: Move to COMPLETED
    const finalRecord = await prisma.$transaction(async (tx: any) => {
      const workflow = await tx.workflowRecord.findUnique({
        where: { id: workflowId },
      });

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`);
      }

      const now = new Date();

      // Update to COMPLETED
      const completed = await tx.workflowRecord.update({
        where: { id: workflowId },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          contextData: {
            ...workflow.contextData,
            actionResult,
            completedAt: now.toISOString(),
          },
        },
      });

      // Create final governance log entry
      await appendGovernanceLog({
        prisma: tx,
        workflowId,
        traceId,
        fromState: 'ACTION_QUEUED',
        toState: 'COMPLETED',
        actor: 'action_worker',
        payloadSnapshot: completed.contextData,
      });

      console.log(
        `[ACTION WORKER] Governance log created: ACTION_QUEUED → COMPLETED for ${workflowId}`
      );

      return completed;
    });

    console.log(
      `[ACTION WORKER] Successfully completed workflow ${workflowId}`
    );

    return {
      success: true,
      workflowId,
      finalStatus: finalRecord.status,
      completedAt: finalRecord.completedAt,
    };
  } catch (error) {
    console.error(`[ACTION WORKER] Error processing ${workflowId}:`, error);

    // Update workflow to FAILED state on error
    try {
      const prismaError = new PrismaClient();
      await prismaError.$transaction(async (tx: any) => {
        const workflow = await tx.workflowRecord.findUnique({
          where: { id: workflowId },
        });

        if (workflow && workflow.status !== 'FAILED') {
          const failedRecord = await tx.workflowRecord.update({
            where: { id: workflowId },
            data: {
              status: 'FAILED',
              retryCount: (workflow.retryCount || 0) + 1,
            },
          });

          await appendGovernanceLog({
            prisma: tx,
            workflowId,
            traceId,
            fromState: workflow.status as any,
            toState: 'FAILED',
            actor: 'action_worker',
            payloadSnapshot: {
              ...failedRecord.contextData,
              error: (error as Error).message,
              failedAt: new Date().toISOString(),
            },
          });
        }
      });
      prismaError.$disconnect();
    } catch (logError) {
      console.error(`[ACTION WORKER] Failed to log error state:`, logError);
    }

    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Execute side effects based on workflow type
 * This is where external systems are triggered (payment gateways, shipping APIs, etc.)
 */
async function executeSideEffects(
  workflowId: string,
  context: any
): Promise<{
  type: string;
  status: string;
  externalId?: string;
  timestamp: string;
  details?: any;
}> {
  const routing = context.routingDecision;

  console.log(
    `[ACTION WORKER] Executing side effects for route: ${routing?.route}`
  );

  // Execute route-specific side effects
  switch (routing?.route) {
    case 'PAYMENT_PROCESSING':
      return await processPayment(workflowId, context);

    case 'ORDER_FULFILLMENT':
      return await fulfillOrder(workflowId, context);

    default:
      return {
        type: 'GENERIC_ACTION',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
        details: 'Generic workflow action completed',
      };
  }
}

/**
 * Process payment side effects
 * In production: calls payment gateway, processes transaction, etc.
 */
async function processPayment(
  workflowId: string,
  context: any
): Promise<{
  type: string;
  status: string;
  externalId?: string;
  timestamp: string;
  details?: any;
}> {
  const input = context.input;

  console.log(
    `[ACTION WORKER] Processing payment: $${input.paymentAmount} for merchant ${input.merchant}`
  );

  // Simulate payment processing (in production: call payment gateway)
  // For demo: generate a mock transaction ID
  const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Simulate processing time
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    type: 'PAYMENT_PROCESSED',
    status: 'SUCCESS',
    externalId: transactionId,
    timestamp: new Date().toISOString(),
    details: {
      amount: input.paymentAmount,
      currency: input.currency,
      merchant: input.merchant,
      userId: input.userId,
      message: 'Payment successfully processed',
    },
  };
}

/**
 * Fulfill order side effects
 * In production: sends to fulfillment system, notifies warehouse, etc.
 */
async function fulfillOrder(
  workflowId: string,
  context: any
): Promise<{
  type: string;
  status: string;
  externalId?: string;
  timestamp: string;
  details?: any;
}> {
  const input = context.input;

  console.log(
    `[ACTION WORKER] Fulfilling order: ${input.orderId} for customer ${input.customerId}`
  );

  // Simulate order fulfillment (in production: send to warehouse management system)
  const fulfillmentId = `FLF_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Simulate fulfillment processing
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    type: 'ORDER_FULFILLED',
    status: 'SUCCESS',
    externalId: fulfillmentId,
    timestamp: new Date().toISOString(),
    details: {
      orderId: input.orderId,
      customerId: input.customerId,
      itemCount: input.items?.length || 0,
      shippingAddress: input.shippingAddress,
      message: 'Order successfully submitted for fulfillment',
    },
  };
}
