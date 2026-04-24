# Design: Isolate source-material parsing into a separate parser runtime

**Issue:** #341  
**Status:** Design  
**Date:** 2026-04-19  
**Finding:** Pentest stepping-stone surface (P-08)  
**Pairs with:** #342 (P-09 — preflight and kill switches)

---

## Problem

`extractSourceMaterialText` runs inline in the web app process. The web app holds `DATABASE_URL`, `AZURE_OPENAI_API_KEY`, and `AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING`. Five third-party parser libraries execute here (`officeparser`, `word-extractor`, `ppt`, `mammoth`, `pdf-parse`), including legacy binary format parsers (`.doc`, `.ppt`) with the largest attack surface.

A parser exploit, sandbox escape, or severe crash currently affects the entire application and all its secrets. This is a blast-radius problem, not a confirmed RCE — but the combination of complex binary parsers + high-value co-located secrets is architecturally indefensible before pilot.

---

## What is NOT changing

- Supported file formats (same 11 formats)
- File size limit (2 MB)
- Admin UX (same upload experience, just async)
- The parsing logic itself (moves to parser runtime, no logic change)

---

## Runtime topology decision

Four options were evaluated:

| Option | Pros | Cons |
|---|---|---|
| **A: New App Service (parser worker)** | Familiar pattern, same IaC as web/worker apps, easy to observe | Always-on cost even at zero traffic |
| **B: Azure Container App** | Scales to zero, better isolation boundary | New infra pattern, requires Container Registry |
| **C: Azure Function (HTTP trigger)** | Serverless, per-invocation billing | Cold start latency, different deployment model |
| **D: Reuse assessment worker App Service** | No new resource | Assessment worker still has DATABASE_URL + OpenAI keys — does not solve the isolation problem |

**Decision: Option A — new App Service (`parser-worker`).** Familiar infrastructure pattern, same Bicep structure as the existing worker. Easy to observe and debug during pilot. Scales-to-zero concerns are post-pilot; the cost delta for a Burstable B1 App Service is negligible during the pilot period.

---

## Communication pattern decision

Two options were evaluated:

| Option | Notes |
|---|---|
| **A: Synchronous HTTP** | Simple. Web calls parser, waits. If parser hangs, web request hangs. Does not satisfy the "quarantine" requirement. |
| **B: Async HTTP with short-poll** | Web POSTs file, gets 202+jobId immediately. Parser processes in background. Web polls parser's status endpoint. Web app is never blocked waiting for parsing. |

**Decision: Option B — async HTTP with short-poll.** Required by the acceptance criteria. Also correct: if a malformed file causes the parser to spin or crash, the web app is completely unaffected (the HTTP call that submitted the job already returned 202).

---

## Detailed design

### Secrets boundary

| Secret | Web app | Parser worker |
|---|---|---|
| `DATABASE_URL` | ✓ | ✗ |
| `AZURE_OPENAI_API_KEY` | ✓ | ✗ |
| `ACS_CONNECTION_STRING` | ✓ | ✗ |
| `PARSER_WORKER_URL` | ✓ | ✗ |
| `PARSER_WORKER_AUTH_KEY` | ✓ (to sign requests) | ✓ (to verify requests) |

The parser worker receives only the auth key needed to authenticate calls from the web app. It has no database, no AI credentials, and no notification credentials.

### Authentication between web and parser

HMAC-SHA256 signed request header. Web app signs each request with `PARSER_WORKER_AUTH_KEY`:

```
X-Parser-Auth: hmac-sha256 <hex(HMAC-SHA256(PARSER_WORKER_AUTH_KEY, timestamp+jobId+fileSize))>
X-Parser-Timestamp: <unix-timestamp>
```

Parser worker rejects requests with:
- Missing header → 401
- Timestamp older than 60 seconds → 401 (replay protection)
- Invalid HMAC signature → 401

This is a shared-secret pattern. PARSER_WORKER_AUTH_KEY is a 32-byte random hex string set as an App Service setting on both runtimes.

### Async job flow

```
Admin UI                 Web app                  Parser worker
   |                        |                           |
   |-- POST /source-material/extract ─────────────────>|
   |   (fileName, mimeType, contentBase64)              |
   |                        |                           |
   |                        |-- POST /parse (signed) -->|
   |                        |   (same payload)          |
   |                        |                           |
   |                        |<-- 202 { jobId } ---------|
   |<-- 202 { jobId } ------|                           |
   |                        |                           |-- parseLegacyDoc/parseLegacyPpt
   |                        |                           |   (runs async, no secrets needed)
   |                        |                           |
   |-- GET /source-material/extract/:jobId ------------>|
   |                        |                           |
   |                        |-- GET /parse/:jobId ------>|
   |                        |<-- 200 { status, result } |
   |<-- 200 { status, result } -|                      |
```

**Polling semantics:**
- `202 { jobId }` — job accepted, poll until complete
- `200 { status: "pending" }` — still processing
- `200 { status: "done", extractedText, fileName, format, extractedChars }` — complete
- `200 { status: "failed", error }` — extraction error
- `404` — job not found (expired or invalid ID)

Job TTL: 10 minutes in-memory. Admin UI polls every 1s until done or failed. Maximum wait: bounded by file complexity + parser library performance.

### Parser worker API (new Express app)

Two endpoints:

