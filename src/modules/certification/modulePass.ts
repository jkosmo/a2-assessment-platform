// #934 skive 5a-2 (doc/DESIGN_934.md, «5a»): beståtte per innlevering, ved siden av `CertificationStatus`.
//
// Ingen leser fremdrift herfra før 5a-3. Regelen, som den slås på da:
//   - en bestått står til modulen revideres. Et stryk på en ANNEN innlevering rører den ikke (produkteier 2026-11-03, svar f);
//   - et senere vedtak på SAMME innlevering som stryker (overprøving eller anke), tar den bort;
//   - versjonen er den vedtaket ble fattet på. Tidspunktet spiller ingen rolle.
import type { LearnerTx } from "../../db/contentLock.js";

/** Skriver raden for ett vedtak. Kalles bare fra `upsertCertificationStatusFromDecision`, der alle vedtak går gjennom. */
export async function recordModulePassFromDecision(
  locked: LearnerTx,
  decision: {
    id: string;
    submissionId: string;
    moduleVersionId: string;
    passFailTotal: boolean;
    finalisedAt: Date;
    submission: { userId: string; moduleId: string };
  },
): Promise<void> {
  if (!decision.passFailTotal) {
    await locked.modulePass.deleteMany({ where: { submissionId: decision.submissionId } });
    return;
  }
  const row = {
    decisionId: decision.id,
    moduleVersionId: decision.moduleVersionId,
    passedAt: decision.finalisedAt,
  };
  await locked.modulePass.upsert({
    where: { submissionId: decision.submissionId },
    // `invalidatedAt` står bare for vedtak fattet før en revisjon. Dette vedtaket er fattet nå, så det tas bort, slik en ny
    // kjøring av tilbakefyllingen ville gjort.
    update: { ...row, invalidatedAt: null },
    create: { ...row, submissionId: decision.submissionId, userId: decision.submission.userId, moduleId: decision.submission.moduleId },
  });
}
