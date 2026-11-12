// #1140 etappe 2 (doc/design/PLAN_1140_E2.md): utkastet til et publisert kurs.
//
// Et publisert kurs redigeres gjennom ETT utkast: det kursskjemaet lagrer, lagt ved siden av den publiserte utgaven. Ingenting
// deltakerne ser, endres før utkastet publiseres. ALT som leser eller skriver `CourseDraft`, bor i denne fila (vakt:
// test/course-draft-guard.test.js). Kursbyggerens ruter (routes/adminCourses.ts) er de eneste som viser et utkast; låsesjekken
// under kalles fra `claimCourseRevision`.
//
// Ingen bryter (produkteier 2026-11-12: «er det ikke enklere at det standard er på? Vi har ingen bryter for lignende
// funksjonalitet for moduler»). Skive 2a og 2b hadde en (`course_drafts` i `PlatformConfig`) mens serveren ble rullet ut
// før kursbyggeren. Den er fjernet, og med den reglene for «utkast finnes, men bryteren er av» og for utdaterte utkast.
//
// Innholdet i utkastet (`payloadText`) er kroppen `PUT …/content` tar imot, etter validering. Denne fila tolker den ikke:
// rutene eier skjemaet, og leser teksten gjennom det både ved henting og ved publisering.
import { runContentWrite, type ContentWriteTx } from "../../db/contentLock.js";
import type { DbTransactionClient } from "../../db/transaction.js";
import { ConflictError, NotFoundError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";

type DraftReader = Pick<DbTransactionClient, "courseDraft">;

export type CourseDraftRow = {
  id: string;
  courseId: string;
  payloadText: string;
  baseRevision: number;
  revision: number;
  source: string;
  updatedById: string | null;
  updatedAt: Date;
};

const DRAFT_SELECT = {
  id: true,
  courseId: true,
  payloadText: true,
  baseRevision: true,
  revision: true,
  source: true,
  updatedById: true,
  updatedAt: true,
} as const;

export function findCourseDraft(client: DraftReader, courseId: string): Promise<CourseDraftRow | null> {
  return client.courseDraft.findUnique({ where: { courseId }, select: DRAFT_SELECT });
}

/** Kursene i lista som har et utkast. For kurslista («Nyere utkast») og kursdetaljen. */
export async function findCourseIdsWithDraft(client: DraftReader, courseIds: readonly string[]): Promise<Set<string>> {
  if (courseIds.length === 0) return new Set();
  const rows = await client.courseDraft.findMany({ where: { courseId: { in: [...courseIds] } }, select: { courseId: true } });
  return new Set(rows.map((row) => row.courseId));
}

function courseHasDraftError(courseId: string) {
  return new ConflictError(
    "course_has_draft",
    "This course has a draft. Publish or discard the draft first; nothing was saved.",
    { courseId },
  );
}

function draftChangedError(courseId: string, details: Record<string, unknown>) {
  return new ConflictError(
    "course_draft_changed",
    "Someone else saved, published or discarded the draft after you opened the course. Reload the page; nothing was saved.",
    { courseId, ...details },
  );
}

/**
 * LÅSEN av den publiserte utgaven: har kurset et utkast, avvises alt annet som skriver kursets felt eller liste. Kalles fra
 * `claimCourseRevision` (courseVersioning.ts), som alle slike skrivere går gjennom, etter innholdslåsen. Publiseringen av
 * utkastet er det ene unntaket, og sier fra selv (`publishingDraft`).
 *
 * Dette er det ENE stedet låsen sjekkes. Kursimporten har ingen egen sjekk før den starter: den skriver alt i én
 * transaksjon, som rulles tilbake her, og fjerner selv bildene den lastet opp (mutasjonstesten 2026-11-12 viste at en
 * ekstra sjekk i ruta ikke gjorde noen forskjell).
 *
 * Følgen: mens utkastet finnes, endres ikke kursets teller (`contentRevision`). Utkastet bygger derfor alltid på den
 * publiserte utgaven slik den er, og trenger ingen egen sjekk av det ved publisering.
 */
export async function assertNoCourseDraftBlocksWrite(client: ContentWriteTx, courseId: string): Promise<void> {
  if ((await findCourseDraft(client, courseId)) != null) throw courseHasDraftError(courseId);
}

/** Utkastet fana lastet. `id` følger med telleren: et utkast som er forkastet og laget på nytt, starter på 1 igjen. */
export type LoadedCourseDraft = { draftId: string; revision: number };

/**
 * Det skjemaet lastet: enten et utkast, eller den publiserte utgaven uten utkast (`expectedRevision`, kursets
 * `contentRevision`). To ulike verdier med vilje: «jeg så ikke noe utkast» skal aldri kunne skrive over et utkast noen andre
 * har laget, eller lage utkastet på nytt etter at det er publisert.
 */
export type LoadedCourseEdition = LoadedCourseDraft | { expectedRevision: number };

/**
 * Utkastet som ligger, må være det fana lastet. Ellers har noen andre lagret, publisert eller forkastet i mellomtiden, også
 * når utkastet er helt borte: fana viser noe som ikke finnes lenger, og må laste på nytt. Samme svar fra lagring, forkast og
 * publisering.
 */
function assertIsLoadedDraft(courseId: string, existing: CourseDraftRow | null, loaded: LoadedCourseDraft): asserts existing is CourseDraftRow {
  if (!existing || existing.id !== loaded.draftId || existing.revision !== loaded.revision) {
    throw draftChangedError(courseId, { loadedDraftId: loaded.draftId, loadedRevision: loaded.revision, currentRevision: existing?.revision ?? null });
  }
}

/**
 * Lagrer utkastet. Bare for et publisert kurs. `payload` er ferdig validert av ruta; `checkUsable` kjører rutas sjekk av at
 * elementene og temaene finnes og kan brukes, i samme transaksjon, så en feil kommer ved lagring og ikke først ved
 * publisering. Tellerne sjekkes først, som ved direkte lagring: en utdatert fane får vite at den er utdatert.
 */
export async function saveCourseDraft(input: {
  courseId: string;
  payload: unknown;
  loaded: LoadedCourseEdition;
  actorId?: string;
  checkUsable?: (tx: ContentWriteTx) => Promise<void>;
}): Promise<CourseDraftRow> {
  return runContentWrite(async (tx) => {
    const course = await tx.course.findUnique({ where: { id: input.courseId }, select: { publishedAt: true, contentRevision: true } });
    if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
    if (course.publishedAt == null) {
      throw new ConflictError(
        "course_draft_requires_published",
        "Only a published course has a draft. Save the course directly; nothing was saved.",
        { courseId: input.courseId },
      );
    }

    const existing = await findCourseDraft(tx, input.courseId);
    if ("draftId" in input.loaded) {
      assertIsLoadedDraft(input.courseId, existing, input.loaded);
    } else {
      // Skjemaet så ingen utkast. Finnes det ett nå, har noen andre laget det.
      if (existing) throw draftChangedError(input.courseId, { loadedDraftId: null, currentRevision: existing.revision });
      if (course.contentRevision !== input.loaded.expectedRevision) {
        throw new ConflictError(
          "course_changed",
          "Someone else saved this course after you opened it. Reload the page to see their changes; nothing was saved.",
          { expectedRevision: input.loaded.expectedRevision, currentRevision: course.contentRevision },
        );
      }
    }
    if (input.checkUsable) await input.checkUsable(tx);

    const payloadText = JSON.stringify(input.payload);
    const saved = existing
      ? await tx.courseDraft.update({
          where: { id: existing.id },
          data: { payloadText, revision: { increment: 1 }, updatedById: input.actorId ?? null, source: "form" },
          select: DRAFT_SELECT,
        })
      : await tx.courseDraft.create({
          data: { courseId: input.courseId, payloadText, baseRevision: course.contentRevision, updatedById: input.actorId ?? null, source: "form" },
          select: DRAFT_SELECT,
        });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: input.courseId,
        action: auditActions.course.draftSaved,
        actorId: input.actorId,
        metadata: { courseId: input.courseId, draftId: saved.id, revision: saved.revision, created: !existing },
      },
      tx,
    );
    return saved;
  });
}

