// #1152 skive 4c (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Byggenotat for 4c», «Codex leste byggenotatet» punkt 3–8 og
// «Gjennomlesing av byggenotatet mot koden»): SLETTEJOBBEN FOR ARKIVERT INNHOLD. Én runde; overvåkeren
// (ArchivedContentRetentionMonitor.ts) kaller den hvert tiende minutt.
//
// HVA EN RUNDE GJØR
//   1. Utenfor vinduet (02:00–05:00 norsk tid) eller med nødstoppen på (`PlatformConfig`-raden, se config/retention.ts): ingenting.
//   2. Overgangsraden leses. Mangler den, eller kan den ikke leses: ingenting slettes, og grunnen står i sammendraget.
//   3. Kandidatene velges UTEN lås: arkiverte kurs, så moduler, så seksjoner, der fristen (`archivedContentDeletesOn`) er i dag eller
//      tidligere. Stabil rekkefølge (type, `archivedAt`, id), så neste runde fortsetter der denne slapp.
//   4. Hver kandidat sjekkes først uten lås med den samme sjekken som «Slett» og lista bruker (`checkCourseDelete`,
//      `checkModuleDelete`, `checkSectionDelete`). Holdes den igjen, er svaret «beholdes», uten noen låst transaksjon (punkt C: kurs
//      med kursbevis skal ikke måles under deltakerlåsene hver natt).
//   5. Kan den slettes: ÉN transaksjon under innholdslåsen. Elementet, `archivedAt` og overgangsraden leses på nytt, fristen regnes på
//      nytt, og så kalles den samme indre slettefunksjonen som knappen (`deleteCourseInTx`, `deleteModuleInTx`, `deleteSectionInTx`),
//      med `source: "retention"`. Den måler vaktene på nytt under låsene og kaster om noe holder igjen.
//   6. Budsjettet (4 minutter), vinduet og stoppsignalet sjekkes før hver kandidat.
//
// INGEN EGNE SLETTEREGLER. Jobben vet bare «når», aldri «om»: alt som avgjør om noe kan slettes, er vaktene i de tre funksjonene.
// Dekningsvakta (test/unit/archived-retention-job-guard.test.js) krever at fila ikke har en egen `delete`/`deleteMany`.
//
// «BEHOLDES» skrives i revisjonsloggen (`retention_kept`) én gang per element etter siste arkivering, aldri som grunnlag for en
// avgjørelse. Bare vaktenes svar (en `AppError` under 500) er «beholdes». `content_busy` og andre driftsfeil prøves igjen neste runde.
// Et element som holdes igjen av et kurs, huskes ikke for natten: kurset kan bli slettet i en senere runde samme natt.
import { prisma } from "../../db/prisma.js";
import { runContentWrite, type ContentWriteTx } from "../../db/contentLock.js";
import { AppError } from "../../errors/AppError.js";
import {
  ARCHIVED_CONTENT_PURGE_ENABLED_KEY,
  ARCHIVED_CONTENT_PURGE_WINDOW_HOURS,
  ARCHIVED_CONTENT_RETENTION_FLOOR_KEY,
} from "../../config/retention.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { checkModuleDelete, deleteModuleInTx } from "../adminContent/adminContentCommands.js";
import { reclaimAssetBlobs } from "../course/assetCommands.js";
import { COURSE_DELETE_TX_TIMEOUT_MS, deleteCourseInTx } from "../course/courseCommands.js";
import { checkCourseDelete } from "../course/courseDeleteGuard.js";
import { checkSectionDelete, deleteSectionInTx } from "../course/sectionCommands.js";
import type { LifecycleReader } from "../course/contentLifecycle.js";
import { createRetentionContext, evaluateArchivedCourse, evaluateArchivedItems } from "./archivedRetention.js";
import type { DeleteCheck } from "./deleteCheck.js";
import { archivedContentDeletesOn, osloDateString, parseRetentionFloor } from "./retentionDeadline.js";

export type RetentionKind = "COURSE" | "MODULE" | "SECTION";
const KINDS: readonly RetentionKind[] = ["COURSE", "MODULE", "SECTION"];

/** Rundens tidsbudsjett: godt under overvåkerens `maxTickMs` (10 min), med plass til én kurstransaksjon etter siste sjekk. */
export const RETENTION_ROUND_BUDGET_MS = 4 * 60_000;
/** Ryddingen av bildefiler etter en seksjon venter ikke lenger enn dette (planen, punkt 3). */
const BLOB_RECLAIM_TIMEOUT_MS = 30_000;

/** Koder som betyr «holdes igjen av et kurs»: kurset kan bli slettet senere samme natt, så elementet huskes ikke. */
const HELD_BY_COURSE = new Set(["content_in_archived_course", "content_in_use", "module_in_use"]);

