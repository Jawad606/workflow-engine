import { randomUUID } from "node:crypto";
import { workflowQueue } from "../core/queue.js";
import { prisma } from "../core/db.js";
import { appendGovernanceLog } from "./governanceLogService.js";

export async function startWorkflow(
  input: {
    idempotencyKey: string;
    payload: {
      symptom: string;
      pain_level: number;
      duration: string;
      red_flags: boolean;
      age: number;
      patient_id: string;
      failed_pt_history?: boolean | undefined;
    };
  },
  client = prisma,
) {
  const existing = await client.workflowRecord.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });

  if (existing) {
    return existing;
  }

  const traceId = randomUUID();
  const intakeNarrative = `Patient reported ${input.payload.symptom} (pain level ${input.payload.pain_level}/10, red flags: ${input.payload.red_flags ? 'yes' : 'no'}). Workflow created and queued for routing.`;

  const workflow = await client.$transaction(async (tx) => {
    const created = await tx.workflowRecord.create({
      data: {
        traceId,
        status: "INITIATED",
        contextData: {
          input: input.payload,
          pathway_selected: null,
          decision: null,
          actionResult: null,
          adherence: null
        } as never,
        idempotencyKey: input.idempotencyKey,
      },
    });

    await appendGovernanceLog({
      prisma: tx,
      workflowId: created.id,
      traceId,
      fromState: 'INITIATED',
      toState: 'INITIATED',
      actor: 'orchestrator',
      narrative: intakeNarrative,
      payloadSnapshot: {
        input: input.payload,
        event: 'workflow_created'
      }
    });

    return created;
  });

  await workflowQueue.add("route", {
    workflowId: workflow.id,
    traceId: workflow.traceId,
  });

  return workflow;
}
