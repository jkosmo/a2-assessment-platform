// #934 skive 5a-2 og 5a-3 (doc/DESIGN_934.md, «5a»): hvilke moduler teller for en deltaker i et kurs.
//
// En modul teller for kurs C når deltakeren har en `ModulePass` som ikke er ugyldiggjort, og der vedtakets modulversjon har
// hovedversjon større enn eller lik kravet for (C, M). Tidspunktet spiller ingen rolle.
//
// ⚠️ `findModuleProgress` (under) er DEN ENE veien til fremdrift i kurs. Porten for kursbevis, «Mine kurs», kursdetaljen og
// kursrapporten spør bare den. `test/content-lock-write-guard.test.js` nekter andre lesere.
//
// Regelen har vært på i prod siden 2026-11-06 (bryteren i `modulePassSwitch.ts`), og den slås aldri av igjen. Den gamle regelen,
// som leste `CertificationStatus`, er fjernet (2026-11-08). Bryteren leses ikke her lenger.
import { prisma } from "../../db/prisma.js";
import type { ReportFilters } from "../reporting/types.js";

type CreditReader = Pick<typeof prisma, "courseModuleRequirement" | "modulePass">;
type ProgressReader = CreditReader;

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

/** Har noen bestått modulen, så det finnes noen en ny hovedversjon kan ha konsekvens for? Moduldialogen spør bare da. */
export async function hasValidModulePass(client: Pick<typeof prisma, "modulePass">, moduleId: string): Promise<boolean> {
  return (await client.modulePass.findFirst({ where: { moduleId, invalidatedAt: null }, select: { id: true } })) !== null;
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
  standing(userId: string, courseId: string, moduleId: string): ModuleStanding | null;
  /** Modulene som teller for deltakeren i kurset. */
  passedModuleIds(userId: string, courseId: string): Set<string>;
  /** Deltakerne modulen teller for i kurset. */
  passedUserIds(courseId: string, moduleId: string): Set<string>;
};

function emptyProgress(): ModuleProgress {
  return { standing: () => null, passedModuleIds: () => new Set(), passedUserIds: () => new Set() };
}

