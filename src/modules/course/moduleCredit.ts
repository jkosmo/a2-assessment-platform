// #934 skive 5a-2 (doc/DESIGN_934.md, «5a»): hvilke moduler teller for en deltaker i et kurs, etter regelen som slås på i
// 5a-3. Én funksjon for alle lesere, slik seksjonsregelen er. I denne skiva er det bare sammenligningsrapporten som leser
// den; ingen deltaker, forfatter eller kursbevis merker noe.
//
// En modul teller for kurs C når deltakeren har en `ModulePass` som ikke er ugyldiggjort, og der vedtakets modulversjon har
// hovedversjon større enn eller lik kravet for (C, M). Tidspunktet spiller ingen rolle.
import { prisma } from "../../db/prisma.js";

type CreditReader = Pick<typeof prisma, "courseModuleRequirement" | "modulePass">;

export type CreditedModule = { userId: string; courseId: string; moduleId: string };

/**
 * Ren funksjon, så regelen står ett sted. Mangler kravet, eller versjonen har ikke nummer, teller beståtten ikke: det betyr
 * at noe ikke er fylt ut, og da skal ingen kunne få kursbevis på det. Rapporten lister dem.
 */
export function passCountsForCourse(
  pass: { invalidatedAt: Date | null; versionMajor: number | null },
  minModuleMajor: number | undefined,
): boolean {
  if (pass.invalidatedAt !== null) return false;
  if (minModuleMajor === undefined || pass.versionMajor === null) return false;
  return pass.versionMajor >= minModuleMajor;
}

/** Varianten for mange deltakere og mange kurs. */
export async function findCreditedModules(
  client: CreditReader,
  input: { userIds: string[]; courseIds: string[] },
): Promise<CreditedModule[]> {
  if (input.userIds.length === 0 || input.courseIds.length === 0) return [];
  const requirements = await client.courseModuleRequirement.findMany({
    where: { courseId: { in: input.courseIds } },
    select: { courseId: true, moduleId: true, minModuleMajor: true },
  });
  if (requirements.length === 0) return [];
  const passes = await client.modulePass.findMany({
    where: { userId: { in: input.userIds }, moduleId: { in: [...new Set(requirements.map((r) => r.moduleId))] } },
    select: { userId: true, moduleId: true, invalidatedAt: true, moduleVersion: { select: { versionMajor: true } } },
  });
  const passesByModule = new Map<string, typeof passes>();
  for (const pass of passes) {
    const list = passesByModule.get(pass.moduleId);
    if (list) list.push(pass);
    else passesByModule.set(pass.moduleId, [pass]);
  }
  const credited = new Map<string, CreditedModule>();
  for (const requirement of requirements) {
    for (const pass of passesByModule.get(requirement.moduleId) ?? []) {
      if (!passCountsForCourse({ invalidatedAt: pass.invalidatedAt, versionMajor: pass.moduleVersion.versionMajor }, requirement.minModuleMajor)) continue;
      credited.set(`${pass.userId}\n${requirement.courseId}\n${requirement.moduleId}`, {
        userId: pass.userId,
        courseId: requirement.courseId,
        moduleId: requirement.moduleId,
      });
    }
  }
  return [...credited.values()];
}

/** Modulene som teller for denne deltakeren i dette kurset. */
export async function findCreditedModuleIds(client: CreditReader, userId: string, courseId: string): Promise<string[]> {
  const rows = await findCreditedModules(client, { userIds: [userId], courseIds: [courseId] });
  return rows.map((row) => row.moduleId);
}