```
POST /parse
  Body: { fileName, mimeType?, contentBase64 }
  Auth: X-Parser-Auth header
  Response: 202 { jobId }

GET /parse/:jobId
  Auth: X-Parser-Auth header
  Response: 200 { status: "pending"|"done"|"failed", result?, error? }
```

In-memory job store:
```typescript
type ParserJob = {
  id: string;
  status: "pending" | "done" | "failed";
  result?: SourceMaterialExtractionResult;
  error?: string;
  createdAt: Date;
};
const jobs = new Map<string, ParserJob>();
// Purge jobs older than 10 minutes on each request
```

### Web app changes

`POST /api/admin/content/source-material/extract` becomes async:

```typescript
// Before: calls extractSourceMaterialText() inline, returns result
// After: calls parser worker, returns 202 { jobId }

adminContentRouter.post("/source-material/extract", generateLimiter, async (req, res) => {
  // validate input (unchanged)
  const jobId = await parserWorkerClient.submitParseJob(data);
  res.status(202).json({ jobId });
});

// New polling endpoint:
adminContentRouter.get("/source-material/extract/:jobId", generateLimiter, async (req, res) => {
  const result = await parserWorkerClient.getParsedResult(req.params.jobId);
  if (!result) { res.status(404).json({ error: "job_not_found" }); return; }
  res.json(result); // { status, result?, error? }
});
```

`parserWorkerClient` is a new module in `src/clients/parserWorkerClient.ts` that handles HMAC signing, HTTP calls, and translates parser errors into the same error types (`SourceMaterialTooLargeError`, `UnsupportedSourceMaterialFormatError`, `SourceMaterialExtractionError`).

### Admin UI changes

The `source-material/extract` call in `admin-content.js` / `admin-content-advanced.html` changes from synchronous `await apiFetch(...)` to a poll loop:

```javascript
// Submit
const { jobId } = await apiFetch("/api/admin/content/source-material/extract", headers, { method: "POST", body });

// Poll (max 30 iterations × 1s = 30s timeout)
let result;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  const poll = await apiFetch(`/api/admin/content/source-material/extract/${jobId}`, headers);
  if (poll.status === "done") { result = poll.result; break; }
  if (poll.status === "failed") throw new Error(poll.error);
}
if (!result) throw new Error("Parsing timed out.");
```

---

## Parser worker runtime environment

What the parser App Service receives:
```
PARSER_WORKER_AUTH_KEY   = <random 32-byte hex>
NODE_ENV                  = production
PORT                      = 8080
WEBSITES_PORT             = 8080
APP_ROLE                  = parser
```

What the parser App Service does NOT receive:
- `DATABASE_URL`
- `AZURE_OPENAI_*`
- `ACS_CONNECTION_STRING`
- Any JWT/auth configuration

The parser has no database access and cannot be used as a pivot to application data even if fully compromised.

---

## Bicep changes

New resource in `infra/azure/main.bicep`:

```bicep
resource parserApp 'Microsoft.Web/sites@2023-12-01' = {
  name: parserAppName
  location: location
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      appSettings: [
        { name: 'PARSER_WORKER_AUTH_KEY', value: parserWorkerAuthKey }
        { name: 'APP_ROLE', value: 'parser' }
        { name: 'WEBSITES_PORT', value: '8080' }
        { name: 'NODE_ENV', value: 'production' }
      ]
    }
  }
}
```

Web app gets two new settings:
```bicep
{ name: 'PARSER_WORKER_URL', value: 'https://${parserApp.properties.defaultHostName}' }
{ name: 'PARSER_WORKER_AUTH_KEY', value: parserWorkerAuthKey }
```

Note: `parserWorkerAuthKey` will move to Key Vault once #334 is implemented.

---

## Files affected

| File | Change |
|---|---|
| `src/modules/adminContent/sourceMaterialExtractionService.ts` | No change — logic stays here, moves to parser runtime via deployment |
| `src/routes/adminContent.ts` | `/source-material/extract` becomes 202 + GET poll endpoint |
| `src/clients/parserWorkerClient.ts` | New — HMAC signing, HTTP client, job polling |
| `src/config/env.ts` | Add `PARSER_WORKER_URL`, `PARSER_WORKER_AUTH_KEY` |
| Parser runtime entry point | New Express app (thin: auth middleware + in-memory job store + `/parse` routes) |
| Admin UI JS (source material upload) | Poll loop instead of blocking await |
| `infra/azure/main.bicep` | New `parserApp` resource + `parserWorkerAuthKey` parameter |
| `package.json` | Parser runtime may be a separate `package.json` or share the monorepo build |

---

## Pilot constraints and V2 path

For pilot, the in-memory job store in the parser is acceptable — jobs are short-lived (seconds), and a parser crash that loses pending jobs is an admin nuisance, not a data integrity issue (admin re-uploads). The parser worker can be restarted without affecting any user data.

Post-pilot V2: replace in-memory job store with Azure Storage Queue + Blob Storage result store. This also enables retries, dead-letter queues, and distributed scaling.

---

## Open question for review

**Format split:** Should `.txt` and `.md` remain in the web app (they use no third-party parser, just `buffer.toString('utf8')`)? This would reduce parser load and keep latency near-zero for the most common source material format. Risk: adds complexity to route logic (sync vs async based on format). **Recommendation: all formats go through the parser worker for uniformity and to avoid a split code path.** Revisit post-pilot.
