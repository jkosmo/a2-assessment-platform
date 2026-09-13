// #1058: hvem ser hvilke kurs i Resultater.
//
// Produkteier 13.09: SUBJECT_MATTER_OWNER leser Resultater for kurs hen eier — også på personnivå
// (samme begrunnelse som revisjonssporet 23.08: SMO er «en lærer med pedagogisk oppfølgingsansvar»).
// Administrator og rapportleser ser alt, som før. Ingen særregler for små grupper.
//
// To ting bor her, og bare her:
//   1. `resolveAllowedCourseIds` — fra roller og bruker til «disse kursene, eller alle» (null = alle).
//   2. `moduleIdClause` — fra filtre (valgt kurs, valgt modul, tillatte kurs) til én where-bit for
//      innleveringene. Fire modulrapporter bygde hver sin where; kursfilteret var ikke med i noen av
//      dem, så «Kurs: X» på Resultater filtrerte kursrapporten men ikke modultabellen.
//
// ⚠️ Et kurs utenfor det tillatte settet gir TOM rapport, ikke 403. En SMO som velger et kurs hen
// ikke eier (kan ikke skje i klienten — velgeren viser bare egne) skal ikke få vite noe om det.

import type { AppRole as AppRoleType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { courseRepository } from "../course/courseRepository.js";
import { AppRole } from "../../db/prismaRuntime.js";
import { hasAnyRole, REPORT_READERS } from "../../auth/roleSets.js";
import type { ReportFilters } from "./types.js";
import { effectiveCourseIds } from "./scopeRules.js";

export { effectiveCourseIds };

/** null = ingen avgrensning (administrator, rapportleser). Tom liste = ser ingenting. */
export async function resolveAllowedCourseIds(input: {
  roles: readonly AppRoleType[] | undefined;
  userId: string | undefined;
}): Promise<string[] | null> {
  const roles = input.roles ?? [];
  if (hasAnyRole(roles, REPORT_READERS)) return null;
  if (!input.userId || !hasAnyRole(roles, [AppRole.SUBJECT_MATTER_OWNER])) return [];
  const rows = await prisma.contentOwner.findMany({
    where: { contentType: "COURSE", userId: input.userId },
    select: { contentId: true },
  });
  return rows.map((r) => r.contentId);
}

/**
 * Where-biten for `moduleId` på innleveringer. `null` betyr «ingenting er synlig» — kalleren svarer
 * med tom rapport uten å spørre databasen.
 *
 * @param explicitModuleId  modulen en detaljrapport ble bedt om (selectedModuleId)
 */
export async function moduleIdClause(
  filters: Pick<ReportFilters, "courseId" | "moduleId" | "allowedCourseIds">,
  explicitModuleId?: string,
): Promise<{ moduleId: string } | { moduleId: { in: string[] } } | Record<string, never> | null> {
  const wanted = explicitModuleId ?? filters.moduleId;
  const courseIds = effectiveCourseIds(filters);
  if (courseIds === undefined) return wanted ? { moduleId: wanted } : {};
  if (courseIds.length === 0) return null;
  // Gjennom kursets navngitte dør (#958), ikke en egen lesning av CourseItem. Alle elementene, også
  // arkiverte moduler: en innlevering på en modul som siden ble arkivert hører fortsatt til kurset.
  const perCourse = await Promise.all(courseIds.map((id) => courseRepository.findAllCourseItems(id)));
  const moduleIds = [...new Set(perCourse.flat().map((i) => i.moduleId).filter((id): id is string => !!id))];
  if (wanted) return moduleIds.includes(wanted) ? { moduleId: wanted } : null;
  return { moduleId: { in: moduleIds } };
}
