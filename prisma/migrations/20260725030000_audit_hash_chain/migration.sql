-- #804: tamper-evident audit chain. chainSeq gives a deterministic total order (BIGSERIAL backfills
-- existing rows in physical order); prevHash links each event to the prior one. Additive + non-breaking:
-- existing rows get a chainSeq and a NULL prevHash until the one-time backfill re-seals them into the chain.

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "chainSeq" BIGSERIAL NOT NULL,
ADD COLUMN     "prevHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_chainSeq_key" ON "AuditEvent"("chainSeq");
