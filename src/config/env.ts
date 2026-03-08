import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  AUTH_MODE: z.enum(["mock", "entra"]).default("mock"),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_AUDIENCE: z.string().optional(),
  MOCK_DEFAULT_USER_ID: z.string().default("dev-user-1"),
  MOCK_DEFAULT_EMAIL: z.string().email().default("dev.user@company.com"),
  MOCK_DEFAULT_NAME: z.string().default("Dev User"),
  MOCK_DEFAULT_DEPARTMENT: z.string().default("Technology"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

if (env.AUTH_MODE === "entra" && (!env.ENTRA_TENANT_ID || !env.ENTRA_AUDIENCE)) {
  console.error("ENTRA_TENANT_ID and ENTRA_AUDIENCE are required when AUTH_MODE=entra");
  process.exit(1);
}

export { env };