function collectStandings() {
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

/** Kravet per kurs og beståtte per innlevering (5a-3). */
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
  const collected = collectStandings();
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
 * ⚠️ DEN ENE VEIEN til fremdrift i kurs. Leses på samme klient som dataene: i en låst transaksjon (utstedelsen) er kravet og
 * beståttene lest i samme transaksjon.
 */
export async function findModuleProgress(client: ProgressReader, input: ModuleProgressInput): Promise<ModuleProgress> {
  const moduleIds = [...new Set(input.courses.flatMap((course) => course.moduleIds))];
  if (moduleIds.length === 0 || input.userIds?.length === 0) return emptyProgress();
  return readPerCourseRule(client, input, moduleIds);
}

// ---------------------------------------------------------------------------
// #1192 punkt 1 (produkteier 2026-11-24): «har deltakeren bestått modulen?» for flatene som ikke har et kurs —
// modulrapportene, profilen og resertifiseringsrapporten. Samme regel som i kurs: en bestått står til modulen revideres,
// og et senere stryk tar den ikke bort. «Revidert» betyr her en nyere hovedversjon av MODULEN (svar A): et pass på en eldre
// hovedversjon er ikke gjeldende, også når et kurs har valgt å ikke kreve den nye. Med `courseId` brukes kursets krav.
// ---------------------------------------------------------------------------

type ModuleLevelReader = Pick<typeof prisma, "modulePass" | "moduleVersion" | "courseModuleRequirement">;

export type ModuleLevelStanding = {
  /** `PASSED`: et gjeldende pass. `REVISED`: bare pass på en eldre hovedversjon (eller ugyldiggjort). `null`: ingen pass. */
  standing(userId: string, moduleId: string): ModuleStanding | null;
  /** Deltakerne med et gjeldende pass på modulen. */
  passedUserIds(moduleId: string): Set<string>;
  /**
   * #1192 (QA 2.181.7): når passet som gir ståstedet, ble tatt: det siste gjeldende passet for `PASSED`, det siste passet for
   * `REVISED`, ellers null. Resertifiseringsrapporten viser datoen ved siden av statusen. Bare på modulnivå; med `courseId` null.
   */
  passedAt(userId: string, moduleId: string): Date | null;
};

/**
 * Ren funksjon: teller passet på modulnivå, gitt modulens nyeste hovedversjon? En versjon uten nummer regnes som hovedversjon 1,
 * som i `currentModuleMajor` og nummereringen av historikk (`numberModuleHistory`). Kursregelen (`passCountsForCourse`) lar
 * derimot et pass uten nummer stå som ikke tellende, fordi kravet da ikke er fylt ut; her finnes ikke noe krav.
 */
export function passCountsForModule(pass: { invalidatedAt: Date | null; versionMajor: number | null }, currentMajor: number): boolean {
  if (pass.invalidatedAt !== null) return false;
  return (pass.versionMajor ?? 1) >= currentMajor;
}

export async function findModuleStanding(
  client: ModuleLevelReader,
  input: { moduleIds: string[]; userIds?: string[]; courseId?: string },
): Promise<ModuleLevelStanding> {
  const moduleIds = [...new Set(input.moduleIds)];
  if (moduleIds.length === 0 || input.userIds?.length === 0) {
    return { standing: () => null, passedUserIds: () => new Set(), passedAt: () => null };
  }
  if (input.courseId) {
    const courseId = input.courseId;
    const progress = await findModuleProgress(client, { userIds: input.userIds, courses: [{ courseId, moduleIds }] });
    return {
      standing: (userId, moduleId) => progress.standing(userId, courseId, moduleId),
      passedUserIds: (moduleId) => progress.passedUserIds(courseId, moduleId),
      passedAt: () => null,
    };
  }
  return readModuleLevelRule(client, moduleIds, input.userIds);
}

/**
 * Hvor mange som har bestått modulen nå, på modulnivå (#1192 punkt 1). Tallet forfatteren ser før en publisering
 * (`/modules/:id/passed-count`, kursets forhåndsvisning av ventende versjoner). Leste før `CertificationStatus`.
 */
export async function countCurrentModulePasses(client: ModuleLevelReader, moduleId: string): Promise<number> {
  return (await readModuleLevelRule(client, [moduleId], undefined)).passedUserIds(moduleId).size;
}

/** Modulens nyeste hovedversjon (som `currentModuleMajor`, uten å nummerere historikk) og beståttene. */
async function readModuleLevelRule(client: ModuleLevelReader, moduleIds: string[], userIds: string[] | undefined): Promise<ModuleLevelStanding> {
  const majors = await client.moduleVersion.groupBy({
    by: ["moduleId"],
    where: { moduleId: { in: moduleIds }, versionMajor: { not: null } },
    _max: { versionMajor: true },
  });
  const currentMajor = new Map(majors.map((row) => [row.moduleId, row._max.versionMajor ?? 1]));
  const passes = await client.modulePass.findMany({
    where: { moduleId: { in: moduleIds }, ...(userIds ? { userId: { in: userIds } } : {}) },
    select: { userId: true, moduleId: true, invalidatedAt: true, passedAt: true, moduleVersion: { select: { versionMajor: true } } },
  });
  const standings = new Map<string, ModuleStanding>();
  const dates = new Map<string, Date>();
  const passedByModule = new Map<string, Set<string>>();
  for (const pass of passes) {
    const key = `${pass.userId}\n${pass.moduleId}`;
    const counts = passCountsForModule(
      { invalidatedAt: pass.invalidatedAt, versionMajor: pass.moduleVersion.versionMajor },
      currentMajor.get(pass.moduleId) ?? 1,
    );
    const was = standings.get(key);
    // En gjeldende bestått vinner over en revidert; innen samme ståsted følger den siste datoen med.
    if (was === "PASSED" && !counts) continue;
    if (was !== "PASSED" && counts) dates.delete(key);
    standings.set(key, counts ? "PASSED" : "REVISED");
    const latest = dates.get(key);
    if (!latest || pass.passedAt > latest) dates.set(key, pass.passedAt);
    if (counts) {
      const set = passedByModule.get(pass.moduleId);
      if (set) set.add(pass.userId);
      else passedByModule.set(pass.moduleId, new Set([pass.userId]));
    }
  }
  return {
    standing: (userId, moduleId) => standings.get(`${userId}\n${moduleId}`) ?? null,
    passedUserIds: (moduleId) => passedByModule.get(moduleId) ?? new Set(),
    passedAt: (userId, moduleId) => dates.get(`${userId}\n${moduleId}`) ?? null,
  };
}
