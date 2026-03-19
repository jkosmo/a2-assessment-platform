ALTER TABLE "Appeal" ADD COLUMN "claimedAt" DATETIME;

CREATE INDEX "Appeal_appealStatus_claimedAt_idx" ON "Appeal"("appealStatus", "claimedAt");
