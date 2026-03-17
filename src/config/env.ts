import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
  MOCK_DEFAULT_USER_ID: z.string().default("dev-user-1"),
  MOCK_DEFAULT_EMAIL: z.string().email().default("dev.user@company.com"),
  MOCK_DEFAULT_NAME: z.string().default("Dev User"),
  MOCK_DEFAULT_DEPARTMENT: z.string().default("Technology"),
  DEFAULT_LOCALE: z.enum(["en-GB", "nb", "nn"]).default("en-GB"),
  LLM_MODE: z.enum(["stub", "azure_openai"]).default("stub"),
  LLM_STUB_MODEL_NAME: z.string().default("stub-model-v1"),
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().default("2024-10-21"),
  AZURE_OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  AZURE_OPENAI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  AZURE_OPENAI_MAX_TOKENS: z.coerce.number().int().positive().default(1200),
  AZURE_OPENAI_TOKEN_LIMIT_PARAMETER: z
    .enum(["max_tokens", "max_completion_tokens", "auto"])
    .default("auto"),
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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

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
  console.error(
    "AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING and ACS_EMAIL_SENDER are required when PARTICIPANT_NOTIFICATION_CHANNEL=acs_email",
  );
  process.exit(1);
}

export { env };
