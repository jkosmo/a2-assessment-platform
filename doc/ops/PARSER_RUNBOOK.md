# Parser Worker Runbook

## Overview

The parser worker is a dedicated Express app (`src/parserApp.ts`) that handles file-to-text extraction in isolation from the main web process. It exposes two authenticated endpoints:

- `POST /parse` — submit a job, returns `{ jobId }` with HTTP 202
- `GET /parse/:jobId` — poll for result: `pending | done | failed`

Authentication uses HMAC-SHA256 signatures with a 60-second replay window. The `/health` endpoint is unauthenticated and used by Azure App Service probes.

## Kill Switches

To disable a specific file format without redeployment, set the corresponding App Setting in the Azure Portal or via CLI:

| Environment variable | Effect |
|---|---|
| `PARSER_FORMAT_DISABLED_PDF=true` | Reject all PDF submissions |
| `PARSER_FORMAT_DISABLED_DOCX=true` | Reject all .docx submissions |
| `PARSER_FORMAT_DISABLED_DOC=true` | Reject all legacy .doc submissions |
| `PARSER_FORMAT_DISABLED_PPTX=true` | Reject all .pptx submissions |
| `PARSER_FORMAT_DISABLED_PPT=true` | Reject all legacy .ppt submissions |
| `PARSER_FORMAT_DISABLED_RTF=true` | Reject all .rtf submissions |
| `PARSER_FORMAT_DISABLED_ODT=true` | Reject all .odt submissions |
| `PARSER_FORMAT_DISABLED_ODP=true` | Reject all .odp submissions |
| `PARSER_FORMAT_DISABLED_ODS=true` | Reject all .ods submissions |

Rejected jobs emit a `parser_outcome` log event with `status: "policy_rejected"` and `error: "format_disabled"`.

## Structured Outcome Events

Every job completion emits a JSON log line to stdout:

```json
{
  "event": "parser_outcome",
  "jobId": "<uuid>",
  "format": "docx",
  "fileName": "lecture-notes.docx",
  "status": "accepted",
  "durationMs": 412,
  "fileBytes": 204800
}
```

Possible `status` values:

| Status | Meaning |
|---|---|
| `accepted` | Text extracted successfully |
| `policy_rejected` | Magic bytes mismatch, invalid ZIP structure, kill switch, or unsupported format |
| `resource_limit_exceeded` | File exceeds the 2 MB limit |
| `timeout` | Legacy `.doc`/`.ppt` parser exceeded 30-second limit |
| `parser_failed` | Unexpected extraction error |

Failed jobs also include an `error` field with a short description.

## Preflight Checks

Before extraction, every file passes two automatic checks:

1. **Magic bytes signature** — the first 4 bytes must match the declared format. A `.docx` renamed to `.pdf` will be rejected with `policy_rejected`.
2. **OOXML ZIP structure** (`.docx`, `.pptx`, `.odt`, `.odp`, `.ods`) — the ZIP end-of-central-directory record must be present. Truncated or corrupt archives are rejected before any parsing attempt.

Legacy formats (`.doc`, `.ppt`) use OLE2 magic bytes (`D0 CF 11 E0`) and a 30-second parse timeout.

## Health Check

```
GET https://<parser-app-name>.azurewebsites.net/health
```

Returns `{ "status": "ok", "role": "parser", "jobs": <current_count> }`.

If the health check fails:
1. Check App Service → Log stream for startup errors.
2. Verify `PARSER_WORKER_AUTH_KEY` is set in App Settings.
3. Confirm the deployment zip was deployed to the correct app: `az webapp deployment show --name <parser-app-name> --resource-group <rg>`.

## Restarting the Parser App

```bash
az webapp restart --name <parser-app-name> --resource-group <resource-group>
```

Restarting drops all in-flight jobs. The web app will receive `job_not_found` on its next poll and surface an error to the user. In-progress uploads must be retried.

## Rotating the Auth Key

1. Generate a new key: `openssl rand -hex 32`
2. Update the GitHub secret `PARSER_WORKER_AUTH_KEY` for the target environment.
3. Update the Key Vault secret `PARSER-WORKER-AUTH-KEY` and the `PARSER_WORKER_AUTH_KEY` App Setting on both the web app and the parser app.
4. Restart all three apps (web, worker, parser) within the same maintenance window to avoid auth failures.
