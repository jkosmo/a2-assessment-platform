-- #807: index the retention purge predicate (action IN … AND timestamp < cutoff). Without it, every
-- retention run seq-scanned the whole indefinitely-growing AuditEvent table. Plain (non-concurrent)
-- CREATE INDEX: the table is modest and the brief lock is acceptable; revisit with CONCURRENTLY if it grows.
CREATE INDEX "AuditEvent_action_timestamp_idx" ON "AuditEvent"("action", "timestamp");
