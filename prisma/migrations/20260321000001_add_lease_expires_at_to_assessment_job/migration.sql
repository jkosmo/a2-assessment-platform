-- AlterTable
ALTER TABLE "AssessmentJob" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AssessmentJob_status_leaseExpiresAt_idx" ON "AssessmentJob"("status", "leaseExpiresAt");
