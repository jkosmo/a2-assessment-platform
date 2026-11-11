// #1140 etappe 1 (doc/DESIGN_1140.md, doc/design/PLAN_1140_E1.md): hvilken versjon av en modul en deltaker får.
//
// REGELEN (produkteier 2026-11-11, andre avgjørelse samme kveld):
//   1. KURSET MODULEN ÅPNES FRA, BESTEMMER. Deltakersiden sier hvilket kurs (`courseId`). Har leseren tilgang til det kurset, og
//      inneholder det modulen, får hen hovedversjonen DET kurset viser — også når et annet kurs hen har tilgang til, viser en
//      annen. Slik endres ikke det deltakerne ser i et kurs av at et annet kurs tar i bruk en ny hovedversjon.
//   2. RESERVEN, når kurset ikke er kjent (frittstående modus, en klient fra før #1140, API-kall uten kurs) eller ikke
//      gjelder: den HØYESTE hovedversjonen blant kursene leseren har tilgang til som inneholder modulen. (En lenke i e-post
//      går IKKE hit: deltakersiden finner kurset modulen ligger i, og sender det.)
//   I begge: et kurs uten låst hovedversjon følger modulens nyeste, og innen hovedversjonen gis den nyeste publiserte versjonen.
//   Uten noe kurs: modulens nyeste.
//
// Hvorfor ikke bare 2: alle har tilgang til åpne kurs og kurs tildelt «Alle deltakere». Med bare reserven ville ett slikt kurs på
// en høyere hovedversjon gitt ALLE den, også i kurs som har låst en lavere (planlesingen 2026-11-11).
//
// Hvert kurs kan låse hovedversjonen det viser (`CourseModuleRequirement.shownModuleMajor`). I etappe 1 skriver ingen feltet, så
// svaret er alltid «modulens nyeste» — det samme som før. Deltakerflyten leser likevel gjennom denne fila allerede nå: modullista
// og enkeltoppslaget (moduleService.ts), og innleveringen (submissionService.ts). Alt ETTER innleveringen (flervalg, vurdering,
// vedtak, resultat, bestått) følger innleveringens egen versjon og spør ikke her. Derfor er åpning og levering de eneste stedene
// som trenger kurset. En bestått teller i et kurs etter kravet der (`minModuleMajor`, en terskel), uansett hvilket kurs modulen
// ble åpnet fra.
import type { AppRole as AppRoleType, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import type { DbTransactionClient } from "../../db/transaction.js";
import { findShownModuleMajors } from "../adminContent/moduleVersioning.js";
import { filterPublishedCoursesContainingModule, findAccessibleCoursesContainingModules } from "../course/enrollmentService.js";
import { moduleSummarySelect } from "../../repositories/moduleRepository.js";

/** Den som åpner eller leverer modulen. */
export type ModuleReader = { userId: string; roles: AppRoleType[]; groupIds?: string[] };

/** Versjonen slik modullista bærer den (`moduleSummarySelect.activeVersion`). */
type ModuleSummaryVersion = Prisma.ModuleVersionGetPayload<{ select: (typeof moduleSummarySelect)["activeVersion"]["select"] }>;

type ShownMajorRow = { courseId: string; moduleId: string; shownModuleMajor: number };

/** Det innleveringen leser låsene og kursene med: `prisma` i forhåndssjekken, transaksjonens klient under innholdslåsen. */
export type ShownMajorClient = Pick<DbTransactionClient, "courseModuleRequirement" | "courseItem" | "moduleVersion">;

/**
 * Regelen, uten database. `accessible` er modul → kursene deltakeren har tilgang til som inneholder den; `locked` er kursene
 * som har låst en hovedversjon. Svaret er modul → hovedversjon. En modul som mangler i svaret, følger modulens nyeste:
 * ingen tilgjengelige kurs, eller minst ett tilgjengelig kurs uten lås (det følger nyeste, og nyeste er høyest).
 */
export function highestShownMajors(accessible: Map<string, string[]>, locked: ShownMajorRow[]): Map<string, number> {
  const lockOf = new Map(locked.map((row) => [`${row.courseId}\n${row.moduleId}`, row.shownModuleMajor]));
  const out = new Map<string, number>();
  for (const [moduleId, courseIds] of accessible) {
    let highest: number | null = null;
    let followsNewest = false;
    for (const courseId of courseIds) {
      const major = lockOf.get(`${courseId}\n${moduleId}`);
      if (major === undefined) {
        followsNewest = true;
        break;
      }
      if (highest === null || major > highest) highest = major;
    }
    if (!followsNewest && highest !== null) out.set(moduleId, highest);
  }
  return out;
}

/**
 * Regel 1, uten database: kurset modulen ble åpnet fra, bestemmer for modulene det inneholder og leseren har tilgang til dem i.
 * For dem snevres kursene inn til bare det kurset. For alle andre moduler, og når `courseId` mangler eller ikke er et kurs
 * leseren har modulen i, står kursene som de er (reserven). Tilgangen er allerede avgjort i `accessible`, så et kurs leseren
 * ikke har tilgang til, kan aldri bestemme.
 */
export function narrowToOpenedCourse(accessible: Map<string, string[]>, courseId: string | null | undefined): Map<string, string[]> {
  if (!courseId) return accessible;
  const out = new Map<string, string[]>();
  for (const [moduleId, courseIds] of accessible) {
    out.set(moduleId, courseIds.includes(courseId) ? [courseId] : courseIds);
  }
  return out;
}

/**
 * Hovedversjonen leseren skal ha av hver modul, for modullista og enkeltoppslaget. Moduler som mangler i svaret, følger
 * modulens nyeste. `courseId` er kurset modulene ble åpnet fra, når deltakersiden vet det.
 *
 * Hurtigveien: har ingen kurs låst en hovedversjon av disse modulene, er svaret tomt etter én spørring, og tilgangen regnes
 * aldri ut. Slik er det for alle til etappe 3 gir feltet en skriver.
 */
export async function resolveShownMajors(reader: ModuleReader, moduleIds: string[], courseId?: string | null): Promise<Map<string, number>> {
  const locked = await findShownModuleMajors(prisma, { moduleIds });
  if (locked.length === 0) return new Map();
  const lockedModuleIds = [...new Set(locked.map((row) => row.moduleId))];
  const accessible = await findAccessibleCoursesContainingModules({ ...reader, moduleIds: lockedModuleIds });
  return highestShownMajors(narrowToOpenedCourse(accessible, courseId), locked);
}

/**
 * Innleveringen, før låsene: kursene som avgjør versjonen. Kurset modulen ble åpnet fra når leseren har modulen i det, ellers
 * alle kursene leseren har tilgang til som inneholder modulen. `null` når ingen kurs har låst en hovedversjon av modulen
 * (hurtigveien). Tilgangen regnes ut her, utenfor transaksjonen, som kursporten i ruta gjør.
 */
export async function prepareShownMajorScope(reader: ModuleReader, moduleId: string, courseId?: string | null): Promise<string[] | null> {
  const locked = await findShownModuleMajors(prisma, { moduleIds: [moduleId] });
  if (locked.length === 0) return null;
  const accessible = await findAccessibleCoursesContainingModules({ ...reader, moduleIds: [moduleId] });
  return narrowToOpenedCourse(accessible, courseId).get(moduleId) ?? [];
}

/**
 * Modullista og enkeltoppslaget: bytter `activeVersion` med versjonen leseren skal ha, for modulene der et kurs har låst en
 * eldre hovedversjon. Feltet heter fortsatt `activeVersion` i svaret: for deltakeren betyr det «versjonen du får», og
 * innleveringen sender id-en tilbake som versjonen hen så.
 */
export async function withShownVersions<M extends { id: string; activeVersion: ModuleSummaryVersion | null }>(
  modules: M[],
  reader: ModuleReader,
  courseId?: string | null,
): Promise<M[]> {
  if (modules.length === 0) return modules;
  const majors = await resolveShownMajors(reader, modules.map((module) => module.id), courseId);
  if (majors.size === 0) return modules;
  // Bare modulene der låsen er en ANNEN hovedversjon enn den aktives, trenger et oppslag, og de hentes i én spørring.
  const older = modules.flatMap((module) => {
    const major = majors.get(module.id);
    return major !== undefined && module.activeVersion && module.activeVersion.versionMajor !== major ? [{ moduleId: module.id, versionMajor: major }] : [];
  });
  if (older.length === 0) return modules;
  const rows = await prisma.moduleVersion.findMany({
    where: { OR: older, publishedAt: { not: null } },
    orderBy: { versionMinor: "desc" },
    select: { ...moduleSummarySelect.activeVersion.select, moduleId: true },
  });
  // Høyest mindre nummer først: den første raden per modul er den som vises.
  const shownOf = new Map<string, ModuleSummaryVersion>();
  for (const { moduleId, ...version } of rows) {
    if (!shownOf.has(moduleId)) shownOf.set(moduleId, version);
  }
  // Fant vi ingen publisert versjon med den hovedversjonen, står den aktive (som i `findShownVersion`).
  return modules.map((module) => {
    const shown = shownOf.get(module.id);
    return shown ? { ...module, activeVersion: shown } : module;
  });
}

/** En lås dukket opp mellom forberedelsen og innholdslåsen: versjonen kan ikke avgjøres uten tilgangen. */
export class ShownMajorScopeOutdatedError extends Error {}

/**
 * Innleveringen: hovedversjonen leseren skal ha, eller `null` for modulens nyeste. Kalles to ganger: i forhåndssjekken, og
 * UNDER innholdslåsen med transaksjonens klient. Der leses låsene på nytt, og kursene fra forberedelsen sjekkes på nytt
 * (fortsatt publisert, fortsatt med modulen), så en kurspublisering enten er ferdig eller venter til innleveringen er skrevet.
 *
 * Det som IKKE leses på nytt under låsen, er hvilke kurs leseren har tilgang til: et kurs som ble tilgjengelig etter
 * forberedelsen, ses ikke. Det er ufarlig, for innleveringen står uansett på versjonen leseren så (ellers 409). Tilgangen
 * kan ikke flyttes inn under låsen: funksjonene som regner den ut, bruker den vanlige databaseklienten, ikke transaksjonens.
 *
 * `scope` er svaret fra `prepareShownMajorScope`. Var det `null` (ingen låser da), og det finnes låser nå, kastes
 * `ShownMajorScopeOutdatedError`: kalleren svarer som når versjonen er endret, og ingenting skrives.
 */
export async function resolveShownMajorForScope(
  client: ShownMajorClient,
  moduleId: string,
  scope: string[] | null,
): Promise<number | null> {
  if (scope === null) {
    if ((await findShownModuleMajors(client, { moduleIds: [moduleId] })).length > 0) throw new ShownMajorScopeOutdatedError();
    return null;
  }
  const courseIds = await filterPublishedCoursesContainingModule(client, moduleId, scope);
  const rows = await findShownModuleMajors(client, { moduleIds: [moduleId], courseIds });
  return highestShownMajors(new Map([[moduleId, courseIds]]), rows).get(moduleId) ?? null;
}

/**
 * Versjonen som vises for en hovedversjon: modulens aktive når hovedversjonen er den aktives (eller `major` er `null`), ellers
 * den publiserte versjonen med høyest mindre nummer innen hovedversjonen. Finnes ingen slik (en lås som peker på noe som ikke
 * er publisert), gis den aktive: da er svaret det samme som uten lås, og aldri «ingen versjon».
 */
export async function findShownVersion<S extends Prisma.ModuleVersionSelect, A extends { versionMajor: number | null } | null>(
  client: Pick<DbTransactionClient, "moduleVersion">,
  moduleId: string,
  major: number | null,
  active: A,
  select: S,
): Promise<A | Prisma.ModuleVersionGetPayload<{ select: S }>> {
  if (major === null || active === null || active.versionMajor === major) return active;
  const older = await client.moduleVersion.findFirst({
    where: { moduleId, versionMajor: major, publishedAt: { not: null } },
    orderBy: { versionMinor: "desc" },
    select,
  });
  return (older as Prisma.ModuleVersionGetPayload<{ select: S }> | null) ?? active;
}

/**
 * Innleveringen: versjonen leseren skal levere på, gitt modulens aktive versjon og kursene fra `prepareShownMajorScope`.
 * Kaster `ShownMajorScopeOutdatedError` som `resolveShownMajorForScope`.
 */
export async function findVersionToSubmitOn<A extends { id: string; versionMajor: number | null; publishedAt: Date | null }>(
  client: ShownMajorClient,
  moduleId: string,
  active: A,
  scope: string[] | null,
): Promise<{ id: string; publishedAt: Date | null }> {
  const major = await resolveShownMajorForScope(client, moduleId, scope);
  return findShownVersion(client, moduleId, major, active, { id: true, versionMajor: true, publishedAt: true });
}
