import { NotFoundError } from "../../errors/AppError.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import { createCertificationRepository } from "./certificationRepository.js";
import { recordModulePassFromDecision } from "./modulePass.js";
import { createDecisionRepository } from "../../repositories/decisionRepository.js";
import { recordAuditEvent } from "../../services/auditService.js";
import type { LearnerTx } from "../../db/contentLock.js";

// #989 (produkteier 2026-08-22): en bestått modul gjelder til den revideres. Ingen utløpsdato, ingen
// resertifisering. Denne fila het `recertificationService.ts` og regnet ut `expiryDate` +
// `recertificationDueDate` fra en GLOBAL `validityDays` — og porten for kursbevis telte likevel
// `EXPIRED` som bestått, så utregningen hadde ingen konsekvens. Det som er igjen er det som faktisk
// bestemte noe: skriv ACTIVE eller NOT_CERTIFIED, og ta vare på `passedAt`.
//
// Kursfrister (`CourseEnrollment.dueAt`) er noe annet og er urørt — en frist for å bli ferdig, ikke
// en utløpsdato på kunnskap.

// De to tilstandene som faktisk skrives. Prisma-enumen `CertificationLifecycleStatus` har fortsatt
// DUE_SOON/DUE/EXPIRED (expand/contract — historiske rader beholder verdiene sine), men ingenting
// skriver dem lenger.
export type CertificationStatusOutcome = "ACTIVE" | "NOT_CERTIFIED";

type UpsertFromDecisionInput = {
  decisionId: string;
  actorId?: string | null;
};

// #934 skive 5a-1: transaksjonen er PÅKREVD og holder deltakerlåsen. Alle vedtak går hit, i samme transaksjon som
// vedtaket, så et kursbevis aldri leser raden midt i en anke.
export async function upsertCertificationStatusFromDecision(input: UpsertFromDecisionInput, tx: LearnerTx) {
  const decisionRepo = createDecisionRepository(tx);
  const certRepo = createCertificationRepository(tx);

  const decision = await decisionRepo.findDecisionWithSubmissionIdentifiers(input.decisionId);

  if (!decision) {
    throw new NotFoundError("Decision", "decision_not_found", "Decision not found.");
  }

  const userId = decision.submission.userId;
  const moduleId = decision.submission.moduleId;

  // #934 skive 5a-2: raden per innlevering, ved siden av statusen. Her, før vakta under: den returnerer tidlig, og et stryk på
  // samme innlevering skal likevel ta bort beståtten i den nye regelen. `CertificationStatus` skrives som før.
  await recordModulePassFromDecision(tx, decision);

  let status: CertificationStatusOutcome;
  let passedAt: Date | null = null;

  if (decision.passFailTotal) {
    passedAt = decision.finalisedAt;
    status = "ACTIVE";
  } else {
    // Guard: do not overwrite a passing certification established by a newer submission.
    // This prevents a late-resolving manual review FAIL on submission N from downgrading
    // a certification that was earned by submission M > N.
    const existing = await certRepo.findByUserAndModule(userId, moduleId);
    if (existing?.passedAt && existing.passedAt > decision.submission.submittedAt) {
      logOperationalEvent(operationalEvents.certification.certificationDowngradeSkipped, {
        userId,
        moduleId,
        decisionId: decision.id,
        existingPassedAt: existing.passedAt.toISOString(),
        decisionSubmittedAt: decision.submission.submittedAt.toISOString(),
      });
      return existing;
    }
    status = "NOT_CERTIFIED";
  }

  const certification = await certRepo.upsertCertificationStatus(tx, {
    userId,
    moduleId,
    latestDecisionId: decision.id,
    status,
    passedAt,
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.certificationStatus,
    entityId: certification.id,
    // Handlingsnavnet `recertification_status_upserted` er en PERSISTERT verdi — det står på rader i
    // AuditEvent og i retensjonsfilteret. Det beholdes selv om begrepet er borte (#989).
    action: auditActions.certification.recertificationStatusUpserted,
    actorId: input.actorId ?? undefined,
    metadata: {
      userId,
      moduleId,
      decisionId: decision.id,
      status,
      passedAt: passedAt?.toISOString() ?? null,
    },
  }, tx);

  return certification;
}
