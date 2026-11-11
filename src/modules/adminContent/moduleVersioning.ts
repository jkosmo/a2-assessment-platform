// #934 skive 5a-2 (doc/DESIGN_934.md, «5a-2»): versjonsnummeret på en modulversjon, hoved.mindre, og kravet per kurs.
//
// Nummeret settes ett sted: der modulens aktive versjon settes (`publishModuleVersion` i adminContentRepository.ts), under
// den eksklusive innholdslåsen. Det endres aldri etterpå. `versionNo` står som løpenummer.
//
// 5a-3 (på i prod siden 2026-11-06): en hovedversjon hever kravet bare i kursene som fikk hovedversjon (`raiseModuleRequirementInCourse`).
// Den globale hevingen fra #997, tilbakefyllingen og sammenligningsrapporten er fjernet (2026-11-08).
//
// Historikk uten nummer: en modul kan ha versjoner som ble publisert før 5a-2, eller av gammel kode under utrullingen. De får
// nummer før den neste gir noe videre (`numberModuleHistory`). #997-sporet (`SUPERSEDED` og revisjonshendelsen) leses der for
// å se hvor en hovedversjon startet. Det skrives ikke lenger, men radene står.
import type { ContentWriteTx } from "../../db/contentLock.js";
import type { DbTransactionClient } from "../../db/transaction.js";
import { AppError } from "../../errors/AppError.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";

export type ModuleVersionKind = "major" | "minor";
export type ModuleVersionNumber = { major: number; minor: number };

export type NumberingVersion = {
  id: string;
  versionNo: number;
  publishedAt: Date | null;
  createdAt: Date;
  versionMajor: number | null;
  versionMinor: number | null;
  /** Har versjonen vært ute? Publisert, aktiv nå, eller noen har levert på den. Et utkast får ikke nummer. */
  live: boolean;
};

function isHigher(a: ModuleVersionNumber, b: ModuleVersionNumber) {
  return a.major > b.major || (a.major === b.major && a.minor > b.minor);
}

/**
 * Nummerene versjonene uten nummer skal ha, i publiseringsrekkefølge. Ren funksjon.
 *   - Første versjon er 1.0, også om den står som revisjon: det var ingen å ta noe fra.
 *   - En versjon i `revisions` starter en ny hovedversjon, og plasseres der revisjonen skjedde. De andre er mindre. Da ligger
 *     alle versjoner som var ute før revisjonen, under den, så et sent vedtak på en av dem ikke kan telle.
 *   - En versjon som har nummer, beholder det. Det er det «et nummer som er gitt, endres ikke» betyr, og det gjør en ny
 *     kjøring ufarlig.
 */
export function numberModuleVersions(
  versions: NumberingVersion[],
  revisions: ReadonlyMap<string, Date | null>,
): Map<string, ModuleVersionNumber> {
  const order = (v: NumberingVersion) => Math.max((v.publishedAt ?? v.createdAt).getTime(), revisions.get(v.id)?.getTime() ?? 0);
  const walk = versions.filter((v) => v.live).sort((a, b) => order(a) - order(b) || a.versionNo - b.versionNo);
  const key = (n: ModuleVersionNumber) => `${n.major}.${n.minor}`;
  const taken = new Set(
    versions.flatMap((v) => (v.versionMajor !== null && v.versionMinor !== null ? [key({ major: v.versionMajor, minor: v.versionMinor })] : [])),
  );

  const assigned = new Map<string, ModuleVersionNumber>();
  let current: ModuleVersionNumber | null = null;
  for (const version of walk) {
    if (version.versionMajor !== null && version.versionMinor !== null) {
      const own: ModuleVersionNumber = { major: version.versionMajor, minor: version.versionMinor };
      if (!current || isHigher(own, current)) current = own;
      continue;
    }
    const major = revisions.has(version.id);
    let next: ModuleVersionNumber = !current
      ? { major: 1, minor: 0 }
      : major
        ? { major: current.major + 1, minor: 0 }
        : { major: current.major, minor: current.minor + 1 };
    // Bare mulig når en versjon uten nummer ligger foran en med nummer i rekkefølgen. Se «Kjente mangler» nr. 39.
    while (taken.has(key(next))) {
      next = major && current ? { major: next.major + 1, minor: 0 } : { major: next.major, minor: next.minor + 1 };
    }
    taken.add(key(next));
    assigned.set(version.id, next);
    current = next;
  }
  return assigned;
}

