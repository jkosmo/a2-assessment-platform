// #934 skive 5a-2 og 5a-3 (doc/DESIGN_934.md, «5a»): hvilke moduler teller for en deltaker i et kurs.
//
// En modul teller for kurs C når deltakeren har en `ModulePass` som ikke er ugyldiggjort, og der vedtakets modulversjon har
// hovedversjon større enn eller lik kravet for (C, M). Tidspunktet spiller ingen rolle.
//
// ⚠️ `findModuleProgress` (under) er DEN ENE veien til fremdrift i kurs. Porten for kursbevis, «Mine kurs», kursdetaljen og
// kursrapporten spør bare den, og den velger regel ut fra bryteren: av = `CertificationStatus`, som i 2.134.0; på = regelen
// over. `test/content-lock-write-guard.test.js` nekter andre lesere.
import type { CertificationLifecycleStatus } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { isCertificationPassed } from "../certification/certificationRepository.js";
import type { ReportFilters } from "../reporting/types.js";
import { isModulePassPerCourseOn } from "./modulePassSwitch.js";

type CreditReader = Pick<typeof prisma, "courseModuleRequirement" | "modulePass">;
type ProgressReader = CreditReader & Pick<typeof prisma, "certificationStatus" | "platformConfig">;

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

/** Varianten for mange deltakere og mange kurs, uten å se på bryteren. Sammenligningsrapporten bruker den. */
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

/** Modulene som teller for denne deltakeren i dette kurset, etter den nye regelen. */
export async function findCreditedModuleIds(client: CreditReader, userId: string, courseId: string): Promise<string[]> {
  const rows = await findCreditedModules(client, { userIds: [userId], courseIds: [courseId] });
  return rows.map((row) => row.moduleId);
}

// ---------------------------------------------------------------------------
// #934 skive 5a-3: den ene funksjonen for alle lesere.
// ---------------------------------------------------------------------------

/**
 * Hvor deltakeren står med modulen i kurset:
 *   - `PASSED`: den teller;
 *   - `REVISED`: hen besto en versjon som ikke lenger teller her, og må ta modulen på nytt (`REVISED_RETAKE_REQUIRED`).
 * Ingen av delene (`null`): resten avgjør leseren selv, ut fra om hen har begynt.
 */
export type ModuleStanding = "PASSED" | "REVISED";
export type ModuleProgressRule = "per_course" | "module_status";
export type ModuleProgressFilters = Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit">;

export type ModuleProgressInput = {
  /** Utelatt: alle deltakere (kursrapporten). */
  userIds?: string[];
  /** Kursene, med modulene leseren spør om. Andre moduler i kurset telles ikke. */
  courses: Array<{ courseId: string; moduleIds: string[] }>;
  /** Vinduet og avdelingen i kursrapporten. */
  filters?: ModuleProgressFilters;
};

export type ModuleProgress = {
  rule: ModuleProgressRule;
  standing(userId: string, courseId: string, moduleId: string): ModuleStanding | null;
  /** Modulene som teller for deltakeren i kurset. */
  passedModuleIds(userId: string, courseId: string): Set<string>;
  /** Deltakerne modulen teller for i kurset. */
  passedUserIds(courseId: string, moduleId: string): Set<string>;
};

function emptyProgress(rule: ModuleProgressRule): ModuleProgress {
  return { rule, standing: () => null, passedModuleIds: () => new Set(), passedUserIds: () => new Set() };
}

function collectStandings(rule: ModuleProgressRule) {
  const standings = new Map<string, ModuleStanding>();
  const byLearner = new Map<string, Set<string>>();
  const byModule = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, value: string) => {
    const set = map.get(key);
    if (set) set.add(value);
    else map.set(key, new Set([value]));
  };
  return {
    set(userId: string, courseId: string, moduleId: string, standing: ModuleStanding) {
      const key = `${userId}\n${courseId}\n${moduleId}`;
      // En bestått som teller, vinner over en som ikke gjør det: flere innleveringer kan peke hver sin vei.
      if (standings.get(key) === "PASSED") return;
      standings.set(key, standing);
      if (standing === "PASSED") {
        add(byLearner, `${userId}\n${courseId}`, moduleId);
        add(byModule, `${courseId}\n${moduleId}`, userId);
      }
    },
    result(): ModuleProgress {
      return {
        rule,
        standing: (userId, courseId, moduleId) => standings.get(`${userId}\n${courseId}\n${moduleId}`) ?? null,
        passedModuleIds: (userId, courseId) => byLearner.get(`${userId}\n${courseId}`) ?? new Set(),
        passedUserIds: (courseId, moduleId) => byModule.get(`${courseId}\n${moduleId}`) ?? new Set(),
      };
    },
  };
}

