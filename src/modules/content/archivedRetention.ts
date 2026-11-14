// #1152 skive 4b (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Hva forfatteren ser», «Byggeplan» 4b og «Etter gjennomlesingen»
// punkt 5, 7, 8 og 9): HVA SKJER MED DETTE ARKIVERTE ELEMENTET? Ett svar per arkivert kurs, modul og seksjon:
//
//   { deletesAt: "2027-05-13" }                 kan slettes fra og med datoen (norsk kalender, retentionDeadline.ts)
//   { kept: { code, details } }                 beholdes; `code` er feilkoden «Slett» ville gitt, `details` tallene og navnene
//   { unknown: true }                           overgangsraden mangler eller kan ikke leses: ingen dato, aldri en gjetning
//
// ⚠️ SAMME UTREGNING SOM «SLETT». Svaret kommer fra sjekkene i content/deleteCheck.ts: `checkCourseDelete` (den samme `deleteCourseInTx`
// kaster fra), og `checkModuleDeletes`/`checkSectionDeletes`, som leser dataene for mange elementer i én omgang, men kjører de samme
// reglene som `deleteModuleInTx` og `deleteSectionInTx` (`moduleDeleteRules`, `sectionDeleteRules`). Sier lista «slettes», sletter
// «Slett»; sier den «beholdes: X», svarer «Slett» X. Ingen egne regler her, bare to tillegg:
//
//   1. FRISTEN: seks kalendermåneder etter det seneste av `archivedAt` og overgangstidspunktet (`PlatformConfig`).
//   2. ET ELEMENT I ET KURS SOM SELV SKAL SLETTES (punkt 7): jobben sletter kursene først, og da er koblingen borte. Et element som
//      holdes igjen av arkiverte kurs der minst ett kan slettes, vurderes på nytt slik det står når de er borte
//      (`coursesDeletedFirst`). Kan det da slettes, er datoen den seneste av elementets egen og kursenes. Holdes det igjen av et kurs
//      som BEHOLDES, er svaret `content_in_archived_course` («ligger i et kurs som beholdes»).
//
// INGEN LÅS. Lista leser uten innholdslåsen og uten deltakerlåsene: den viser et forslag. «Slett» og jobben (4c) måler på nytt under
// låsene. Et vedtak som kommer mellom lista og slettingen, vises ved neste lesing.
//
// KOSTNAD (punkt 9): bare arkiverte rader vurderes; hvert kurs vurderes høyst én gang per forespørsel (`RetentionContext.courses`), og
// bare til første grunn (`stopAtFirst`); modulene, kursene de ligger i og utkastene leses i én omgang, og det som må spørres per
// element (seksjonens kursbevis) og per kurs, går fire om gangen, som tellingen i kurslista. Målt lokalt 14.11.2026 (85 kurs, 26
// arkiverte med historikk, 128 arkiverte moduler, 82 arkiverte seksjoner; median av fem): kurslista 184 → 260 ms, modulbiblioteket
// 49 → 178 ms, seksjonslista 50 → 196 ms. Mest av tillegget er kursvakta for de arkiverte kursene. På stage (2.162.0, ekte data) ble
// kurslista 3,1 s; fra 4b-2 regnes svaret derfor bare på forespørsel (`retentionRequested`), når forfatteren velger «Arkiverte».
import { prisma } from "../../db/prisma.js";
import { ARCHIVED_CONTENT_RETENTION_FLOOR_KEY } from "../../config/retention.js";
import type { AppError } from "../../errors/AppError.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import { checkModuleDeletes } from "../adminContent/adminContentCommands.js";
import type { LifecycleReader } from "../course/contentLifecycle.js";
import { checkCourseDelete } from "../course/courseDeleteGuard.js";
import { checkSectionDeletes } from "../course/sectionCommands.js";
import type { DeleteCheck } from "./deleteCheck.js";
import { archivedContentDeletesOn, latestDate, parseRetentionFloor } from "./retentionDeadline.js";

/**
 * #1152 skive 4b-2 (produkteier 14.11.2026, etter stage 2.162.0): listene regner svaret bare når klienten ber om det
 * (`?includeRetention=1`), det vil si når forfatteren åpner «Arkiverte». Uten parameteren leses verken overgangsraden eller vaktene,
 * og lista koster det den gjorde i 2.161. Modulvelgeren i kursbyggeren og Kvalitet-siden ber aldri om det.
 */
export function retentionRequested(value: unknown): boolean {
  return value === "1" || value === "true";
}

export type ArchivedRetention =
  | { deletesAt: string }
  | { kept: { code: string; details: Record<string, unknown> | null } }
  | { unknown: true };

/** Det én forespørsel deler: overgangstidspunktet (lest én gang) og svaret for hvert kurs som er vurdert. */
export type RetentionContext = {
  floor: Date | null;
  reader: LifecycleReader;
  courses: Map<string, Promise<ArchivedRetention>>;
};

type ItemKind = "MODULE" | "SECTION";

const UNKNOWN: ArchivedRetention = { unknown: true };
/** Fire om gangen: samme støt mot databasen som tellingen i kurslista (routes/adminCourses.ts). */
const BATCH = 4;

