export const workflowStatuses = ['INITIATED', 'ROUTING', 'DECISION_PENDING', 'ACTION_QUEUED', 'COMPLETED', 'FAILED'] as const;

export type WorkflowStatus = (typeof workflowStatuses)[number];

export const validTransitions: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  INITIATED: ['ROUTING', 'FAILED'],
  ROUTING: ['DECISION_PENDING', 'FAILED'],
  DECISION_PENDING: ['ACTION_QUEUED', 'FAILED'],
  ACTION_QUEUED: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: []
};

export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return validTransitions[from].includes(to);
}