# A2 Assessment Platform

Backend bootstrap for M0 foundation issues:
- `#9` Entra login + RBAC bootstrap
- `#10` Core data model + migrations with version traceability
- `#11` Module + active version APIs
- `#12` Borderline routing discovery baseline

## Tech
- Node.js + TypeScript + Express
- Prisma ORM
- SQLite (development bootstrap)

## Setup
1. Copy env file:
```bash
cp .env.example .env
```

2. Install dependencies:
```bash
npm install
```

3. Generate Prisma client and run migration:
```bash
npm run prisma:generate
npm run db:migrate
```

4. Seed baseline data:
```bash
npm run prisma:seed
```

5. Start app:
```bash
npm run dev
```

## API (M0)
- `GET /healthz`
- `GET /api/me`
- `GET /api/modules`
- `GET /api/modules/:moduleId`
- `GET /api/modules/:moduleId/active-version`

## Auth modes
- `AUTH_MODE=mock` (default for local development)
- `AUTH_MODE=entra` (JWT validation against Microsoft Entra ID)

In mock mode, optional headers can override identity:
- `x-user-id`
- `x-user-email`
- `x-user-name`
- `x-user-department`
- `x-user-roles` (comma-separated app roles)

## Discovery output
Borderline/manual review routing baseline is documented in:
- `doc/M0_BORDERLINE_ROUTING.md`

M0 architecture and implementation decisions are documented in:
- `doc/M0_IMPLEMENTATION_DECISIONS.md`

Version history is tracked in:
- `doc/VERSIONS.md`
