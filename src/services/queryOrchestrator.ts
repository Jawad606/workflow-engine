import { randomUUID } from "node:crypto";
import { workflowQueue } from "../core/queue.js";
import { prisma } from "../core/db.js";

export async function startWorkflow(
  input: { idempotencyKey: string; payload: unknown },
  client = prisma,
) {
  const existing = await client.workflowRecord.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });

  if (existing) {
    return existing;
  }

  const traceId = randomUUID();

  const workflow = await client.workflowRecord.create({
    data: {
      traceId,
      status: "INITIATED",
      contextData: { input: input.payload } as any,
      idempotencyKey: input.idempotencyKey,
    },
  });

  await workflowQueue.add("route", {
    workflowId: workflow.id,
    traceId: workflow.traceId,
  });

  return workflow;
}
