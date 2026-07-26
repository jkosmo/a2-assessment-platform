-- #475 Phase 2: AI-influence flagging content-similarity signal. Additive, nullable column holding the
-- computed AI-influence signals at decision time (declaration outcome + content-similarity score).
-- Transparent, review-signal-only (never affects pass/fail). Expand-safe: nullable, no backfill, no
-- drops/renames (CLAUDE.md invariant #13).
ALTER TABLE "AssessmentDecision" ADD COLUMN "aiInfluenceJson" TEXT;
