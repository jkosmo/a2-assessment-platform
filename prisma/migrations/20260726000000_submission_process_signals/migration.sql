-- #475: AI-influence flagging (Phase 1). Additive, nullable column holding the participant's
-- AI-use declaration + reflective-nudge choice (aggregate-only; no keystroke/paste telemetry).
-- Expand-safe: nullable, no default backfill needed, no drops/renames (CLAUDE.md invariant #13).
ALTER TABLE "Submission" ADD COLUMN "processSignalsJson" TEXT;
