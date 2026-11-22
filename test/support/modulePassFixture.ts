import { prisma } from "../../src/db/prisma.js";
import { runContentWrite } from "../../src/db/contentLock.js";
import { numberModuleHistory, syncModuleRequirements } from "../../src/modules/adminContent/moduleVersioning.js";

/**
 * #934 (regelen prod bruker siden 2026-11-06): en bestått teller i et kurs når innleveringen har en `ModulePass`, versjonen har
 * nummer, og kurset har et krav for modulen som versjonen oppfyller.
 *
 * Fiksturer som skriver innleveringen og vedtaket direkte i databasen, og ikke går gjennom vedtakssporet, må skrive det samme som
 * sporet: `CertificationStatus` alene er den gamle regelen, og den finnes ikke lenger. Nummeret og kravet regnes ut av koden
 * publiseringen og kursskjemaet bruker (`numberModuleHistory`, `syncModuleRequirements`), ikke av testen.
 *
 * Kurs som er laget med `prisma.course.create({ items })` før beståtten, får kravet her. Lages kurset etterpå, kall
 * `syncFixtureRequirements` når elementene er skrevet.
 */
export async function recordFixturePass(input: {
  userId: string;
  moduleId: string;
  moduleVersionId: string;
  submissionId: string;
  decisionId: string;
  passedAt?: Date;
}): Promise<void> {
  await runContentWrite((tx) => numberModuleHistory(tx, input.moduleId));
  await prisma.modulePass.upsert({
    where: { submissionId: input.submissionId },
    update: { decisionId: input.decisionId, moduleVersionId: input.moduleVersionId, passedAt: input.passedAt ?? new Date(), invalidatedAt: null },
    create: {
      userId: input.userId,
      moduleId: input.moduleId,
      submissionId: input.submissionId,
      decisionId: input.decisionId,
      moduleVersionId: input.moduleVersionId,
      passedAt: input.passedAt ?? new Date(),
    },
  });
  const placements = await prisma.courseItem.findMany({ where: { moduleId: input.moduleId, itemType: "MODULE" }, distinct: ["courseId"], select: { courseId: true } });
  for (const { courseId } of placements) await syncFixtureRequirements(courseId);
}

/** Kravet for hver modul i kurset, slik `PUT …/items` ville skrevet det. Moduler som alt har krav, røres ikke. */
export async function syncFixtureRequirements(courseId: string): Promise<void> {
  await runContentWrite((tx) => syncModuleRequirements(tx, courseId));
}
