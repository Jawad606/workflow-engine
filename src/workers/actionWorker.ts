import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { appendGovernanceLog } from '../services/governanceLogService.js';

export async function processAction(
  job: Job<{
    workflowId: string;
    traceId: string;
  }>
) {
  const { workflowId, traceId } = job.data;
  const prisma = new PrismaClient();

  try {
    const queuedRecord = await prisma.$transaction(async (tx) => {
      const workflow = await tx.workflowRecord.findUnique({
        where: { id: workflowId }
      });

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`);
      }

      if (workflow.status === 'COMPLETED') {
        return workflow;
      }

      if (workflow.status === 'ACTION_QUEUED') {
        return workflow;
      }

      if (workflow.status !== 'DECISION_PENDING') {
        throw new Error(`Invalid state transition: ${workflow.status} -> ACTION_QUEUED`);
      }

      return tx.workflowRecord.update({
        where: { id: workflowId },
        data: { status: 'ACTION_QUEUED' }
      });
    });

    if (queuedRecord.status === 'COMPLETED') {
      return {
        success: true,
        workflowId,
        finalStatus: queuedRecord.status,
        completedAt: queuedRecord.completedAt
      };
    }

    const contextData = asObject(queuedRecord.contextData);
    const decision = asObject(contextData.decision);

    const recommendedCare = String(decision.recommended_care ?? queuedRecord.recommendedCare ?? 'general_care');

    const referral = {
      referral_id: `ref_${Date.now()}`,
      provider: 'City PT Clinic',
      provider_type: recommendedCare === 'physical_therapy' ? 'telehealth' : 'in_person',
      in_network: true,
      is_leakage: false,
      navigator_notified: true,
      created_at: new Date().toISOString()
    };

    const isAdhered = recommendedCare === 'physical_therapy' && referral.provider_type === 'telehealth';
    const actionResult = {
      action: 'referral_created',
      provider: referral.provider,
      provider_type: referral.provider_type,
      in_network: referral.in_network,
      is_leakage: referral.is_leakage,
      referral_id: referral.referral_id,
      navigator_notified: referral.navigator_notified
    };

    const finalRecord = await prisma.$transaction(async (tx) => {
      const workflow = await tx.workflowRecord.findUnique({
        where: { id: workflowId }
      });

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`);
      }

      if (workflow.status === 'COMPLETED') {
        return workflow;
      }

      if (workflow.status !== 'ACTION_QUEUED') {
        throw new Error(`Invalid state transition: ${workflow.status} -> COMPLETED`);
      }

      const workflowContext = asObject(workflow.contextData);
      const now = new Date();
      const completed = await tx.workflowRecord.update({
        where: { id: workflowId },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          actualPathway: workflow.recommendedPathway,
          actualCare: recommendedCare,
          isAdhered,
          isLeakage: referral.is_leakage,
          contextData: {
            ...workflowContext,
            actionResult,
            adherence: {
              is_adhered: isAdhered,
              calculated_at: now.toISOString()
            }
          } as never
        }
      });

      const adherenceNarrative = isAdhered ? 'Pathway adhered.' : 'Pathway not adhered.';
      await appendGovernanceLog({
        prisma: tx,
        workflowId,
        traceId,
        fromState: 'ACTION_QUEUED',
        toState: 'COMPLETED',
        actor: 'action_worker',
        narrative: `Referral created for City PT Clinic (${referral.provider_type === 'telehealth' ? 'Telehealth' : 'In-Person'}, In-Network). Care navigator notified. Workflow completed. No overrides. ${adherenceNarrative}`,
        payloadSnapshot: {
          actionResult,
          referral,
          is_adhered: isAdhered,
          is_overridden: completed.isOverridden,
          is_leakage: completed.isLeakage
        }
      });

      return completed;
    });

    return {
      success: true,
      workflowId,
      finalStatus: finalRecord.status,
      completedAt: finalRecord.completedAt
    };
  } catch (error) {
    console.error(`[ACTION WORKER] Error processing ${workflowId}:`, error);

    try {
      const prismaError = new PrismaClient();
      await prismaError.$transaction(async (tx) => {
        const workflow = await tx.workflowRecord.findUnique({
          where: { id: workflowId }
        });

        if (workflow && workflow.status !== 'FAILED') {
          const failedRecord = await tx.workflowRecord.update({
            where: { id: workflowId },
            data: {
              status: 'FAILED',
              retryCount: (workflow.retryCount || 0) + 1
            }
          });

          await appendGovernanceLog({
            prisma: tx,
            workflowId,
            traceId,
            fromState: workflow.status,
            toState: 'FAILED',
            actor: 'action_worker',
            narrative: `Action execution failed due to an unexpected error: ${(error as Error).message}`,
            payloadSnapshot: {
              ...asObject(failedRecord.contextData),
              error: (error as Error).message,
              failedAt: new Date().toISOString()
            }
          });
        }
      });
      await prismaError.$disconnect();
    } catch (logError) {
      console.error('[ACTION WORKER] Failed to log error state:', logError);
    }

    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}