/**
 * Forkaster utkastet fana lastet. Virker også når kurset er avpublisert eller arkivert, så et utkast aldri blir stående uten
 * en vei ut. Har noen andre lagret utkastet siden fana lastet det, avvises forkastingen (`409 course_draft_changed`): ellers
 * ville den slettet arbeid den som forkaster, aldri har sett.
 */
export async function discardCourseDraft(courseId: string, loaded: LoadedCourseDraft, actorId?: string): Promise<void> {
  return runContentWrite(async (tx) => {
    const existing = await findCourseDraft(tx, courseId);
    assertIsLoadedDraft(courseId, existing, loaded);
    await tx.courseDraft.delete({ where: { id: existing.id } });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: courseId,
        action: auditActions.course.draftDiscarded,
        actorId,
        metadata: { courseId, draftId: existing.id, revision: existing.revision },
      },
      tx,
    );
  });
}

/**
 * Publiserer utkastet: `apply` skriver det til kurset (ruta leser `payloadText` gjennom skjemaet og kaller `updateCourse`
 * med `publishingDraft`, det ene unntaket fra låsen), og raden slettes i SAMME transaksjon. Feiler noe, står både kurset
 * og utkastet som før. Krever et publisert kurs og utkastet fana lastet.
 */
export async function publishCourseDraft<T>(input: {
  courseId: string;
  loaded: LoadedCourseDraft;
  actorId?: string;
  apply: (tx: ContentWriteTx, draft: CourseDraftRow) => Promise<T>;
}): Promise<T> {
  return runContentWrite(async (tx) => {
    const course = await tx.course.findUnique({ where: { id: input.courseId }, select: { publishedAt: true } });
    if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
    const existing = await findCourseDraft(tx, input.courseId);
    assertIsLoadedDraft(input.courseId, existing, input.loaded);
    if (course.publishedAt == null) {
      throw new ConflictError(
        "course_draft_requires_published",
        "The course is not published. Publish the course again, or discard the draft; nothing was published.",
        { courseId: input.courseId },
      );
    }
    const result = await input.apply(tx, existing);
    await tx.courseDraft.delete({ where: { id: existing.id } });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: input.courseId,
        action: auditActions.course.draftPublished,
        actorId: input.actorId,
        metadata: { courseId: input.courseId, draftId: existing.id, revision: existing.revision },
      },
      tx,
    );
    return result;
  });
}