/** En `module_passes_superseded`-rad i revisjonssporet, lest ut. */
export type RevisionTrailEvent = {
  at: Date;
  /** Versjonen revisjonen pekte på. */
  versionId: string | null;
  supersededCount: number | null;
};

/**
 * Hvilke versjoner startet en ny hovedversjon, og når? Ren funksjon. Svaret er versjonen og tidspunktet for siste revisjon.
 *   - En rad i revisjonssporet med minst én bestått.
 *   - En revisjon uten beståtte blir mindre: den rørte ingen (doc/DESIGN_934.md).
 *   - En revisjon på en versjon som alt var ute (samme versjon, eller en som ble aktivert på nytt), gir også ny hovedversjon.
 *     I historikken er ingen nummer gitt ennå. Uten dette kunne et vedtak på en eldre versjon, fattet etter revisjonen, telle
 *     under den nye regelen (Codex, 2026-11-05).
 *   - En versjon som `supersededByVersionId` peker på, men som ikke har en rad med beståtte i sporet: da vet vi ikke når, men
 *     statusraden viser at noen mistet en bestått. Den regnes som ny hovedversjon, også om sporet har en annen rad med null
 *     beståtte. `module_passes_superseded` slettes ikke av oppryddingen, så dette skal ikke finnes; lesespørringen i
 *     `scripts/maintenance/module-credit-precheck.sql` sjekker det.
 */
export function findVersionsStartingMajor(trail: RevisionTrailEvent[], supersededByVersionIds: Iterable<string>): Map<string, Date | null> {
  const starts = new Map<string, Date | null>();
  for (const event of trail) {
    if (!event.versionId || !event.supersededCount) continue;
    const known = starts.get(event.versionId);
    if (!known || event.at > known) starts.set(event.versionId, event.at);
  }
  for (const versionId of supersededByVersionIds) {
    if (!starts.has(versionId)) starts.set(versionId, null);
  }
  return starts;
}

function metadataOf(json: string): { moduleVersionId?: unknown; supersededCount?: unknown } {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as { moduleVersionId?: unknown; supersededCount?: unknown }) : {};
  } catch {
    return {};
  }
}

type TrailReader = Pick<DbTransactionClient, "auditEvent">;

/**
 * Gir nummer til versjoner som har vært ute, men mangler det. Returnerer nummerene som ble gitt. Gjør ingenting på en modul
 * som er i orden, utover å lese versjonene.
 */
export async function numberModuleHistory(locked: ContentWriteTx, moduleId: string): Promise<Map<string, ModuleVersionNumber>> {
  const rows = await locked.moduleVersion.findMany({
    where: { moduleId },
    select: {
      id: true, versionNo: true, publishedAt: true, createdAt: true, versionMajor: true, versionMinor: true,
      _count: { select: { submissions: true } },
      activeForModules: { select: { id: true } },
    },
  });
  // Publisert er ikke nok som kjennetegn: testdata og gamle rader kan være aktive, eller ha innleveringer, uten
  // `publishedAt`. Et vedtak på en versjon uten nummer ville aldri kunne telle.
  const versions: NumberingVersion[] = rows.map((row) => ({
    id: row.id,
    versionNo: row.versionNo,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    versionMajor: row.versionMajor,
    versionMinor: row.versionMinor,
    live: row.publishedAt !== null || row.activeForModules.length > 0 || row._count.submissions > 0,
  }));
  if (!versions.some((v) => v.live && v.versionMajor === null)) return new Map();

  const trailRows = await locked.auditEvent.findMany({
    where: { entityType: auditEntityTypes.module, entityId: moduleId, action: auditActions.adminContent.modulePassesSuperseded },
    select: { timestamp: true, metadataJson: true },
  });
  const trail: RevisionTrailEvent[] = trailRows.map((row) => {
    const metadata = metadataOf(row.metadataJson);
    return {
      at: row.timestamp,
      versionId: typeof metadata.moduleVersionId === "string" ? metadata.moduleVersionId : null,
      supersededCount: typeof metadata.supersededCount === "number" ? metadata.supersededCount : null,
    };
  });
  const superseded = await locked.certificationStatus.findMany({
    where: { moduleId, supersededByVersionId: { not: null } },
    distinct: ["supersededByVersionId"],
    select: { supersededByVersionId: true },
  });

  const assigned = numberModuleVersions(
    versions,
    findVersionsStartingMajor(trail, superseded.flatMap((row) => (row.supersededByVersionId ? [row.supersededByVersionId] : []))),
  );
  for (const [id, number] of assigned) {
    await locked.moduleVersion.update({ where: { id }, data: { versionMajor: number.major, versionMinor: number.minor } });
  }
  return assigned;
}

