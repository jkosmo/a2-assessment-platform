import "dotenv/config";
import { z } from "zod";

// Bundled-secrets path: one KV ref `APP_RUNTIME_SECRETS` containing JSON of all sensitive
// values. Parsed into process.env BEFORE zod validation. Saves ~1.5-2.5 min on cold start
// by reducing Key Vault references from 5+ to 1 (MSI sidecar fetches in parallel less
// efficiently on B1 shared CPU). See #431.
//
// Falls back gracefully:
// - If APP_RUNTIME_SECRETS is unset or invalid JSON, we leave process.env unchanged and
//   zod will validate against whatever individual env vars are present.
// - Individual env vars (DATABASE_URL etc) already set take precedence over bundled values.
//   This lets us roll out incrementally: add bundled secret first (no behavior change),
//   then remove individual KV refs in a follow-up deploy.
const bundledSecretsRaw = process.env.APP_RUNTIME_SECRETS;
if (bundledSecretsRaw && bundledSecretsRaw.trim().length > 0) {
  try {
    const parsed = JSON.parse(bundledSecretsRaw) as Record<string, string>;
    let appliedCount = 0;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.length > 0 && !process.env[key]) {
        process.env[key] = value;
        appliedCount += 1;
      }
    }
    console.log(`Loaded ${appliedCount} secrets from APP_RUNTIME_SECRETS bundle.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Failed to parse APP_RUNTIME_SECRETS JSON: ${message}. Falling back to individual env vars.`);
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PROCESS_ROLE: z.enum(["web", "worker", "all"]).default("all"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  AUTH_MODE: z.enum(["mock", "entra"]).default("mock"),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_AUDIENCE: z.string().optional(),
  ENTRA_GROUP_ROLE_MAP_JSON: z.string().default("{}"),
  ENTRA_GROUP_ROLE_MAP_FILE: z.string().optional(),
  ENTRA_SYNC_GROUP_ROLES: z
    .string()
    .transform((value) => value.toLowerCase() === "true")
    .default("false"),
  // #495-follow-up: når true (default) når deltakere moduler KUN gjennom kurs — den frittstående
  // modul-lista og -innleveringen er gated av. Modul forblir authoring/vurderings-primitivet; dette
  // begrenser kun deltaker-overflaten. SMO/ADMIN er unntatt. Sett "false" for å gjenåpne frittstående.
  PARTICIPANT_COURSE_ONLY: z
    .string()
    .transform((value) => value.toLowerCase() === "true")
    .default("true"),
  // #690: Entra security/M365 group whose members are imported into the platform as users
  // (e.g. "Alle i A-2 Norge"). When set, an admin can run a Graph-backed sync that upserts these
  // users so they are searchable/assignable before their first login. Requires the app's managed
  // identity to hold the Graph application permission GroupMember.Read.All (+ User.Read.All).
  ENTRA_USER_SYNC_GROUP_ID: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().optional(),
  ),
  // #690: how often the scheduled Entra user sync runs (worker). Default 24h. Only active when
  // ENTRA_USER_SYNC_GROUP_ID is set.
  ENTRA_USER_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(86_400_000),
  // #812: per-request deadline for Microsoft Graph calls (token + group-member pages). Node's fetch has
  // no default timeout, so a hung Graph response would wedge the Entra sync tick. Idempotent GETs, so
  // the fetch is retried with backoff on timeout/5xx/429.
  ENTRA_GRAPH_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  MOCK_DEFAULT_USER_ID: z.string().default("dev-user-1"),
  MOCK_DEFAULT_EMAIL: z.string().email().default("dev.user@company.com"),
  MOCK_DEFAULT_NAME: z.string().default("Dev User"),
  MOCK_DEFAULT_DEPARTMENT: z.string().default("Technology"),
  DEFAULT_LOCALE: z.enum(["en-GB", "nb", "nn"]).default("en-GB"),
  LLM_MODE: z.enum(["stub", "azure_openai"]).default("stub"),
  LLM_STUB_MODEL_NAME: z.string().default("stub-model-v1"),
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional().transform((v) => v?.replace(/^﻿/, "")),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
  AZURE_OPENAI_AUTHORING_DEPLOYMENT: z.string().optional(),
  AZURE_OPENAI_ASSESSMENT_DEPLOYMENT: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().default("2024-10-21"),
  AZURE_OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  AZURE_OPENAI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  AZURE_OPENAI_AUTHORING_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  AZURE_OPENAI_ASSESSMENT_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  AZURE_OPENAI_MAX_TOKENS: z.coerce.number().int().positive().default(1200),
  AZURE_OPENAI_TOKEN_LIMIT_PARAMETER: z
    .enum(["max_tokens", "max_completion_tokens", "auto"])
    .default("auto"),
  AZURE_OPENAI_AUTHORING_TOKEN_LIMIT_PARAMETER: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.enum(["max_tokens", "max_completion_tokens", "auto"]).optional(),
  ),
  APPEAL_FIRST_RESPONSE_SLA_HOURS: z.coerce.number().positive().default(24),
  APPEAL_RESOLUTION_SLA_HOURS: z.coerce.number().positive().default(72),
  APPEAL_AT_RISK_RATIO: z.coerce.number().positive().max(1).default(0.75),
  APPEAL_SLA_MONITOR_INTERVAL_MS: z.coerce.number().int().positive().default(600000),
  APPEAL_OVERDUE_ALERT_THRESHOLD: z.coerce.number().int().positive().default(1),
  PARTICIPANT_NOTIFICATION_CHANNEL: z.enum(["disabled", "log", "webhook", "acs_email"]).default("log"),
  PARTICIPANT_NOTIFICATION_WEBHOOK_URL: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().url().optional(),
  ),
  PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  // #812: deadline for an ACS email send (beginSend + pollUntilDone). Without it a slow/unresponsive
  // ACS could block a worker tick (course reminders, recert, appeal SLA) indefinitely → wedged loop.
  ACS_EMAIL_SEND_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  // #497: daglig bakgrunnsjobb for kurs-frist-påminnelser. Kjører kun i worker-rollen når
  // varselkanalen er aktiv (PARTICIPANT_NOTIFICATION_CHANNEL !== "disabled").
  COURSE_REMINDER_INTERVAL_MS: z.coerce.number().int().positive().default(86_400_000),
  // #497-incident: ms mellom oppstart av hver bakgrunns-monitor i worker-rollen, slik at deres
  // første DB-spørring ikke treffer samtidig (unngår connection-pool-storm ved oppstart). 0 = ingen
  // spredning (start alle samtidig).
  WORKER_STARTUP_STAGGER_MS: z.coerce.number().int().min(0).default(3000),
  AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().optional(),
  ),
  ACS_EMAIL_SENDER: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().optional(),
  ),
  ACS_EMAIL_SENDER_DISPLAY_NAME: z.string().default("A2 Assessment Platform"),
  PARTICIPANT_CONSOLE_CONFIG_FILE: z.string().default("config/participant-console.json"),
  PARTICIPANT_CONSOLE_DEBUG_MODE: z.enum(["auto", "true", "false"]).default("auto"),
  ASSESSMENT_RULES_FILE: z.string().default("config/assessment-rules.json"),
  // #475 Phase 2: per-environment override of the content-similarity signal, so it can be enabled on a
  // single environment (e.g. staging) without touching the shared rules file (which would also affect
  // prod + the test suite). Tri-state: unset = use the rules file; "true"/"false" = override.
  AI_CONTENT_SIMILARITY_ENABLED: z.enum(["true", "false"]).optional(),
  AI_CONTENT_SIMILARITY_SHADOW: z.enum(["true", "false"]).optional(),
  ASSESSMENT_JOB_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(4000),
  // #953 (produkteier 2026-08-26): «vurdering skal kunne kjøre offline, og bruker varsles per e-post
  // senere om resultat. Derfor vil jeg ved avvik avvente noen minutter for å se om det er LLM-tjenesten
  // som har problem, og så prøve på nytt igjen.»
  //
  // ⚠️ Sto tidligere på 3 forsøk med FAST 30 sekunders venting. Hele gjenforsøksvinduet var da under
  // ett minutt: en LLM-nedetid på to minutter brukte opp alle forsøkene, jobben ble FAILED, og
  // innleveringen ble stående i PROCESSING for alltid. Det er #953-scenarioet, og det oppsto ikke
  // fordi gjenforsøk manglet — men fordi de var for tette til å overleve en hikke.
  //
  // 6 forsøk med eksponentiell venting fra ett minutt (1+2+4+8+16 = 31 min) dekker en realistisk
  // nedetid uten å holde en genuint ødelagt innlevering i live i det uendelige.
  ASSESSMENT_JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(6),
  ASSESSMENT_JOB_RETRY_BASE_MS: z.coerce.number().int().positive().default(60_000),
  ASSESSMENT_JOB_RETRY_CAP_MS: z.coerce.number().int().positive().default(1_800_000),
  ASSESSMENT_JOB_LEASE_DURATION_MS: z.coerce.number().int().positive().default(300000),
  // #856: hard wall-clock cap on a single job's in-process execution. The #792 lease heartbeat renews a
  // running job's lease forever, so without this an in-process-stuck job (a DB lock-wait, not the LLM —
  // that self-aborts at AZURE_OPENAI_TIMEOUT_MS) never returns and wedges the worker. Must exceed the
  // worst-case legit assessment (primary + secondary LLM ≈ 2 × AZURE_OPENAI_TIMEOUT_MS + overhead). At
  // the deadline the runner fails/retries the job (fenced) so the tick returns instead of wedging.
  ASSESSMENT_JOB_MAX_RUNTIME_MS: z.coerce.number().int().positive().default(300000),
  ASSESSMENT_JOB_STUCK_THRESHOLD_MS: z.coerce.number().int().positive().default(600000),
  // #953 (produkteier 2026-08-26): «Hvis mange vurderinger begynner å hope seg opp bør
  // administrator varsles.» Terskelen er 3 fordi ÉN feilet vurdering er en enkeltsak — det er
  // opphopningen som betyr at tjenesten er nede.
  //
  // ⚠️ Karenstiden er ikke pynt. Når LLM-tjenesten er nede feiler alt samtidig, så uten et tak
  // ville hver innlevering gitt sin egen e-post. Det er nøyaktig støyen som får folk til å
  // filtrere bort varselet — og da er varselet verre enn ingenting.
  ASSESSMENT_FAILED_ALERT_THRESHOLD: z.coerce.number().int().positive().default(3),
  ASSESSMENT_FAILED_ALERT_COOLDOWN_MS: z.coerce.number().int().positive().default(86_400_000),
  // #866: Postgres session timeouts applied ONLY to the dedicated worker container's DB connections
  // (PROCESS_ROLE=worker). A worker's first tick query (stale-lock scan / outbox claim) can block on a
  // row lock held by a zombie `idle in transaction` connection from an abruptly-killed pre-deploy
  // container, wedging /healthz for ~10–20 min. lock_timeout aborts a query that waits too long for a
  // lock (the wedge); statement_timeout is the outer safety net for any single statement. On abort the
  // tick fails+retries instead of hanging, so the worker self-heals without a manual restart. Web
  // (PROCESS_ROLE=web) and all-in-one dev/test (all) connections are unaffected.
  WORKER_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  WORKER_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  // #795: outbox delivery worker cadence + lease.
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  OUTBOX_LEASE_DURATION_MS: z.coerce.number().int().positive().default(60000),
  // #795-followup: per-delivery wall-clock cap. A hung handler (e.g. an ACS email call with no timeout)
  // would otherwise wedge the worker's tick forever (no return). On timeout the delivery is abandoned and
  // the row is retried; idempotent handlers make a later completion of the abandoned call safe.
  OUTBOX_DELIVERY_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  PARSER_WORKER_URL: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().url().optional(),
  ),
  PARSER_WORKER_AUTH_KEY: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().optional(),
  ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;
