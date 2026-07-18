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
  // #497: daglig bakgrunnsjobb for kurs-frist-påminnelser. Kjører kun i worker-rollen når
  // varselkanalen er aktiv (PARTICIPANT_NOTIFICATION_CHANNEL !== "disabled").
  COURSE_REMINDER_INTERVAL_MS: z.coerce.number().int().positive().default(86_400_000),
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
  ASSESSMENT_JOB_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(4000),
  ASSESSMENT_JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  ASSESSMENT_JOB_LEASE_DURATION_MS: z.coerce.number().int().positive().default(300000),
  ASSESSMENT_JOB_STUCK_THRESHOLD_MS: z.coerce.number().int().positive().default(600000),
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
