-- #797: denormalize the related submission id onto AuditEvent so the participant audit-trail read is an
-- indexed equality lookup instead of an unindexable `metadataJson LIKE '%"submissionId":"…"%'` seq scan
-- over the whole indefinitely-growing table (a scripted refresh could otherwise saturate the pool).

-- AddColumn
ALTER TABLE "AuditEvent" ADD COLUMN "submissionId" TEXT;

-- Backfill: events whose entity IS the submission.
UPDATE "AuditEvent" SET "submissionId" = "entityId" WHERE "entityType" = 'submission';

-- Backfill: events that reference a submission in their metadata (decisions, evaluations, overrides, …).
-- The LIKE pre-filter limits the jsonb cast to rows that actually carry the key.
UPDATE "AuditEvent"
  SET "submissionId" = ("metadataJson"::jsonb ->> 'submissionId')
  WHERE "submissionId" IS NULL AND "metadataJson" LIKE '%"submissionId":%';

-- CreateIndex
CREATE INDEX "AuditEvent_submissionId_timestamp_idx" ON "AuditEvent"("submissionId", "timestamp");
