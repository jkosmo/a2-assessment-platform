// #1140 etappe 2 (doc/design/PLAN_1140_E2.md): utkastet til et publisert kurs.
//
// Et publisert kurs kan ha ETT utkast: det kursskjemaet lagrer, lagt ved siden av den publiserte utgaven. Ingenting deltakerne
// ser, endres før utkastet publiseres. ALT som leser eller skriver `CourseDraft`, bor i denne fila (vakt:
// test/course-draft-guard.test.js). Kursbyggerens ruter (routes/adminCourses.ts) er de eneste som viser et utkast; låsesjekken
// under kalles fra `claimCourseRevision`.
//
// Bryteren `course_drafts` (en rad i `PlatformConfig`, som bryteren fra #934) styrer om utkast kan lages og om låsen gjelder.
// Den leses ved hvert kall. Av: alt er som før #1140, og en rad som måtte finnes, låser ingenting; den kan bare forkastes.
//
// Innholdet i utkastet (`payloadText`) er kroppen `PUT …/content` tar imot, etter validering. Denne fila tolker den ikke:
// rutene eier skjemaet, og leser teksten gjennom det både ved henting og ved publisering.
import { runContentWrite, type ContentWriteTx } from "../../db/contentLock.js";
import type { DbTransactionClient } from "../../db/transaction.js";
import { ConflictError, NotFoundError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";

export const COURSE_DRAFTS_SWITCH_KEY = "course_drafts";

type DraftReader = Pick<DbTransactionClient, "courseDraft">;
type SwitchReader = Pick<DbTransactionClient, "platformConfig">;

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

/** Er utkast for kurs slått på? Leses ved hvert kall, aldri mellomlagret. */
export async function isCourseDraftsOn(client: SwitchReader): Promise<boolean> {
  const row = await client.platformConfig.findUnique({ where: { key: COURSE_DRAFTS_SWITCH_KEY }, select: { value: true } });
  return row?.value === "on";
}

export function findCourseDraft(client: DraftReader, courseId: string): Promise<CourseDraftRow | null> {
  return client.courseDraft.findUnique({ where: { courseId }, select: DRAFT_SELECT });
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
 * LÅSEN av den publiserte utgaven: med bryteren på og et utkast liggende avvises alt annet som skriver kursets felt eller
 * liste. Kalles fra `claimCourseRevision` (courseVersioning.ts), som alle slike skrivere går gjennom, etter innholdslåsen.
 * Publiseringen av utkastet er det ene unntaket, og sier fra selv (`publishingDraft`).
 *
 * Dette er det ENE stedet låsen sjekkes. Kursimporten har ingen egen sjekk før den starter: den skriver alt i én
 * transaksjon, som rulles tilbake her, og fjerner selv bildene den lastet opp (mutasjonstesten 2026-11-12 viste at en
 * ekstra sjekk i ruta ikke gjorde noen forskjell).
 */
export async function assertNoCourseDraftBlocksWrite(client: ContentWriteTx, courseId: string): Promise<void> {
  const blocked = (await isCourseDraftsOn(client)) && (await findCourseDraft(client, courseId)) != null;
  if (blocked) throw courseHasDraftError(courseId);
}

/** Utkastet fana lastet. `id` følger med telleren: et utkast som er forkastet og laget på nytt, starter på 1 igjen. */
export type LoadedCourseDraft = { draftId: string; revision: number };

/**
 * Det skjemaet lastet: enten et utkast, eller den publiserte utgaven uten utkast (`expectedRevision`, kursets
 * `contentRevision`). To ulike verdier med vilje: «jeg så ikke noe utkast» skal aldri kunne skrive over et utkast noen andre
 * har laget, eller lage utkastet på nytt etter at det er publisert.
 */
export type LoadedCourseEdition = LoadedCourseDraft | { expectedRevision: number };

function draftsOffError(courseId: string, nothing: "saved" | "published") {
  return new ConflictError("course_drafts_off", `Course drafts are not switched on. Nothing was ${nothing}.`, { courseId });
}

/** Utkastet som ligger, må være det fana lastet. Ellers har noen andre lagret, publisert eller forkastet i mellomtiden. */
function assertIsLoadedDraft(courseId: string, existing: CourseDraftRow | null, loaded: LoadedCourseDraft): asserts existing is CourseDraftRow {
  if (!existing || existing.id !== loaded.draftId || existing.revision !== loaded.revision) {
    throw draftChangedError(courseId, { loadedDraftId: loaded.draftId, loadedRevision: loaded.revision, currentRevision: existing?.revision ?? null });
  }
}

/**
 * Utkastet bygger på den publiserte utgaven slik den var da utkastet ble laget (`baseRevision`). Er kurset lagret siden,
 * kan utkastet ikke publiseres: det ville skrevet over den lagringen. Med bryteren på stenger låsen for det; det kan bare
 * skje når bryteren har vært av mens utkastet lå. Da er veien ut å forkaste utkastet.
 */
function assertDraftNotOutdated(courseId: string, draft: CourseDraftRow, contentRevision: number) {
  if (draft.baseRevision !== contentRevision) {
    throw new ConflictError(
      "course_draft_outdated",
      "The course was saved after this draft was created, so the draft can no longer be published. Discard the draft and make the changes again.",
      { courseId, baseRevision: draft.baseRevision, currentRevision: contentRevision },
    );
  }
}

/**
 * Lagrer utkastet. Bare for et publisert kurs med bryteren på. `payload` er ferdig validert av ruta; `checkUsable` kjører
 * rutas sjekk av at elementene og temaene finnes og kan brukes, i samme transaksjon, så en feil kommer ved lagring og ikke
 * først ved publisering. Tellerne sjekkes først, som ved direkte lagring: en utdatert fane får vite at den er utdatert.
 */
export async function saveCourseDraft(input: {
  courseId: string;
  payload: unknown;
  loaded: LoadedCourseEdition;
  actorId?: string;
  checkUsable?: (tx: ContentWriteTx) => Promise<void>;
}): Promise<CourseDraftRow> {
  return runContentWrite(async (tx) => {
    if (!(await isCourseDraftsOn(tx))) throw draftsOffError(input.courseId, "saved");
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
      assertDraftNotOutdated(input.courseId, existing, course.contentRevision);
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
 * Forkaster utkastet fana lastet. Virker ALLTID: også med bryteren av, og når kurset er avpublisert eller arkivert, så et
 * utkast aldri blir stående uten en vei ut. Har noen andre lagret utkastet siden fana lastet det, avvises forkastingen
 * (`409 course_draft_changed`): ellers ville den slettet arbeid den som forkaster, aldri har sett. Svarer `false` uten utkast.
 */
export async function discardCourseDraft(courseId: string, loaded: LoadedCourseDraft, actorId?: string): Promise<boolean> {
  return runContentWrite(async (tx) => {
    const existing = await findCourseDraft(tx, courseId);
    if (!existing) return false;
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
    return true;
  });
}

/**
 * Publiserer utkastet: `apply` skriver det til kurset (ruta leser `payloadText` gjennom skjemaet og kaller `updateCourse`
 * med `publishingDraft`, det ene unntaket fra låsen), og raden slettes i SAMME transaksjon. Feiler noe, står både kurset
 * og utkastet som før. Krever bryteren på, et publisert kurs, utkastet fana lastet, og at kurset ikke er lagret siden
 * utkastet ble laget.
 */
export async function publishCourseDraft<T>(input: {
  courseId: string;
  loaded: LoadedCourseDraft;
  actorId?: string;
  apply: (tx: ContentWriteTx, draft: CourseDraftRow) => Promise<T>;
}): Promise<T> {
  return runContentWrite(async (tx) => {
    if (!(await isCourseDraftsOn(tx))) throw draftsOffError(input.courseId, "published");
    const course = await tx.course.findUnique({ where: { id: input.courseId }, select: { publishedAt: true, contentRevision: true } });
    if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
    const existing = await findCourseDraft(tx, input.courseId);
    if (!existing) throw new NotFoundError("CourseDraft", "course_draft_not_found", "This course has no draft.");
    assertIsLoadedDraft(input.courseId, existing, input.loaded);
    if (course.publishedAt == null) {
      throw new ConflictError(
        "course_draft_requires_published",
        "The course is not published. Publish the course again, or discard the draft; nothing was published.",
        { courseId: input.courseId },
      );
    }
    assertDraftNotOutdated(input.courseId, existing, course.contentRevision);
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

