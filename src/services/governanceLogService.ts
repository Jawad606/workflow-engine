import type { PrismaClient } from '@prisma/client';
import type { WorkflowStatus } from '../core/workflow-state.js';

export async function appendGovernanceLog(parameters: {
  prisma: PrismaClient;
  workflowId: string;
  traceId: string;
  fromState: WorkflowStatus;
  toState: WorkflowStatus;
  actor: string;
  payloadSnapshot: unknown;
}) {
  const { prisma, workflowId, traceId, fromState, toState, actor, payloadSnapshot } = parameters;

  return prisma.governanceLog.create({
    data: {
      workflowId,
      traceId,
      fromState,
      toState,
      actor,
      payloadSnapshot: payloadSnapshot as never
    }
  });
}