/** Modulens nåværende hovedversjon. En modul som aldri har vært ute, står på 1: første publisering gir 1.0. */
export async function currentModuleMajor(locked: ContentWriteTx, moduleId: string): Promise<number> {
  await numberModuleHistory(locked, moduleId);
  const highest = await locked.moduleVersion.aggregate({ where: { moduleId }, _max: { versionMajor: true } });
  return highest._max.versionMajor ?? 1;
}

/**
 * Nummeret versjonen skal ha etter denne publiseringen. Kalles bare fra `publishModuleVersion` i adminContentRepository.ts.
 * Her er de to siste radene i sannhetstabellen:
 *   - en versjon som har nummer, får ikke ny hovedversjon. Et nummer som er gitt, endres ikke;
 *   - en versjon med lavere hovedversjon enn den høyeste kan ikke publiseres. Da ville kravet aldri kunne oppfylles.
 *     «Gjenopprett» lager en ny versjon av den.
 */
export async function resolvePublishNumber(
  locked: ContentWriteTx,
  moduleId: string,
  moduleVersionId: string,
  kind: ModuleVersionKind,
): Promise<ModuleVersionNumber> {
  await numberModuleHistory(locked, moduleId);
  const rows = await locked.moduleVersion.findMany({
    where: { moduleId, versionMajor: { not: null }, versionMinor: { not: null } },
    select: { id: true, versionMajor: true, versionMinor: true },
  });
  let highest: ModuleVersionNumber | null = null;
  let own: ModuleVersionNumber | null = null;
  for (const row of rows) {
    const number: ModuleVersionNumber = { major: row.versionMajor as number, minor: row.versionMinor as number };
    if (!highest || isHigher(number, highest)) highest = number;
    if (row.id === moduleVersionId) own = number;
  }
  if (own && highest) {
    if (kind === "major") {
      throw new AppError(
        "module_version_number_fixed",
        409,
        "This version has been published before, so it cannot become a new major version. Save a new version and publish that. Nothing was published.",
      );
    }
    if (own.major < highest.major) {
      throw new AppError(
        "module_version_outdated",
        409,
        "This version belongs to an older major version of the module and cannot be published again. Restore it as a new version instead. Nothing was published.",
      );
    }
    return own;
  }
  if (!highest) return { major: 1, minor: 0 };
  return kind === "major" ? { major: highest.major + 1, minor: 0 } : { major: highest.major, minor: highest.minor + 1 };
}

/**
 * #934 skive 5a-3: kurset fikk hovedversjon på grunn av en ny versjon av modulen. Kravet heves i dette kurset, og bare her: et
 * kurs som valgte mindre, beholder sitt. Det senkes aldri. Svarer om det faktisk ble hevet. Kalles fra
 * `applyCourseVersionChange`, i transaksjonen som lager hovedversjonen.
 */
export async function raiseModuleRequirementInCourse(locked: ContentWriteTx, courseId: string, moduleId: string, major: number): Promise<boolean> {
  const created = await locked.courseModuleRequirement.createMany({ data: [{ courseId, moduleId, minModuleMajor: major }], skipDuplicates: true });
  if (created.count > 0) return true;
  const raised = await locked.courseModuleRequirement.updateMany({
    where: { courseId, moduleId, minModuleMajor: { lt: major } },
    data: { minModuleMajor: major },
  });
  return raised.count > 0;
}

