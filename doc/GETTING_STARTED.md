# Getting Started

## Prerequisites

- Node.js 22+
- Docker (for local PostgreSQL)

```bash
docker --version
```

---

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Start the local PostgreSQL container and generate env files:

```bash
npm run postgres:setup
```

This starts a PostgreSQL container on `127.0.0.1:54329`, creates `a2_assessment_dev` and `a2_assessment_test`, and writes `.env.postgres.local` and `.env.postgres.test`.

3. Generate Prisma client and apply migrations:

```bash
npm run prisma:generate
npm run db:reset
```

4. Seed baseline data:

```bash
npx dotenv -e .env.postgres.local -- npm run prisma:seed
```

5. Start the dev server:

```bash
npm run dev
```

The dev server watches for TypeScript changes and restarts automatically. Static files in `public/` require a manual restart.

---

## PostgreSQL Automation

One-command setup (steps 2–4 above):

```bash
npm run postgres:setup
```

Full bootstrap including seed and smoke test:

```bash
npm run postgres:app:bootstrap
```

Other useful commands:

```bash
npm run postgres:status       # check container status
npm run postgres:verify       # verify DB connectivity
npm run postgres:stop         # stop the container
npm run postgres:recreate     # destroy and recreate
npm run postgres:destroy      # destroy permanently
npm run postgres:write-env    # regenerate .env files

npm run postgres:app:reset    # reset dev DB (drop + migrate)
npm run postgres:test:reset   # reset test DB
npm run postgres:app:seed     # seed dev DB
npm run postgres:test:seed    # seed test DB
npm run postgres:app:smoke    # run dev smoke tests
npm run postgres:test:smoke   # run test smoke tests
```

Key files:
- `docker-compose.postgres.yml`
- `scripts/postgres/localSetup.mjs`
- `scripts/postgres/appBootstrap.mjs`

---

## Running Tests

```bash
npm run lint          # TypeScript type-check
npm test              # full test suite (unit + integration)
npm run test:unit     # unit tests only (no DB required)
npm run test:integration   # integration tests (requires running postgres)
```

CI runs on PR + push to `main` via `.github/workflows/ci.yml`.

---

## Auth Modes

| Mode | Use |
|---|---|
| `AUTH_MODE=mock` | Local development (default) |
| `AUTH_MODE=entra` | Production (JWT validation against Microsoft Entra ID) |

In mock mode, identity headers override the default test user:

```
x-user-id
x-user-email
x-user-name
x-user-department
x-user-roles      (comma-separated: PARTICIPANT, REVIEWER, ADMINISTRATOR, etc.)
x-user-groups     (comma-separated Entra group object IDs)
```

---

## LLM Modes

| Mode | Use |
|---|---|
| `LLM_MODE=stub` | Local/test (default) — deterministic responses, no API calls |
| `LLM_MODE=azure_openai` | Production |

Azure OpenAI env vars:

```
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_KEY
AZURE_OPENAI_DEPLOYMENT
AZURE_OPENAI_API_VERSION        (default: 2024-10-21)
AZURE_OPENAI_TIMEOUT_MS         (default: 120000)
AZURE_OPENAI_TEMPERATURE        (default: 0)
AZURE_OPENAI_MAX_TOKENS         (default: 1200)
AZURE_OPENAI_TOKEN_LIMIT_PARAMETER   (max_tokens | max_completion_tokens | auto; default: auto)
```

> For `gpt-5-nano`, use `AZURE_OPENAI_TEMPERATURE=1`, `AZURE_OPENAI_MAX_TOKENS=4000`, `AZURE_OPENAI_TOKEN_LIMIT_PARAMETER=auto`.

---

## Manual Testing — Workspace Walkthroughs

Start the dev server and open the relevant workspace URL.

### Participant (`PARTICIPANT` role)

```
http://localhost:3000/participant
```

Flow:
1. Load modules → select one
2. Create submission (MCQ starts automatically after submit)
3. Submit MCQ
4. Assessment runs async — poll or wait for result
5. View result
6. Optionally file an appeal once status is `COMPLETED`

Completed modules history:
```
http://localhost:3000/participant/completed
```

### Reviewer (`REVIEWER` / `ADMINISTRATOR` role)

```
http://localhost:3000/review
```

- Queue shows `OPEN` / `IN_REVIEW` reviews by default; expand to `RESOLVED` via status pills
- Select a row → Claim review
- Finalize with decision reason + override note + pass/fail

### Appeal Handler (`APPEAL_HANDLER` / `ADMINISTRATOR` role)

```
http://localhost:3000/review
```

- Queue shows `OPEN` / `IN_REVIEW` appeals by default
- Use search to filter by participant/module/appeal
- Select a row → Claim Appeal → Resolve with outcome + resolution note

### Calibration (`SUBJECT_MATTER_OWNER` / `ADMINISTRATOR` role)

```
http://localhost:3000/calibration
```

- Enter `moduleId` and load snapshot
- Filter by status, date, or module version
- Review benchmark-anchor coverage and quality signal flags

### Admin Content (`SUBJECT_MATTER_OWNER` / `ADMINISTRATOR` role)

```
http://localhost:3000/admin-content
```

1. Create a base module (title / description / certification / validity window)
2. Load the module and fill: rubric, evaluation instruction, benchmark examples, MCQ set, submission schema
3. Save and publish a module version

Text fields accept plain text or locale JSON: `{"en-GB":"...","nb":"...","nn":"..."}`.

---

## Attachment Parsing

`POST /api/submissions` accepts optional attachment fields:

```json
{
  "attachmentBase64": "...",
  "attachmentFilename": "submission.pdf",
  "attachmentMimeType": "application/pdf"
}
```

Supported formats: PDF, DOCX. On parse failure, the `responseText` field is used as fallback. If no fallback is provided, the API returns a descriptive parse error.

---

## Configuration Files

Runtime behaviour is controlled by JSON config files in `config/`. See [CONFIG_REFERENCE.md](CONFIG_REFERENCE.md) for the full field-by-field reference.

Key overrides:

| Config | Env var override |
|---|---|
| `config/assessment-rules.json` | `ASSESSMENT_RULES_FILE` |
| `config/participant-console.json` | `PARTICIPANT_CONSOLE_CONFIG_FILE` |
| `config/entra-group-role-map.*` | `ENTRA_GROUP_ROLE_MAP_JSON` or `ENTRA_GROUP_ROLE_MAP_FILE` |

`PARTICIPANT_CONSOLE_DEBUG_MODE` controls raw debug panels in workspace UIs:
- `auto` — enabled unless `NODE_ENV=production`
- `true` — force enabled
- `false` — force disabled (recommended in production)
