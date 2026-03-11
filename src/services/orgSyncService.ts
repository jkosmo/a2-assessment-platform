import { randomUUID } from "node:crypto";
import { getOrgSyncConfig } from "../config/orgSync.js";
import { ConflictError } from "../errors/AppError.js";
import { logOperationalEvent } from "../observability/operationalLog.js";
import {
  createUserForOrgSync,
  findUserForOrgSyncByEmail,
  findUserForOrgSyncByExternalId,
  updateUserForOrgSync,
} from "../repositories/userRepository.js";
import { recordAuditEvent } from "./auditService.js";

type OrgSyncDeltaRecord = {
  externalId: string;
  email: string;
  name: string;
  department?: string | null;
  manager?: string | null;
  activeStatus?: boolean;
};

type ApplyOrgDeltaSyncInput = {
  source: string;
  users: OrgSyncDeltaRecord[];
  actorId: string;
};

export async function applyOrgDeltaSync(input: ApplyOrgDeltaSyncInput) {
  const config = getOrgSyncConfig();
  const runId = randomUUID();
  const startedAt = new Date();

  let createdCount = 0;
  let updatedCount = 0;
  let skippedConflictCount = 0;
  let failedCount = 0;
  const errors: Array<{ externalId: string; email: string; reason: string }> = [];

  logOperationalEvent("org_sync_delta_started", {
    runId,
    source: input.source,
    userCount: input.users.length,
    conflictStrategy: config.conflictStrategy,
  });

  for (const record of input.users) {
    try {
      const outcome = await syncSingleUser(record, config);
      if (outcome === "created") {
        createdCount += 1;
      } else if (outcome === "updated") {
        updatedCount += 1;
      } else {
        skippedConflictCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      const reason = error instanceof Error ? error.message : "org_sync_user_failed";
      errors.push({
        externalId: record.externalId,
        email: record.email,
        reason,
      });
      logOperationalEvent(
        "org_sync_delta_failed_record",
        {
          runId,
          source: input.source,
          externalId: record.externalId,
          email: record.email,
          reason,
        },
        "error",
      );
      await recordAuditEvent({
        entityType: "org_sync",
        entityId: runId,
        action: "org_sync_record_failed",
        actorId: input.actorId,
        metadata: {
          source: input.source,
          externalId: record.externalId,
          email: record.email,
          reason,
        },
      });
    }
  }

  const completedAt = new Date();
  const summary = {
    runId,
    source: input.source,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    userCount: input.users.length,
    createdCount,
    updatedCount,
    skippedConflictCount,
    failedCount,
    errors,
  };

  await recordAuditEvent({
    entityType: "org_sync",
    entityId: runId,
    action: "org_sync_completed",
    actorId: input.actorId,
    metadata: {
      ...summary,
    },
  });

  logOperationalEvent("org_sync_delta_completed", summary, failedCount > 0 ? "error" : "info");

  return summary;
}

async function syncSingleUser(
  record: OrgSyncDeltaRecord,
  config: ReturnType<typeof getOrgSyncConfig>,
): Promise<"created" | "updated" | "skipped_conflict"> {
  const existingByExternalId = await findUserForOrgSyncByExternalId(record.externalId);

  const existingByEmail = await findUserForOrgSyncByEmail(record.email);

  if (existingByExternalId) {
    if (existingByEmail && existingByEmail.id !== existingByExternalId.id) {
      if (config.conflictStrategy === "skip_conflict") {
        return "skipped_conflict";
      }
      throw new ConflictError(
        "email_conflict_with_different_external_id",
        "Email conflicts with a different external ID.",
      );
    }

    await updateUserForOrgSync(
      existingByExternalId.id,
      buildUserUpdateData(record, config, existingByExternalId),
    );
    return "updated";
  }

  if (existingByEmail) {
    if (config.conflictStrategy === "skip_conflict") {
      return "skipped_conflict";
    }

    await updateUserForOrgSync(existingByEmail.id, {
        externalId: record.externalId,
        ...buildUserUpdateData(record, config, existingByEmail),
    });
    return "updated";
  }

  await createUserForOrgSync({
    externalId: record.externalId,
    email: record.email,
    name: record.name,
    department: record.department ?? null,
    manager: record.manager ?? null,
    activeStatus: record.activeStatus ?? config.defaultActiveStatus,
  });
  return "created";
}

function buildUserUpdateData(
  record: OrgSyncDeltaRecord,
  config: ReturnType<typeof getOrgSyncConfig>,
  existing: {
    name: string;
    email: string;
    department: string | null;
    manager: string | null;
    activeStatus: boolean;
  },
) {
  return {
    email: record.email,
    name: record.name || existing.name,
    department: config.allowDepartmentOverwrite ? record.department ?? null : existing.department,
    manager: config.allowManagerOverwrite ? record.manager ?? null : existing.manager,
    activeStatus: record.activeStatus ?? existing.activeStatus,
  };
}
