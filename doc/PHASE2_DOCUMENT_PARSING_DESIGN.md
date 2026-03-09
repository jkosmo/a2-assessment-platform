# Phase 2 Design Note: Improved Document Parser for PDF and DOCX (#34)

## Context
Issue #34 requires parser support for common office formats with fallback behavior, parser-quality logging, and clear user feedback when parsing fails.

Current submission flow stores `rawText` directly and does not parse file content.

## Chosen approach
- Extend submission input to optionally accept attachment payload for parsing:
  - `attachmentBase64`
  - `attachmentFilename`
  - `attachmentMimeType`
- Add parser service with format detection (`pdf`, `docx`) and injected parser adapters.
- Integrate parser in `createSubmission`:
  - if parse succeeds, use extracted text as submission `rawText`
  - if parse fails and `rawText` exists, fallback to `rawText`
  - if parse fails and no `rawText`, return clear validation error
- Log parser quality signals (length/quality/status/reason) to operational logs and audit trail.

## Why this option
- Keeps API backward compatible for existing text flow.
- Avoids schema migration.
- Provides deterministic, testable parser decision logic through injected parser functions.

## Rollout/rollback
- If parser behavior causes issues, clients can continue using text-only submission.
- Fallback behavior prevents hard failures when optional text is provided.
