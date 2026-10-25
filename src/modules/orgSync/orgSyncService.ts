import { randomUUID } from "node:crypto";
import { getOrgSyncConfig } from "../../config/orgSync.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import {
  createUserForOrgSync,
  findUserForOrgSyncByEmail,
  findUserForOrgSyncByExternalId,
  updateUserForOrgSync,
} from "../../repositories/userRepository.js";
import { recordAuditEvent } from "../../services/auditService.js";

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
  let skippedAnonymizedCount = 0;
  let failedCount = 0;
  const errors: Array<{ externalId: string; email: string; reason: string }> = [];
  // #1114: hvem som ble hoppet over fordi e-posten tilhører en annen bruker — administrator må kunne se
  // det. De pseudonymiserte telles bare; navn og e-post på dem skal ikke fram igjen.
  const conflicts: Array<{ externalId: string; email: string }> = [];

  logOperationalEvent(operationalEvents.orgSync.deltaStarted, {
    runId,
    source: input.source,
    userCount: input.users.length,
  });

  for (const record of input.users) {
    try {
      const outcome = await syncSingleUser(record, config);
      if (outcome === "created") {
        createdCount += 1;
      } else if (outcome === "updated") {
        updatedCount += 1;
      } else if (outcome === "skipped_anonymized") {
        skippedAnonymizedCount += 1;
      } else {
        skippedConflictCount += 1;
        conflicts.push({ externalId: record.externalId, email: record.email });
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
        operationalEvents.orgSync.failedRecord,
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
        entityType: auditEntityTypes.orgSync,
        entityId: runId,
        action: auditActions.orgSync.recordFailed,
        actorId: input.actorId,
        metadata: {
          // #806 (GDPR): externalId identifies the failed record without persisting the email into
          // indefinitely-retained audit metadata. (Email is still in the operational log above, which
          // has bounded retention.)
          source: input.source,
          externalId: record.externalId,
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
    skippedAnonymizedCount,
    failedCount,
    errors,
    conflicts,
  };

  await recordAuditEvent({
    entityType: auditEntityTypes.orgSync,
    entityId: runId,
    action: auditActions.orgSync.completed,
    actorId: input.actorId,
    // #806 (GDPR) / #1114: revisjonssporet beholdes for alltid, så e-post skal ikke dit. Konfliktene og
    // feilene står med externalId; e-posten finnes i svaret til administrator og i driftsloggen, som har
    // begrenset levetid.
    metadata: {
      ...summary,
      errors: summary.errors.map(({ externalId, reason }) => ({ externalId, reason })),
      conflicts: summary.conflicts.map(({ externalId }) => ({ externalId })),
    },
  });

  logOperationalEvent(
    operationalEvents.orgSync.deltaCompleted,
    summary,
    failedCount > 0 ? "error" : "info",
  );

  return summary;
}

/**
 * #1114: identitet kobles BARE på `externalId`, aldri på e-post — samme regel som innloggingen (#386).
 * Produkteier 2026-10-25: «e-postadresser skal ikke kobles. Det er grunnleggende, og med et firma av
 * vår størrelse er det på ingen måte nødvendig med gjenbruk.» En gjenbrukt eller endret adresse ville
 * ellers gitt én person en annens resultater og kursbevis.
 *
 *  - Samme `externalId`, men pseudonymisert: røres ikke. Navn og e-post skrives ikke tilbake.
 *  - Samme `externalId`: oppdateres — med mindre den nye e-posten tilhører en ANNEN bruker; da røres
 *    ingen av dem (konflikt).
 *  - Ingen med `externalId`, men en bruker med samme e-post: konflikt. Brukeren røres ikke, og det lages
 *    ingen ny (e-posten er unik). Administrator ser konflikten i rapporten.
 *  - Ingen av delene: ny bruker.
 */
async function syncSingleUser(
  record: OrgSyncDeltaRecord,
  config: ReturnType<typeof getOrgSyncConfig>,
): Promise<"created" | "updated" | "skipped_conflict" | "skipped_anonymized"> {
  const existingByExternalId = await findUserForOrgSyncByExternalId(record.externalId);
  if (existingByExternalId?.isAnonymized) return "skipped_anonymized";

  const existingByEmail = await findUserForOrgSyncByEmail(record.email);

  if (existingByExternalId) {
    if (existingByEmail && existingByEmail.id !== existingByExternalId.id) return "skipped_conflict";
    await updateUserForOrgSync(
      existingByExternalId.id,
      buildUserUpdateData(record, config, existingByExternalId),
    );
    return "updated";
  }

  if (existingByEmail) return "skipped_conflict";

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