const ENTITY: Record<RetentionKind, string> = {
  COURSE: auditEntityTypes.course,
  MODULE: auditEntityTypes.module,
  SECTION: auditEntityTypes.courseSection,
};

export type RetentionRoundOptions = {
  /** Klokka (tester og forhåndsvisning flytter den). Leses før hver kandidat. */
  clock?: () => Date;
  budgetMs?: number;
  /** Overvåkeren stopper: sjekkes før hver kandidat. */
  shouldStop?: () => boolean;
  /** Elementene som er funnet «beholdes» i natt (`kind:id` → norsk dato). Overvåkeren holder den mellom rundene. */
  keptTonight?: Map<string, string>;
  reader?: LifecycleReader;
  /**
   * Bare disse id-ene (testene). Testdatabasen er delt med alle andre testfiler, og uten avgrensningen ville en runde med flyttet klokke
   * slettet alt de har lagt igjen. Jobben i workeren sender den aldri.
   */
  onlyIds?: ReadonlySet<string>;
};

export type RetentionRoundSummary = {
  skipped?: "outside_window" | "stopped" | "floor_unavailable";
  today?: string;
  candidates: number;
  deleted: Record<RetentionKind, number>;
  kept: number;
  notDue: number;
  gone: number;
  failed: Array<{ kind: RetentionKind; id: string; error: string }>;
  stoppedBy?: "budget" | "window" | "stop" | "purge_disabled";
};

/** Er klokkeslettet i vinduet (norsk tid)? */
export function insidePurgeWindow(at: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", hour: "2-digit", hourCycle: "h23" }).format(at));
  return hour >= ARCHIVED_CONTENT_PURGE_WINDOW_HOURS.from && hour < ARCHIVED_CONTENT_PURGE_WINDOW_HOURS.to;
}

/** Nødstoppen: raden «false» stopper jobben; ingen rad, eller noe annet, lar den gå. */
export async function isPurgeEnabled(reader: LifecycleReader = prisma): Promise<boolean> {
  const row = await reader.platformConfig.findUnique({ where: { key: ARCHIVED_CONTENT_PURGE_ENABLED_KEY }, select: { value: true } });
  return row?.value?.trim().toLowerCase() !== "false";
}

async function readFloor(reader: LifecycleReader): Promise<Date | null> {
  const row = await reader.platformConfig.findUnique({ where: { key: ARCHIVED_CONTENT_RETENTION_FLOOR_KEY }, select: { value: true } });
  return parseRetentionFloor(row?.value);
}

async function readArchivedAt(reader: LifecycleReader, kind: RetentionKind, id: string): Promise<Date | null> {
  const select = { archivedAt: true } as const;
  const row =
    kind === "COURSE"
      ? await reader.course.findUnique({ where: { id }, select })
      : kind === "MODULE"
        ? await reader.module.findUnique({ where: { id }, select })
        : await reader.courseSection.findUnique({ where: { id }, select });
  return row?.archivedAt ?? null;
}

/** Steg 3: kandidatene, uten lås. Bare et utvalg; ingenting avgjøres her. */
export async function findDueCandidates(
  reader: LifecycleReader,
  floor: Date,
  today: string,
): Promise<Array<{ kind: RetentionKind; id: string; archivedAt: Date }>> {
  const where = { archivedAt: { not: null } } as const;
  const select = { id: true, archivedAt: true } as const;
  const orderBy = [{ archivedAt: "asc" as const }, { id: "asc" as const }];
  const [courses, modules, sections] = await Promise.all([
    reader.course.findMany({ where, select, orderBy }),
    reader.module.findMany({ where, select, orderBy }),
    reader.courseSection.findMany({ where, select, orderBy }),
  ]);
  const due = (kind: RetentionKind, rows: Array<{ id: string; archivedAt: Date | null }>) =>
    rows.flatMap((row) => (row.archivedAt && archivedContentDeletesOn(row.archivedAt, floor) <= today ? [{ kind, id: row.id, archivedAt: row.archivedAt }] : []));
  return [...due("COURSE", courses), ...due("MODULE", modules), ...due("SECTION", sections)];
}

function precheck(kind: RetentionKind, id: string, reader: LifecycleReader, now: Date): Promise<DeleteCheck> {
  if (kind === "COURSE") return checkCourseDelete(id, reader, { now });
  if (kind === "MODULE") return checkModuleDelete(id, reader);
  return checkSectionDelete(id, reader);
}

/**
 * «Beholdes» i revisjonsloggen, én gang per element etter siste arkivering. Oppslaget gjøres først uten lås; bare når hendelsen
 * mangler, åpnes en kort transaksjon under innholdslåsen som sjekker at `archivedAt` er den samme, og slår opp og skriver der.
 * Hendelsen er historikk, aldri grunnlag for en avgjørelse.
 */