/**
 * #1140 etappe 1 (doc/DESIGN_1140.md): hovedversjonen kursene VISER av modulene. Bare kurs som har låst en hovedversjon, er med;
 * et kurs som mangler her, følger modulens nyeste. Den ENE leseren av `shownModuleMajor` (vakt: content-lock-write-guard).
 * Regelen for hvem som får hva, bor i `participantModuleVersion.ts`.
 */
export async function findShownModuleMajors(
  client: Pick<DbTransactionClient, "courseModuleRequirement">,
  where: { moduleIds: string[]; courseIds?: string[] },
): Promise<Array<{ courseId: string; moduleId: string; shownModuleMajor: number }>> {
  if (where.moduleIds.length === 0 || where.courseIds?.length === 0) return [];
  const rows = await client.courseModuleRequirement.findMany({
    where: {
      moduleId: { in: where.moduleIds },
      shownModuleMajor: { not: null },
      ...(where.courseIds ? { courseId: { in: where.courseIds } } : {}),
    },
    select: { courseId: true, moduleId: true, shownModuleMajor: true },
  });
  return rows.flatMap((row) => (row.shownModuleMajor === null ? [] : [{ courseId: row.courseId, moduleId: row.moduleId, shownModuleMajor: row.shownModuleMajor }]));
}

/** #934 skive 5a-3: hvilke av modulene som ligger i hvilke av kursene. Også arkiverte og avpubliserte teller. */
export async function findModulePlacements(locked: ContentWriteTx, courseIds: string[], moduleIds: string[]): Promise<Array<{ courseId: string; moduleId: string }>> {
  const rows = await locked.courseItem.findMany({
    where: { courseId: { in: courseIds }, moduleId: { in: moduleIds } },
    select: { courseId: true, moduleId: true },
  });
  return rows.flatMap((row) => (row.moduleId ? [{ courseId: row.courseId, moduleId: row.moduleId }] : []));
}

/** #934 skive 5a-3: modulene som har vært ute før: publisert, med nummer, eller noen har levert på dem. */
export async function findModulesPublishedBefore(client: Pick<DbTransactionClient, "moduleVersion">, moduleIds: string[]): Promise<Set<string>> {
  if (moduleIds.length === 0) return new Set();
  const rows = await client.moduleVersion.findMany({
    where: {
      moduleId: { in: moduleIds },
      OR: [{ publishedAt: { not: null } }, { versionMajor: { not: null } }, { submissions: { some: {} } }],
    },
    distinct: ["moduleId"],
    select: { moduleId: true },
  });
  return new Set(rows.map((row) => row.moduleId));
}

/**
 * Kursets elementer er endret: en ny modul får krav lik sin nåværende hovedversjon, og en modul som er tatt ut, mister raden.
 * En modul som allerede ligger i kurset, står urørt: kravet senkes aldri, og heves bare av en hovedversjon. Kalles der
 * elementene skrives (`setCourseItems`, `setCourseModules` og kursskjemaet), i samme transaksjon.
 */
export async function syncModuleRequirements(locked: ContentWriteTx, courseId: string): Promise<void> {
  const items = await locked.courseItem.findMany({
    where: { courseId, itemType: "MODULE", moduleId: { not: null } },
    select: { moduleId: true },
  });
  const moduleIds = items.flatMap((item) => (item.moduleId ? [item.moduleId] : []));
  await locked.courseModuleRequirement.deleteMany({ where: { courseId, moduleId: { notIn: moduleIds } } });
  const existing = await locked.courseModuleRequirement.findMany({ where: { courseId }, select: { moduleId: true } });
  const known = new Set(existing.map((row) => row.moduleId));
  const missing = [...new Set(moduleIds)].filter((id) => !known.has(id));
  if (missing.length === 0) return;
  const data: Array<{ courseId: string; moduleId: string; minModuleMajor: number }> = [];
  for (const moduleId of missing) {
    data.push({ courseId, moduleId, minModuleMajor: await currentModuleMajor(locked, moduleId) });
  }
  await locked.courseModuleRequirement.createMany({ data });
}
