import { prisma } from "../../src/db/prisma.js";
import { OUTBOX_EVENT_TYPES } from "../../src/modules/outbox/outboxService.js";

// #946: teller kursfullførings-hendelser for ÉN deltaker og ÉN modul.
//
// ⚠️ Må brukes som differanse rundt handlingen som testes, aldri som «finnes det en rad?».
// Den automatiske vurderingen (AssessmentDecisionApplicationService) legger allerede en slik
// hendelse tidligere i de samme testene, så en eksistens-sjekk ville vært grønn uansett — også
// med fiksen reversert. Det er nøyaktig den vakten-som-ikke-måler-noe vi har gått på før.
// ⚠️ `since` er ikke pynt. `m2-appeal-flow` og `m2-manual-review` kjører parallelt på SAMME
// deltaker (participant-1) og SAMME seedede modul, og begge påstår nå «nøyaktig én ny hendelse».
// Uten et tidsvindu deler de teller: den enes overstyring lander midt i den andres måling, og
// testen faller på +2. Vinduet snevrer målingen fra hele testen til selve HTTP-kallet.
export async function countCourseCompletionChecks(
  userId: string,
  moduleId: string,
  since?: Date,
): Promise<number> {
  const rows = await prisma.outboxEvent.findMany({
    where: {
      type: OUTBOX_EVENT_TYPES.courseCompletionCheck,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    select: { payloadJson: true },
  });

  return rows.filter((row) => {
    let payload: { userId?: string; moduleId?: string };
    try {
      payload = JSON.parse(row.payloadJson) as { userId?: string; moduleId?: string };
    } catch {
      return false;
    }
    return payload.userId === userId && payload.moduleId === moduleId;
  }).length;
}

export async function submissionOwner(submissionId: string): Promise<{ userId: string; moduleId: string }> {
  return prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    select: { userId: true, moduleId: true },
  });
}