const isAzureAppServiceRuntime = Boolean(process.env.WEBSITE_SITE_NAME || process.env.WEBSITE_INSTANCE_ID);
const isMockAuthRuntimeAllowed =
  env.NODE_ENV === "test" || (env.NODE_ENV === "development" && !isAzureAppServiceRuntime);

if (env.AUTH_MODE === "mock" && !isMockAuthRuntimeAllowed) {
  console.error("AUTH_MODE=mock is only allowed for local development and automated tests.");
  process.exit(1);
}

if (env.AUTH_MODE === "entra" && (!env.ENTRA_TENANT_ID || !env.ENTRA_CLIENT_ID || !env.ENTRA_AUDIENCE)) {
  console.error("ENTRA_TENANT_ID, ENTRA_CLIENT_ID and ENTRA_AUDIENCE are required when AUTH_MODE=entra");
  process.exit(1);
}

if (
  env.LLM_MODE === "azure_openai" &&
  (!env.AZURE_OPENAI_ENDPOINT || !env.AZURE_OPENAI_API_KEY || !env.AZURE_OPENAI_DEPLOYMENT)
) {
  console.error(
    "AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT are required when LLM_MODE=azure_openai",
  );
  process.exit(1);
}

if (env.PARTICIPANT_NOTIFICATION_CHANNEL === "webhook" && !env.PARTICIPANT_NOTIFICATION_WEBHOOK_URL) {
  console.error("PARTICIPANT_NOTIFICATION_WEBHOOK_URL is required when PARTICIPANT_NOTIFICATION_CHANNEL=webhook");
  process.exit(1);
}

if (
  env.PARTICIPANT_NOTIFICATION_CHANNEL === "acs_email" &&
  (!env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING || !env.ACS_EMAIL_SENDER)
) {
  // Warn but do not crash. On Azure App Service the MSI sidecar resolves KV
  // references asynchronously — if Node.js starts before the sidecar finishes,
  // ACS_CONNECTION_STRING is temporarily empty. Crashing here caused a 3-second
  // boot loop on every deploy. ACS sending will fail gracefully at runtime if
  // the secret is genuinely missing.
  console.warn(
    "WARNING: PARTICIPANT_NOTIFICATION_CHANNEL=acs_email but AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING or ACS_EMAIL_SENDER is missing. Email sending will fail until secrets are resolved.",
  );
}

if (env.PARSER_WORKER_URL && !env.PARSER_WORKER_AUTH_KEY) {
  console.error("PARSER_WORKER_AUTH_KEY is required when PARSER_WORKER_URL is set");
  process.exit(1);
}

export { env, isMockAuthRuntimeAllowed };