async function recordKeptOnce(reader: LifecycleReader, kind: RetentionKind, id: string, archivedAt: Date, code: string): Promise<boolean> {
  const where = { entityType: ENTITY[kind], entityId: id, action: auditActions.retention.kept, timestamp: { gte: archivedAt } };
  if (await reader.auditEvent.findFirst({ where, select: { id: true } })) return false;
  return runContentWrite(async (tx) => {
    const fresh = await readArchivedAt(tx, kind, id);
    if (!fresh || fresh.getTime() !== archivedAt.getTime()) return false;
    if (await tx.auditEvent.findFirst({ where, select: { id: true } })) return false;
    await recordAuditEvent(
      {
        entityType: ENTITY[kind] as typeof auditEntityTypes.course,
        entityId: id,
        action: auditActions.retention.kept,
        metadata: { kind, code, archivedAt: archivedAt.toISOString(), source: "retention" },
      },
      tx,
    );
    return true;
  });
}

export type LockedOutcome = { outcome: "deleted"; blobPaths: string[] } | { outcome: "gone" } | { outcome: "not_due" };

/**
 * Steg 5: én sletting, under innholdslåsen, med alt lest på nytt. Vaktene kaster; det fanges av kalleren. Eksportert for testen av
 * «gjenopprettet og arkivert på nytt etter at kandidatene ble valgt».
 */
export async function deleteUnderLock(kind: RetentionKind, id: string, now: Date, today: string): Promise<LockedOutcome> {
  return runContentWrite(
    async (tx: ContentWriteTx): Promise<LockedOutcome> => {
      const archivedAt = await readArchivedAt(tx, kind, id);
      if (!archivedAt) return { outcome: "gone" };
      const floor = await readFloor(tx);
      // Gjenopprettet og arkivert på nytt imens, eller gulvet er borte: ikke i natt.
      if (!floor || archivedContentDeletesOn(archivedAt, floor) > today) return { outcome: "not_due" };
      if (kind === "COURSE") {
        const result = await deleteCourseInTx(tx, id, { source: "retention", now });
        return result.deleted ? { outcome: "deleted", blobPaths: [] } : { outcome: "gone" };
      }
      if (kind === "MODULE") {
        const result = await deleteModuleInTx(tx, id, { source: "retention" });
        return result.deleted ? { outcome: "deleted", blobPaths: [] } : { outcome: "gone" };
      }
      const result = await deleteSectionInTx(tx, id, { source: "retention" });
      return result.deleted ? { outcome: "deleted", blobPaths: result.blobPaths } : { outcome: "gone" };
    },
    { timeout: COURSE_DELETE_TX_TIMEOUT_MS },
  );
}

async function reclaimWithTimeout(blobPaths: string[]): Promise<void> {
  if (blobPaths.length === 0) return;
  await Promise.race([reclaimAssetBlobs(blobPaths), new Promise((resolve) => setTimeout(resolve, BLOB_RECLAIM_TIMEOUT_MS))]);
}

/** En vaktfeil («beholdes»), til forskjell fra en driftsfeil (`content_busy`, databasen borte), som prøves igjen. */
function isGuardRefusal(error: unknown): error is AppError {
  return error instanceof AppError && error.httpStatus < 500;
}