function passedWithin(filters: ModuleProgressFilters | undefined) {
  if (!filters?.dateFrom && !filters?.dateTo) return {};
  return {
    passedAt: {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    },
  };
}

function inOrgUnit(filters: ModuleProgressFilters | undefined) {
  return filters?.orgUnit ? { user: { department: filters.orgUnit } } : {};
}

/** Regelen slik den var før 5a-3: én rad per person og modul, uansett kurs. */
async function readModuleStatusRule(client: ProgressReader, input: ModuleProgressInput, moduleIds: string[]): Promise<ModuleProgress> {
  const rows: Array<{ userId: string; moduleId: string; status: CertificationLifecycleStatus }> = await client.certificationStatus.findMany({
    where: {
      moduleId: { in: moduleIds },
      ...(input.userIds ? { userId: { in: input.userIds } } : {}),
      ...passedWithin(input.filters),
      ...inOrgUnit(input.filters),
    },
    select: { userId: true, moduleId: true, status: true },
  });
  const collected = collectStandings("module_status");
  for (const course of input.courses) {
    const inCourse = new Set(course.moduleIds);
    for (const row of rows) {
      if (!inCourse.has(row.moduleId)) continue;
      if (isCertificationPassed(row.status)) collected.set(row.userId, course.courseId, row.moduleId, "PASSED");
      else if (row.status === "SUPERSEDED") collected.set(row.userId, course.courseId, row.moduleId, "REVISED");
    }
  }
  return collected.result();
}

/** Regelen etter 5a-3: kravet per kurs og beståtte per innlevering. */
async function readPerCourseRule(client: ProgressReader, input: ModuleProgressInput, moduleIds: string[]): Promise<ModuleProgress> {
  const requirements = await client.courseModuleRequirement.findMany({
    where: { courseId: { in: input.courses.map((course) => course.courseId) }, moduleId: { in: moduleIds } },
    select: { courseId: true, moduleId: true, minModuleMajor: true },
  });
  const requirementOf = new Map(requirements.map((row) => [`${row.courseId}\n${row.moduleId}`, row.minModuleMajor]));
  const passes = await client.modulePass.findMany({
    where: {
      moduleId: { in: moduleIds },
      ...(input.userIds ? { userId: { in: input.userIds } } : {}),
      ...passedWithin(input.filters),
      ...inOrgUnit(input.filters),
    },
    select: { userId: true, moduleId: true, invalidatedAt: true, moduleVersion: { select: { versionMajor: true } } },
  });
  const collected = collectStandings("per_course");
  for (const course of input.courses) {
    const inCourse = new Set(course.moduleIds);
    for (const pass of passes) {
      if (!inCourse.has(pass.moduleId)) continue;
      const counts = passCountsForCourse(
        { invalidatedAt: pass.invalidatedAt, versionMajor: pass.moduleVersion.versionMajor },
        requirementOf.get(`${course.courseId}\n${pass.moduleId}`),
      );
      collected.set(pass.userId, course.courseId, pass.moduleId, counts ? "PASSED" : "REVISED");
    }
  }
  return collected.result();
}

/**
 * ⚠️ DEN ENE VEIEN til fremdrift i kurs. Velger regel ut fra bryteren, lest på samme klient som dataene: i en låst transaksjon
 * (utstedelsen) er bryteren og beståttene lest i samme transaksjon. Ingen mellomlagring: app og worker kan ikke bli uenige.
 */
export async function findModuleProgress(client: ProgressReader, input: ModuleProgressInput): Promise<ModuleProgress> {
  const perCourse = await isModulePassPerCourseOn(client);
  const moduleIds = [...new Set(input.courses.flatMap((course) => course.moduleIds))];
  if (moduleIds.length === 0 || input.userIds?.length === 0) return emptyProgress(perCourse ? "per_course" : "module_status");
  return perCourse ? readPerCourseRule(client, input, moduleIds) : readModuleStatusRule(client, input, moduleIds);
}
