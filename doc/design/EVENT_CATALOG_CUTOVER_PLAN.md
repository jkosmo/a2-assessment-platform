## Event Catalog Cutover Plan

Issue: `#254`

### Goal

Replace free-form audit action strings, entity types, and operational event names with canonical typed catalogs and cut the current event-producing code over to them.

### End State

- audit entity types live in one catalog
- audit actions live in one catalog
- operational event names live in one catalog
- `recordAuditEvent(...)` only accepts known entity types and audit actions
- `logOperationalEvent(...)` only accepts known operational events
- event metadata keeps a typed minimum contract per event while still allowing extra fields

### Scope For This Cut

- all current `recordAuditEvent(...)` call sites in `src/`
- all current `logOperationalEvent(...)` call sites in `src/`
- typed catalogs plus generic function signatures

### Design Choices

- keep catalogs as plain TypeScript constants so they are easy to import from feature modules
- type metadata as “minimum required fields + extra metadata allowed” to avoid blocking valid observability enrichment
- keep runtime behavior unchanged; this is a contract and maintainability cutover, not a logging pipeline rewrite

### Verification

- `npm run lint`
- focused unit tests for catalog-backed logging/audit call signatures where useful
