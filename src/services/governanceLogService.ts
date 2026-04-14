import type { GovernanceLog, Prisma, WorkflowRecord } from '@prisma/client';
import type { WorkflowStatus } from '../core/workflow-state.js';

export async function appendGovernanceLog(parameters: {
  prisma: Prisma.TransactionClient;
  workflowId: string;
  traceId: string;
  fromState: WorkflowStatus;
  toState: WorkflowStatus;
  actor: string;
  narrative: string;
  payloadSnapshot: unknown;
}) {
  const { prisma, workflowId, traceId, fromState, toState, actor, narrative, payloadSnapshot } = parameters;

  return prisma.governanceLog.create({
    data: {
      workflowId,
      traceId,
      fromState,
      toState,
      actor,
      narrative,
      payloadSnapshot: payloadSnapshot as never
    }
  });
}

export function mapLogStage(log: Pick<GovernanceLog, 'actor' | 'toState'>): 'Intake' | 'Route' | 'Decision' | 'Action' | 'System' {
  if (log.actor === 'orchestrator') {
    return 'Intake';
  }

  if (log.actor === 'route_worker' || log.toState === 'ROUTING') {
    return 'Route';
  }

  if (log.actor === 'decision_worker' || log.toState === 'DECISION_PENDING') {
    return 'Decision';
  }

  if (log.actor === 'action_worker' || log.toState === 'ACTION_QUEUED' || log.toState === 'COMPLETED') {
    return 'Action';
  }

  return 'System';
}

export function buildWorkflowSummary(workflow: WorkflowRecord, logs: GovernanceLog[]) {
  const context = (workflow.contextData ?? {}) as Record<string, unknown>;
  const actionResult = (context.actionResult ?? {}) as Record<string, unknown>;

  return {
    pathway_selected: workflow.recommendedPathway,
    recommended_care: workflow.recommendedCare,
    action_taken: actionResult.action ?? null,
    is_adhered: workflow.isAdhered,
    is_overridden: workflow.isOverridden,
    is_leakage: workflow.isLeakage,
    logs_count: logs.length
  };
}