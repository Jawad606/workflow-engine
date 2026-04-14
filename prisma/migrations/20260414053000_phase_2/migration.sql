-- AlterTable
ALTER TABLE "governance_logs" ADD COLUMN     "narrative" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "workflow_records" ADD COLUMN     "actual_care" TEXT,
ADD COLUMN     "actual_pathway" TEXT,
ADD COLUMN     "is_adhered" BOOLEAN,
ADD COLUMN     "is_leakage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_overridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leakage_reason" TEXT,
ADD COLUMN     "override_by" TEXT,
ADD COLUMN     "override_reason" TEXT,
ADD COLUMN     "recommended_care" TEXT,
ADD COLUMN     "recommended_pathway" TEXT;