let floorProblemLogged = false;

/** Leser overgangstidspunktet. Mangler raden, eller kan den ikke leses, er svaret for alt «ukjent», og det logges én gang. */
export async function createRetentionContext(reader: LifecycleReader = prisma): Promise<RetentionContext> {
  const row = await reader.platformConfig.findUnique({ where: { key: ARCHIVED_CONTENT_RETENTION_FLOOR_KEY }, select: { value: true } });
  const floor = parseRetentionFloor(row?.value);
  if (!floor && !floorProblemLogged) {
    floorProblemLogged = true;
    logOperationalEvent(
      operationalEvents.retention.archivedFloorUnavailable,
      { key: ARCHIVED_CONTENT_RETENTION_FLOOR_KEY, reason: row ? "unparseable" : "missing" },
      "warn",
    );
  }
  return { floor, reader, courses: new Map() };
}

function keptFrom(error: AppError): ArchivedRetention {
  const details = error.details && typeof error.details === "object" ? (error.details as Record<string, unknown>) : null;
  return { kept: { code: error.code, details } };
}

function fromCheck(check: DeleteCheck | undefined, floor: Date): ArchivedRetention {
  if (!check || check.status === "not_found") return UNKNOWN;
  if (check.status === "blocked") return keptFrom(check.error);
  return { deletesAt: archivedContentDeletesOn(check.archivedAt, floor) };
}

/** Et arkivert kurs. Vurderes høyst én gang per forespørsel. */
export function evaluateArchivedCourse(ctx: RetentionContext, courseId: string): Promise<ArchivedRetention> {
  const cached = ctx.courses.get(courseId);
  if (cached) return cached;
  const floor = ctx.floor;
  const result = floor ? checkCourseDelete(courseId, ctx.reader).then((check) => fromCheck(check, floor)) : Promise.resolve(UNKNOWN);
  ctx.courses.set(courseId, result);
  return result;
}

async function evaluateCourses(ctx: RetentionContext, courseIds: readonly string[]): Promise<Map<string, ArchivedRetention>> {
  const answers = new Map<string, ArchivedRetention>();
  const ids = [...new Set(courseIds)];
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map((id) => evaluateArchivedCourse(ctx, id)));
    chunk.forEach((id, j) => answers.set(id, results[j] ?? UNKNOWN));
  }
  return answers;
}

function checkItems(
  ctx: RetentionContext,
  kind: ItemKind,
  ids: readonly string[],
  coursesDeletedFirst?: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<Map<string, DeleteCheck>> {
  return kind === "MODULE"
    ? checkModuleDeletes(ids, ctx.reader, { coursesDeletedFirst })
    : checkSectionDeletes(ids, ctx.reader, { coursesDeletedFirst });
}

/** Mange arkiverte moduler eller seksjoner. Svaret har en oppføring per id. */
export async function evaluateArchivedItems(ctx: RetentionContext, kind: ItemKind, ids: readonly string[]): Promise<Map<string, ArchivedRetention>> {
  const result = new Map<string, ArchivedRetention>();
  const floor = ctx.floor;
  if (!floor) {
    for (const id of ids) result.set(id, UNKNOWN);
    return result;
  }
  const checks = await checkItems(ctx, kind, ids);

  // Punkt 7: elementene som holdes igjen av arkiverte kurs. Kursenes egne svar avgjør; de som kan slettes, er borte når jobben kommer
  // til elementet.
  const heldByArchived = new Map<string, string[]>();
  for (const [id, check] of checks) {
    if (check.status !== "blocked" || check.error.code !== "content_in_archived_course") continue;
    heldByArchived.set(id, (check.heldBy ?? []).filter((course) => course.archived).map((course) => course.id));
  }
  const courseAnswers = await evaluateCourses(ctx, [...heldByArchived.values()].flat());
  const goingFirst = new Map<string, Set<string>>();
  const courseDates = new Map<string, string[]>();
  for (const [id, courseIds] of heldByArchived) {
    const going = courseIds.filter((courseId) => {
      const answer = courseAnswers.get(courseId);
      return Boolean(answer && "deletesAt" in answer);
    });
    if (going.length === 0) continue;
    goingFirst.set(id, new Set(going));
    courseDates.set(id, going.map((courseId) => (courseAnswers.get(courseId) as { deletesAt: string }).deletesAt));
  }
  const after = goingFirst.size > 0 ? await checkItems(ctx, kind, [...goingFirst.keys()], goingFirst) : new Map<string, DeleteCheck>();

  for (const id of ids) {
    if (!goingFirst.has(id)) {
      result.set(id, fromCheck(checks.get(id), floor));
      continue;
    }
    const answer = fromCheck(after.get(id), floor);
    result.set(id, "deletesAt" in answer ? { deletesAt: latestDate([answer.deletesAt, ...(courseDates.get(id) ?? [])]) } : answer);
  }
  return result;
}

/** Én arkivert modul eller seksjon (samme utregning som for mange). */
export async function evaluateArchivedItem(ctx: RetentionContext, kind: ItemKind, id: string): Promise<ArchivedRetention> {
  return (await evaluateArchivedItems(ctx, kind, [id])).get(id) ?? UNKNOWN;
}
