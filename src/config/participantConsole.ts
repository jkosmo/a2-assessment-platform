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
const submissionStatusSchema = z.enum([
  "SUBMITTED",
  "PROCESSING",
  "SCORED",
  "UNDER_REVIEW",
  "COMPLETED",
  "REJECTED",
]);

const consoleIdentitySchema = z.object({
  userId: z.string().trim().min(1),
  email: z.string().trim().email(),
  name: z.string().trim().min(1),
  department: z.string().trim().min(1),
  roles: z.array(mockRoleSchema).min(1),
});

const workspaceNavigationItemSchema = z.object({
  id: z.string().trim().min(1),
  path: z.string().trim().min(1).regex(/^\//, "Navigation path must start with '/'."),
  labelKey: z.string().trim().min(1),
  requiredRoles: z.array(mockRoleSchema).default([]),
});

const participantConsoleConfigSchema = z.object({
  mockRolePresets: z.array(mockRoleSchema).min(1),
  navigation: z.object({
    items: z.array(workspaceNavigationItemSchema).min(1),
  }),
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
  manualReviewWorkspace: z.object({
    availableStatuses: z.array(z.enum(["OPEN", "IN_REVIEW", "RESOLVED"])).min(1),
    defaultStatuses: z.array(z.enum(["OPEN", "IN_REVIEW", "RESOLVED"])).min(1),
    queuePageSize: z.number().int().min(1).max(200).default(50),
  }),
  flow: z.object({
    autoStartAfterMcq: z.boolean().default(true),
    pollIntervalSeconds: z.number().int().min(1).max(30).default(2),
    maxWaitSeconds: z.number().int().min(5).max(600).default(90),
  }),
  calibrationWorkspace: z.object({
    accessRoles: z.array(mockRoleSchema).min(1),
    defaults: z.object({
      statuses: z.array(submissionStatusSchema).min(1),
      lookbackDays: z.number().int().min(1).max(365).default(90),
      maxRows: z.number().int().min(10).max(500).default(200),
    }),
    signalThresholds: z.object({
      passRateMinimum: z.number().min(0).max(1).default(0.6),
      manualReviewRateMaximum: z.number().min(0).max(1).default(0.35),
      benchmarkCoverageMinimum: z.number().min(0).max(1).default(0.5),
    }),
  }),
  identityDefaults: z
    .object({
      participant: consoleIdentitySchema,
      appealHandler: consoleIdentitySchema,
      reviewer: consoleIdentitySchema.optional(),
      calibrationOwner: consoleIdentitySchema.optional(),
      contentAdmin: consoleIdentitySchema.optional(),
    })
    .optional(),
});

type ParticipantConsoleConfig = z.infer<typeof participantConsoleConfigSchema>;

export type ParticipantConsoleRuntimeConfig = {
  authMode: "mock" | "entra";
  debugMode: boolean;
  mockRoleSwitchEnabled: boolean;
  mockRolePresets: ParticipantConsoleConfig["mockRolePresets"];
  navigation: ParticipantConsoleConfig["navigation"];
  drafts: ParticipantConsoleConfig["drafts"];
  appealWorkspace: ParticipantConsoleConfig["appealWorkspace"];
  manualReviewWorkspace: ParticipantConsoleConfig["manualReviewWorkspace"];
  flow: ParticipantConsoleConfig["flow"];
  calibrationWorkspace: ParticipantConsoleConfig["calibrationWorkspace"];
  identityDefaults?: ParticipantConsoleConfig["identityDefaults"];
};

let cached: ParticipantConsoleConfig | null = null;

function resolveParticipantConsoleDebugMode() {
  if (env.PARTICIPANT_CONSOLE_DEBUG_MODE === "true") {
    return true;
  }
  if (env.PARTICIPANT_CONSOLE_DEBUG_MODE === "false") {
    return false;
  }
  return env.NODE_ENV !== "production";
}

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
    debugMode: resolveParticipantConsoleDebugMode(),
    mockRoleSwitchEnabled: env.AUTH_MODE === "mock",
    mockRolePresets: config.mockRolePresets,
    navigation: config.navigation,
    drafts: config.drafts,
    appealWorkspace: config.appealWorkspace,
    manualReviewWorkspace: config.manualReviewWorkspace,
    flow: config.flow,
    calibrationWorkspace: config.calibrationWorkspace,
    identityDefaults: config.identityDefaults,
  };
}

export function resetParticipantConsoleConfigCacheForTests() {
  cached = null;
}