export async function runArchivedRetentionRound(options: RetentionRoundOptions = {}): Promise<RetentionRoundSummary> {
  const clock = options.clock ?? (() => new Date());
  const reader = options.reader ?? prisma;
  const budgetMs = options.budgetMs ?? RETENTION_ROUND_BUDGET_MS;
  const keptTonight = options.keptTonight ?? new Map<string, string>();
  const startedAt = Date.now();
  const summary: RetentionRoundSummary = { candidates: 0, deleted: { COURSE: 0, MODULE: 0, SECTION: 0 }, kept: 0, notDue: 0, gone: 0, failed: [] };

  const start = clock();
  if (!insidePurgeWindow(start)) return { ...summary, skipped: "outside_window" };
  if (!(await isPurgeEnabled(reader))) return { ...summary, skipped: "stopped" };
  const floor = await readFloor(reader);
  if (!floor) return { ...summary, skipped: "floor_unavailable" };
  const today = osloDateString(start);
  summary.today = today;
  // Gårsdagens «beholdes» gjelder ikke i natt.
  for (const [key, date] of keptTonight) if (date !== today) keptTonight.delete(key);

  const all = await findDueCandidates(reader, floor, today);
  const candidates = options.onlyIds ? all.filter((candidate) => options.onlyIds!.has(candidate.id)) : all;
  summary.candidates = candidates.length;

  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.id}`;
    if (keptTonight.get(key) === today) continue;
    if (options.shouldStop?.()) { summary.stoppedBy = "stop"; break; }
    if (Date.now() - startedAt >= budgetMs) { summary.stoppedBy = "budget"; break; }
    const now = clock();
    if (!insidePurgeWindow(now)) { summary.stoppedBy = "window"; break; }
    // Nødstoppen virker før neste element, ikke først neste runde (QA 2.175.0): én indeksert lesing.
    if (!(await isPurgeEnabled(reader))) { summary.stoppedBy = "purge_disabled"; break; }

    const keep = async (code: string) => {
      summary.kept += 1;
      await recordKeptOnce(reader, candidate.kind, candidate.id, candidate.archivedAt, code);
      if (!HELD_BY_COURSE.has(code)) keptTonight.set(key, today);
    };

    try {
      const check = await precheck(candidate.kind, candidate.id, reader, now);
      if (check.status === "not_found") { summary.gone += 1; continue; }
      if (check.status === "blocked") { await keep(check.error.code); continue; }
      const result = await deleteUnderLock(candidate.kind, candidate.id, now, today);
      if (result.outcome === "deleted") {
        summary.deleted[candidate.kind] += 1;
        await reclaimWithTimeout(result.blobPaths);
      } else if (result.outcome === "gone") {
        summary.gone += 1;
      } else {
        summary.notDue += 1;
      }
    } catch (error) {
      if (isGuardRefusal(error)) {
        try { await keep(error.code); } catch (inner) {
          summary.failed.push({ kind: candidate.kind, id: candidate.id, error: inner instanceof Error ? inner.message : String(inner) });
        }
        continue;
      }
      summary.failed.push({ kind: candidate.kind, id: candidate.id, error: error instanceof AppError ? error.code : error instanceof Error ? error.message : String(error) });
    }
  }
  return summary;
}

// ── Forhåndsvisningen (vedlikeholdsskriptet) ─────────────────────────────────────────────────────────────────────────────────

export type RetentionPreviewRow = { kind: RetentionKind; id: string; title: string; archivedAt: string; verdict: "deletes" | "kept" | "not_due" | "unknown"; detail: string };

function titleOf(raw: unknown): string {
  if (typeof raw !== "string") return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed.nb ?? parsed["en-GB"] ?? parsed.nn ?? raw;
  } catch {
    return raw;
  }
}

/**
 * Hva jobben ville gjort natten `asOf` (planen, punkt 6): den samme vurderingen som lista over arkiverte (`evaluateArchivedCourse`,
 * `evaluateArchivedItems`, med kursene som slettes først), regnet mot den tenkte datoen. «deletes» betyr at datoen er nådd innen
 * `asOf`. Bare lesing, uten lås. Vurderer dagens historikk: det som skjer mellom nå og `asOf`, er ikke med.
 */
export async function previewArchivedRetention(asOf: Date, reader: LifecycleReader = prisma): Promise<RetentionPreviewRow[]> {
  const ctx = await createRetentionContext(reader, asOf);
  const asOfDate = osloDateString(asOf);
  const select = { id: true, title: true, archivedAt: true } as const;
  const where = { archivedAt: { not: null } } as const;
  const [courses, modules, sections] = await Promise.all([
    reader.course.findMany({ where, select }),
    reader.module.findMany({ where, select }),
    reader.courseSection.findMany({ where, select }),
  ]);
  const rows: RetentionPreviewRow[] = [];
  const verdictOf = (answer: Awaited<ReturnType<typeof evaluateArchivedCourse>>): Pick<RetentionPreviewRow, "verdict" | "detail"> => {
    if ("deletesAt" in answer) return answer.deletesAt <= asOfDate ? { verdict: "deletes", detail: answer.deletesAt } : { verdict: "not_due", detail: answer.deletesAt };
    if ("kept" in answer) return { verdict: "kept", detail: answer.kept.code };
    return { verdict: "unknown", detail: "floor_unavailable" };
  };
  for (const course of courses) {
    rows.push({ kind: "COURSE", id: course.id, title: titleOf(course.title), archivedAt: course.archivedAt!.toISOString(), ...verdictOf(await evaluateArchivedCourse(ctx, course.id)) });
  }
  for (const [kind, list] of [["MODULE", modules], ["SECTION", sections]] as const) {
    const answers = await evaluateArchivedItems(ctx, kind, list.map((row) => row.id));
    for (const row of list) {
      const answer = answers.get(row.id);
      rows.push({ kind, id: row.id, title: titleOf(row.title), archivedAt: row.archivedAt!.toISOString(), ...(answer ? verdictOf(answer) : { verdict: "unknown", detail: "" }) });
    }
  }
  return rows;
}
