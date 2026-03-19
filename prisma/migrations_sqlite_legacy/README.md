This directory preserves the archived SQLite-era Prisma migration history.

Why it was moved:
- the active repository runtime now targets PostgreSQL
- the old `prisma/migrations/*` SQL was generated for SQLite semantics
- keeping those files in the active Prisma migration path would make `migrate deploy` unsafe or misleading

Current rule:
- `prisma/migrations/` contains the active PostgreSQL baseline and future PostgreSQL migrations
- `prisma/migrations_sqlite_legacy/` is historical reference only and is not part of the active migration chain
