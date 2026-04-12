-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('INITIATED', 'ROUTING', 'DECISION_PENDING', 'ACTION_QUEUED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "workflow_records" (
    "id" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "status" "WorkflowStatus" NOT NULL,
    "context_data" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "workflow_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_logs" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "from_state" "WorkflowStatus" NOT NULL,
    "to_state" "WorkflowStatus" NOT NULL,
    "actor" TEXT NOT NULL,
    "payload_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_records_idempotency_key_key" ON "workflow_records"("idempotency_key");

-- AddForeignKey
ALTER TABLE "governance_logs" ADD CONSTRAINT "governance_logs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflow_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
