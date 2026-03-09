import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "./env.js";

const mockRoleSchema = z.enum([
  "PARTICIPANT",
  "APPEAL_HANDLER",
  "ADMINISTRATOR",
  "REVIEWER",
  "REPORT_READER",
  "SUBJECT_MATTER_OWNER",
]);

const consoleIdentitySchema = z.object({
  userId: z.string().trim().min(1),
  email: z.string().trim().email(),
  name: z.string().trim().min(1),
  department: z.string().trim().min(1),
  roles: z.array(mockRoleSchema).min(1),
});

const participantConsoleConfigSchema = z.object({
  mockRolePresets: z.array(mockRoleSchema).min(1),
  drafts: z.object({
    storageKey: z.string().trim().min(1),
    ttlMinutes: z.number().int().positive(),
    maxModules: z.number().int().positive().max(200),
  }),
  appealWorkspace: z.object({
    availableStatuses: z
      .array(z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"]))
      .min(1),
    defaultStatuses: z
      .array(z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"]))
      .min(1),
    queuePageSize: z.number().int().min(1).max(200).default(50),
  }),
  flow: z.object({
    autoStartAfterMcq: z.boolean().default(true),
    pollIntervalSeconds: z.number().int().min(1).max(30).default(2),
    maxWaitSeconds: z.number().int().min(5).max(600).default(90),
  }),
  identityDefaults: z
    .object({
      participant: consoleIdentitySchema,
      appealHandler: consoleIdentitySchema,
    })
    .optional(),
});

type ParticipantConsoleConfig = z.infer<typeof participantConsoleConfigSchema>;

export type ParticipantConsoleRuntimeConfig = {
  authMode: "mock" | "entra";
  mockRoleSwitchEnabled: boolean;
  mockRolePresets: ParticipantConsoleConfig["mockRolePresets"];
  drafts: ParticipantConsoleConfig["drafts"];
  appealWorkspace: ParticipantConsoleConfig["appealWorkspace"];
  flow: ParticipantConsoleConfig["flow"];
  identityDefaults?: ParticipantConsoleConfig["identityDefaults"];
};

let cached: ParticipantConsoleConfig | null = null;

function getParticipantConsoleConfig(): ParticipantConsoleConfig {
  if (cached) {
    return cached;
  }

  const configPath = path.resolve(process.cwd(), env.PARTICIPANT_CONSOLE_CONFIG_FILE);
  const raw = fs.readFileSync(configPath, "utf8");
  cached = participantConsoleConfigSchema.parse(JSON.parse(raw));
  return cached;
}

export function getParticipantConsoleRuntimeConfig(): ParticipantConsoleRuntimeConfig {
  const config = getParticipantConsoleConfig();
  return {
    authMode: env.AUTH_MODE,
    mockRoleSwitchEnabled: env.AUTH_MODE === "mock",
    mockRolePresets: config.mockRolePresets,
    drafts: config.drafts,
    appealWorkspace: config.appealWorkspace,
    flow: config.flow,
    identityDefaults: config.identityDefaults,
  };
}

export function resetParticipantConsoleConfigCacheForTests() {
  cached = null;
}
