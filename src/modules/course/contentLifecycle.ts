import { prisma } from "../../db/prisma.js";
import type { DbTransactionClient } from "../../db/transaction.js";
import { type AppError, ConflictError, DomainRuleError, ValidationError } from "../../errors/AppError.js";
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { AppealStatus, SubmissionStatus } from "../../db/prismaRuntime.js";
import { SETTLED_SUBMISSION_STATUSES } from "../submission/submissionOutcome.js";
import { findCourseDraftItemLists } from "./courseDraft.js";
import { createCourseRepository } from "./courseRepository.js";
import { findSectionReadCredit } from "./sectionReadCredit.js";
import { computeCourseStatus } from "./courseQueries.js";

// Enhetlig innholds-livssyklus — delte vakter for kurs/modul/seksjon.
// Se doc/design/CONTENT_LIFECYCLE.md. G2 = bruk-lås (se «Hvilke kurs bruker dette elementet» under).
// G3 = aktivitets-bekreftelse (kurs med påbegynt-ufullført deltaker arkiveres bare når forfatteren har bekreftet tallet, #1150).
// Feilmeldinger navngir kursene/teller deltakerne på norsk.

const MSG_LOCALE = "nb" as const;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// #1149: «Hvilke kurs bruker dette elementet?» har TO svar, og de har hvert sitt navn.
//
// Produkteier 13.11.2026 (doc/DECISIONS.md → «Arkiverte kurs teller ikke som bruk»):
//
//   AKTIVE kurs (archivedAt = null, publisert eller utkast)      findActiveCoursesContaining…
//     - det som vises som «Brukt i kurs», i kursfilteret og i tematallet
//     - det som stopper AVPUBLISERING og ARKIVERING                assert…NotInActiveCourse
//
//   ALLE kurs, også arkiverte                                     findAllCoursesContaining…
//     - det som stopper SLETTING                                   courseDeleteHold (og describeModuleDeleteBlock for ruta)
//     - kaskadeslettingens «delt med andre kurs»
//
// Sletting er unntatt fordi databasen ikke kan noe annet: `CourseItem` peker på modul og seksjon med
// `onDelete: Restrict`. Raden i det arkiverte kurset holder elementet til kurset selv er borte.
//
// ⚠️ Det finnes med vilje ingen funksjon som bare heter «kursene som inneholder …». Et navn uten
// «Active» eller «All» lar leseren velge feil uten å se det. `test/content-in-use-guard.test.js`
// nekter nye lesere av `courseItem`/`courseItems` som svarer på dette spørsmålet utenom denne fila.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Et kurs som teller som bruk: ikke arkivert. Publisert eller utkast er det samme her. */
export const activeCourseWhere = { archivedAt: null } as const;

/** Et kurs som inneholder elementet. `archived` følger alltid med, så svaret «alle kurs» kan skille dem. */
export type CourseUse = { id: string; title: string; archived: boolean };

type ItemRef = { moduleId: string } | { sectionId: string };

// #934 skive 4a: vaktene leser på klienten de får. En skriver kaller dem med transaksjonen som holder
// innholdslåsen, så svaret gjelder til den har skrevet — sjekket på den globale klienten før låsen, kunne et
// kurs få modulen mellom sjekken og arkiveringen. Utelatt: den globale klienten (forhåndsvisninger og lister).
export type LifecycleReader = DbTransactionClient | typeof prisma;

function courseDisplayTitle(rawTitle: string): string {
  return localizeContentText(MSG_LOCALE, rawTitle) ?? rawTitle;
}

// Det ENE stedet som svarer på «hvilke kurs». `scope` er ikke valgfritt: hver kaller må si hvilket svar den vil ha.
async function coursesContaining(itemWhere: ItemRef, scope: "active" | "all", reader: LifecycleReader): Promise<CourseUse[]> {
  const rows = await reader.course.findMany({
    where: { items: { some: itemWhere }, ...(scope === "active" ? activeCourseWhere : {}) },
    select: { id: true, title: true, archivedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => ({ id: row.id, title: courseDisplayTitle(row.title), archived: row.archivedAt !== null }));
}

/** AKTIVE kurs som inneholder modulen. Det som vises som bruk, og det som stopper avpublisering og arkivering. */
export function findActiveCoursesContainingModule(moduleId: string, reader: LifecycleReader = prisma) {
  return coursesContaining({ moduleId }, "active", reader);
}

/** AKTIVE kurs som inneholder seksjonen. Det som vises som bruk, og det som stopper avpublisering og arkivering. */
export function findActiveCoursesContainingSection(sectionId: string, reader: LifecycleReader = prisma) {
  return coursesContaining({ sectionId }, "active", reader);
}

/** ALLE kurs som inneholder modulen, også arkiverte (`archived` sier hvilke). Bare for sletting. */
export function findAllCoursesContainingModule(moduleId: string, reader: LifecycleReader = prisma) {
  return coursesContaining({ moduleId }, "all", reader);
}

/** ALLE kurs som inneholder seksjonen, også arkiverte (`archived` sier hvilke). Bare for sletting. */
export function findAllCoursesContainingSection(sectionId: string, reader: LifecycleReader = prisma) {
  return coursesContaining({ sectionId }, "all", reader);
}

/**
 * #1152 skive 4b: det samme svaret som `findAllCoursesContainingModule`/`…Section` (ALLE kurs, også arkiverte, sist endret først),
 * for mange moduler og seksjoner i én spørring. Bare for sletting: lista over arkiverte (`checkModuleDeletes`, `checkSectionDeletes`)
 * spør her i stedet for én gang per element.
 */
export async function findAllCoursesContainingItems(
  items: { moduleIds: readonly string[]; sectionIds: readonly string[] },
  reader: LifecycleReader = prisma,
): Promise<{ modules: Map<string, CourseUse[]>; sections: Map<string, CourseUse[]> }> {
  const result = { modules: new Map<string, CourseUse[]>(), sections: new Map<string, CourseUse[]>() };
  const branches = [
    ...(items.moduleIds.length > 0 ? [{ moduleId: { in: [...items.moduleIds] } }] : []),
    ...(items.sectionIds.length > 0 ? [{ sectionId: { in: [...items.sectionIds] } }] : []),
  ];
  if (branches.length === 0) return result;
  const rows = await reader.courseItem.findMany({
    where: { OR: branches },
    select: { moduleId: true, sectionId: true, course: { select: { id: true, title: true, archivedAt: true } } },
    // Samme rekkefølge som `coursesContaining`, så feilmeldingen navngir kursene likt.
    orderBy: { course: { updatedAt: "desc" } },
  });
  const add = (map: Map<string, CourseUse[]>, id: string, course: { id: string; title: string; archivedAt: Date | null }) => {
    const list = map.get(id) ?? [];
    if (!list.some((c) => c.id === course.id)) list.push({ id: course.id, title: courseDisplayTitle(course.title), archived: course.archivedAt !== null });
    map.set(id, list);
  };
  const wantedModules = new Set(items.moduleIds);
  const wantedSections = new Set(items.sectionIds);
  for (const row of rows) {
    if (row.moduleId && wantedModules.has(row.moduleId)) add(result.modules, row.moduleId, row.course);
    if (row.sectionId && wantedSections.has(row.sectionId)) add(result.sections, row.sectionId, row.course);
  }
  return result;
}

// #705-UX(G), #1149: batch — hvilke AKTIVE kurs bruker hvert av disse elementene. For «Brukt i kurs»-kolonnen,
// kursfilteret og popoveren i seksjonslista og modulbiblioteket. Ett spørsmål for alle elementene.
// Et arkivert kurs er ikke med: det er ikke bruk (se toppen av fila).
// #1150: `excludeCourseId` og `reader` for regelen «brukes andre steder» under (et kurs spør om de ANDRE kursene, og
// arkiveringen spør på transaksjonen sin). Listene sender ingen av delene, og svarer som før.
async function activeCoursesByItem(
  key: "moduleId" | "sectionId",
  ids: readonly string[],
  locale: SupportedLocale,
  options: { excludeCourseId?: string; reader?: LifecycleReader } = {},
): Promise<Map<string, Array<{ id: string; title: string }>>> {
  const result = new Map<string, Array<{ id: string; title: string }>>();
  if (ids.length === 0) return result;
  const course = { ...activeCourseWhere, ...(options.excludeCourseId ? { id: { not: options.excludeCourseId } } : {}) };
  const items = await (options.reader ?? prisma).courseItem.findMany({
    where:
      key === "moduleId"
        ? { moduleId: { in: [...ids] }, course }
        : { sectionId: { in: [...ids] }, itemType: "SECTION", course },
    select: { moduleId: true, sectionId: true, course: { select: { id: true, title: true } } },
    // Samme rekkefølge som `coursesContaining` (sist endret først), så feilmeldingen ved arkivering navngir kursene som før.
    orderBy: { course: { updatedAt: "desc" } },
  });
  for (const item of items) {
    const itemId = item[key];
    if (!itemId || !item.course) continue;
    const list = result.get(itemId) ?? [];
    // Unngå duplikater hvis et element skulle forekomme flere ganger i samme kurs.
    if (!list.some((c) => c.id === item.course.id)) {
      list.push({ id: item.course.id, title: localizeContentText(locale, item.course.title) ?? item.course.title });
    }
    result.set(itemId, list);
  }
  return result;
}

/** Seksjonslista (`GET /api/admin/content/sections`). Kurstitlene på bokmål, som før. */
export function findActiveCoursesForSections(sectionIds: string[]) {
  return activeCoursesByItem("sectionId", sectionIds, MSG_LOCALE);
}

/** Modulbiblioteket (`GET /api/admin/content/modules/library`). Kurstitlene på språket lista vises på. */
export function findActiveCoursesForModules(moduleIds: string[], locale: SupportedLocale) {
  return activeCoursesByItem("moduleId", moduleIds, locale);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// #1150 (plan: doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Ett svar på «brukes andre steder»»):
// «Brukes dette elementet andre steder?» — for ARKIVERING.
//
// Et element brukes et annet sted når det står i
//   - et kurs som ikke er arkivert (som `findActiveCoursesContaining…`), eller
//   - et lagret utkast (#1140) til et kurs som ikke er arkivert, når utkastet har en elementliste som tar det med.
//     Et utkast som ikke kan leses, betyr «som publisert» og legger ikke til noe (courseDraft.ts). Skjemaet krever `items`.
//
// Hvorfor utkastene teller: et element som bare står i et utkast, ses ikke av kursets liste. Arkiveres det, feiler utkastet
// først når det skal publiseres (`course_draft_item_unusable`). Her stoppes det før.
//
// Brukes av: arkivering for hånd av en modul og en seksjon (`assert…NotInActiveCourse` med «arkiveres»), importens
// `updateExisting` (arkiverer det den byttet ut), og forhåndsvisningen av kursarkiveringen (courseArchivePreview.ts).
// Avpublisering bruker den IKKE: et utkast som får et avpublisert element, stoppes ved publisering
// (`course_draft_item_unusable`), og avpublisering er reversibel. Sletting teller alle kurs (`findAll…`), og fra #1152 også
// utkastene, gjennom denne regelen (`findCourseDraftUsesForDelete` under).
// Vakt: test/content-in-use-guard.test.js.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Hvor et element brukes: kurset, og om det er kursets egen liste (`course`) eller bare et lagret utkast (`draft`). */
export type ItemUse = { courseId: string; title: string; via: "course" | "draft" };

export type ItemUses = { modules: Map<string, ItemUse[]>; sections: Map<string, ItemUse[]> };

/**
 * DEN ENE regelen for «brukes andre steder» ved arkivering. Svarer for hver modul og seksjon hvilke kurs som bruker den,
 * utenom `excludeCourseId`. Et element som ikke brukes noe sted, står ikke i svaret. Står elementet både i kursets liste og i
 * utkastet, er det `course`. Kurstitlene på `locale` (bokmål når det er utelatt, som feilmeldingene).
 */
export async function findActiveUsesOfItems(
  items: { moduleIds: readonly string[]; sectionIds: readonly string[] },
  options: { excludeCourseId?: string; locale?: SupportedLocale } = {},
  reader: LifecycleReader = prisma,
): Promise<ItemUses> {
  const locale = options.locale ?? MSG_LOCALE;
  const moduleIds = [...new Set(items.moduleIds)];
  const sectionIds = [...new Set(items.sectionIds)];
  const result: ItemUses = { modules: new Map(), sections: new Map() };
  if (moduleIds.length === 0 && sectionIds.length === 0) return result;

  const [inModules, inSections, drafts] = await Promise.all([
    activeCoursesByItem("moduleId", moduleIds, locale, { excludeCourseId: options.excludeCourseId, reader }),
    activeCoursesByItem("sectionId", sectionIds, locale, { excludeCourseId: options.excludeCourseId, reader }),
    findCourseDraftItemLists(reader, { course: activeCourseWhere, excludeCourseId: options.excludeCourseId }),
  ]);

  const add = (map: Map<string, ItemUse[]>, id: string, use: ItemUse) => {
    const list = map.get(id) ?? [];
    if (list.some((existing) => existing.courseId === use.courseId)) return;
    list.push(use);
    map.set(id, list);
  };
  for (const [id, courses] of inModules) for (const c of courses) add(result.modules, id, { courseId: c.id, title: c.title, via: "course" });
  for (const [id, courses] of inSections) for (const c of courses) add(result.sections, id, { courseId: c.id, title: c.title, via: "course" });

  const wantedModules = new Set(moduleIds);
  const wantedSections = new Set(sectionIds);
  for (const draft of drafts) {
    if (!draft.items) continue;
    const use: ItemUse = { courseId: draft.courseId, title: localizeContentText(locale, draft.courseTitle) ?? draft.courseTitle, via: "draft" };
    for (const item of draft.items) {
      if (item.type === "MODULE" && wantedModules.has(item.moduleId)) add(result.modules, item.moduleId, use);
      if (item.type === "SECTION" && wantedSections.has(item.sectionId)) add(result.sections, item.sectionId, use);
    }
  }
  return result;
}

function quoteCourseTitles(courses: Array<{ title: string }>): string {
  return courses.map((c) => `«${c.title}»`).join(", ");
}

// #705: én setning for «i bruk», så avpubliser, arkiver og slett leses likt.
function inUseMessage(
  subject: "Modulen" | "Seksjonen",
  verb: string,
  courses: Array<{ title: string }>,
): string {
  return (
    `${subject} kan ikke ${verb} fordi den er i bruk i ${courses.length} kurs: ${quoteCourseTitles(courses)}. ` +
    `Fjern den fra kursene først (eller avpubliser kursene).`
  );
}

function inActiveCourseError(subject: "Modulen" | "Seksjonen", verb: string, courses: Array<{ title: string }>) {
  // #999: koden er kontrakten. `courseTitles` følger med så klienten kan navngi kursene uten
  // å lese dem ut av setningen.
  return new DomainRuleError("content_in_use", inUseMessage(subject, verb, courses), {
    count: courses.length,
    courseTitles: courses.map((c) => c.title),
  });
}

// #1150: arkivering for hånd stoppes også av et lagret utkast til et annet aktivt kurs. Står minst ett av kursene der bare
// gjennom utkastet, får svaret en egen kode, `content_in_course_draft`: teksten til `content_in_use` ber forfatteren fjerne
// elementet fra kursene eller avpublisere dem, og ingen av delene hjelper mot et utkast (det må tas ut av utkastet, eller
// utkastet forkastes). `content_in_use` kunne heller ikke fått en plassholder til for utkastene: klientens tekst blir
// ugyldig når en plassholder står igjen (api-error.js), og de andre avsenderne av koden sender den ikke.
// Uten utkast er svaret det samme som før: `content_in_use`, `{ count, courseTitles }`.
function usedElsewhereError(subject: "Modulen" | "Seksjonen", uses: ItemUse[]): AppError {
  const drafts = uses.filter((use) => use.via === "draft");
  if (drafts.length === 0) return inActiveCourseError(subject, "arkiveres", uses);
  return new DomainRuleError(
    "content_in_course_draft",
    `${subject} kan ikke arkiveres fordi den er i bruk i ${uses.length} kurs: ${quoteCourseTitles(uses)}. ` +
      `I ${drafts.length} av dem står den bare i et lagret utkast: ${quoteCourseTitles(drafts)}. ` +
      `Ta den ut av utkastet (eller forkast utkastet) og av kursene først.`,
    {
      count: uses.length,
      courseTitles: uses.map((use) => use.title),
      draftCount: drafts.length,
      draftCourseTitles: drafts.map((use) => use.title),
      uses: uses.map((use) => ({ courseId: use.courseId, title: use.title, via: use.via })),
    },
  );
}

// G2, avpublisering og arkivering: en modul som ligger i et AKTIVT kurs (publisert eller utkast) kan ikke trekkes
// vekk under det. Et arkivert kurs stopper ikke (#1149): blir det gjenopprettet, lander det som utkast, og
// publiseringen stoppes av `item_archived` til elementet er gjenopprettet eller tatt ut.
// #1150: «arkiveres» spør regelen «brukes andre steder» (også lagrede utkast); «avpubliseres» spør bare kursene, som før.
// `verb` brukes i feilmeldingen. Sletting har sin egen vakt under, og kan ikke bruke denne.
export async function assertModuleNotInActiveCourse(
  moduleId: string,
  verb: "avpubliseres" | "arkiveres",
  reader: LifecycleReader = prisma,
): Promise<void> {
  if (verb === "arkiveres") {
    const uses = (await findActiveUsesOfItems({ moduleIds: [moduleId], sectionIds: [] }, {}, reader)).modules.get(moduleId) ?? [];
    if (uses.length > 0) throw usedElsewhereError("Modulen", uses);
    return;
  }
  const courses = await findActiveCoursesContainingModule(moduleId, reader);
  if (courses.length > 0) throw inActiveCourseError("Modulen", verb, courses);
}

// G2 for seksjoner — samme regel.
export async function assertSectionNotInActiveCourse(
  sectionId: string,
  verb: "avpubliseres" | "arkiveres",
  reader: LifecycleReader = prisma,
): Promise<void> {
  if (verb === "arkiveres") {
    const uses = (await findActiveUsesOfItems({ moduleIds: [], sectionIds: [sectionId] }, {}, reader)).sections.get(sectionId) ?? [];
    if (uses.length > 0) throw usedElsewhereError("Seksjonen", uses);
    return;
  }
  const courses = await findActiveCoursesContainingSection(sectionId, reader);
  if (courses.length > 0) throw inActiveCourseError("Seksjonen", verb, courses);
}

// G2, SLETTING: alle kurs teller, også arkiverte (FK `Restrict`, se toppen av fila).
//
// Er minst ett av kursene arkivert, får svaret en egen kode, `content_in_archived_course`, og `details` sier
// hvilke: forfatteren kan ikke «fjerne elementet fra kurset» slik `content_in_use` ber om, uten først å
// gjenopprette kurset. Etter #1149 er dette den vanlige veien hit: «Slett» vises bare på arkiverte elementer,
// og et element kan nå arkiveres mens det ligger i et arkivert kurs.
//
// Uten arkiverte kurs er svaret som før: seksjoner `content_in_use` (400), moduler `module_in_use` (409, #705).
function deleteBlockedError(subject: "Modulen" | "Seksjonen", courses: CourseUse[]): AppError {
  const archived = courses.filter((c) => c.archived);
  if (archived.length > 0) {
    return new DomainRuleError(
      "content_in_archived_course",
      `${subject} kan ikke slettes fordi den ligger i ${courses.length} kurs: ${quoteCourseTitles(courses)}. ` +
        `Arkiverte kurs (${archived.length}): ${quoteCourseTitles(archived)}. ` +
        // Ingen anvisning om å gjenopprette kurset og ta elementet ut (QA-porten 2.158.0): rådet kostet et endret arkivert
        // kurs. Veien som virker, er å slette kurset først (#1152); da er elementet fritt.
        `Et arkivert kurs beholder innholdet sitt.`,
      {
        count: courses.length,
        courseTitles: courses.map((c) => c.title),
        archivedCount: archived.length,
        archivedCourseTitles: archived.map((c) => c.title),
      },
    );
  }
  if (subject === "Modulen") {
    return new ConflictError("module_in_use", inUseMessage(subject, "slettes", courses), {
      courseCount: courses.length,
      count: courses.length,
      courseTitles: courses.map((c) => c.title),
    });
  }
  return inActiveCourseError(subject, "slettes", courses);
}

/** Et element som ligger i kurs: feilen «Slett» gir, og kursene (lista over arkiverte, #1152 4b, ser om de selv slettes først). */
export type CourseDeleteHold = { error: AppError; courseCount: number; courses: CourseUse[] };

/**
 * DEN ENE regelen for «ligger i et kurs» ved SLETTING av en modul eller seksjon: kursene som inneholder elementet (ALLE, også
 * arkiverte, fra `findAllCoursesContaining…` eller `findAllCoursesContainingItems`) gir `null` (ingen) eller feilen. «Slett» og lista
 * over arkiverte (#1152 4b) kommer hit med kursene de har lest; `describeModuleDeleteBlock` er ruta sin forhåndssjekk.
 * `coursesDeletedFirst`: se `withoutCoursesDeletedFirst` under.
 */
export function courseDeleteHold(
  subject: "Modulen" | "Seksjonen",
  containing: CourseUse[],
  coursesDeletedFirst?: ReadonlySet<string>,
): CourseDeleteHold | null {
  const courses = withoutCoursesDeletedFirst(containing, coursesDeletedFirst);
  return courses.length > 0 ? { error: deleteBlockedError(subject, courses), courseCount: courses.length, courses } : null;
}

/**
 * Sletting av en modul: `null` når den ikke ligger i noe kurs, ellers feilen som skal kastes. Returnerer i stedet
 * for å kaste fordi sletteruta (`DELETE /api/admin/content/modules/:id`) svarer med sin egen form (#705:
 * `courseCount` øverst i kroppen) før den kaller `deleteModule`, som sjekker på nytt etter innholdslåsen.
 */
export async function describeModuleDeleteBlock(moduleId: string, reader: LifecycleReader = prisma): Promise<CourseDeleteHold | null> {
  return courseDeleteHold("Modulen", await findAllCoursesContainingModule(moduleId, reader));
}

/**
 * #1152 skive 4b (planen, «Etter gjennomlesingen» punkt 7): lista over arkiverte spør «kan dette slettes NÅR kursene det ligger i
 * er slettet?». Jobben (4c) sletter kursene først; da er koblingen borte, og elementets egne vakter avgjør. `coursesDeletedFirst`
 * er kursene lista har regnet ut at kan slettes. Bare ARKIVERTE kurs kan tas ut: et aktivt kurs slettes aldri av fristen.
 * «Slett» sender aldri settet; der teller alle kursene, som før.
 */
function withoutCoursesDeletedFirst(courses: CourseUse[], coursesDeletedFirst: ReadonlySet<string> | undefined): CourseUse[] {
  if (!coursesDeletedFirst || coursesDeletedFirst.size === 0) return courses;
  return courses.filter((course) => !(course.archived && coursesDeletedFirst.has(course.id)));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// #1152 (doc/DECISIONS.md, «Hva som holder et arkivert kurs igjen fra sletting»): et lagret UTKAST teller som bruk også ved
// SLETTING, som ved arkivering. Ellers kunne et arkivert element som står i utkastet til et annet kurs slettes, og utkastet kunne
// da ikke publiseres (`course_draft_item_unusable`).
//
// Samme regel som arkiveringen (`findActiveUsesOfItems`: utkastene til kurs som ikke er arkivert), men bare utkastene. Kursenes
// egne lister har slettingen sin egen vakt over (ALLE kurs, også arkiverte). Står elementet både i et kurs og i et utkast, stopper
// kurset først.
// Brukes av: «Slett» for modul og seksjon, og masseryddingen av upubliserte moduler (forhåndsvisningen og slettingen).
// ─────────────────────────────────────────────────────────────────────────────────────────────

function onlyDrafts(map: Map<string, ItemUse[]>): Map<string, ItemUse[]> {
  const out = new Map<string, ItemUse[]>();
  for (const [id, uses] of map) {
    const drafts = uses.filter((use) => use.via === "draft");
    if (drafts.length > 0) out.set(id, drafts);
  }
  return out;
}

/** For SLETTING: utkastene (til kurs som ikke er arkivert) som nevner elementene. Et element uten utkast står ikke i svaret. */
export async function findCourseDraftUsesForDelete(
  items: { moduleIds: readonly string[]; sectionIds: readonly string[] },
  reader: LifecycleReader = prisma,
): Promise<ItemUses> {
  const uses = await findActiveUsesOfItems(items, {}, reader);
  return { modules: onlyDrafts(uses.modules), sections: onlyDrafts(uses.sections) };
}

function inCourseDraftDeleteError(subject: "Modulen" | "Seksjonen", drafts: ItemUse[]): AppError {
  // Egen kode: teksten til `content_in_course_draft` handler om arkivering.
  return new DomainRuleError(
    "delete_blocked_by_course_draft",
    `${subject} kan ikke slettes fordi den står i et lagret utkast til ${drafts.length} kurs: ${quoteCourseTitles(drafts)}. ` +
      `Ta den ut av utkastet, eller forkast utkastet, først.`,
    { count: drafts.length, draftCourseTitles: drafts.map((use) => use.title) },
  );
}

/**
 * Sletting av en modul eller seksjon stoppes av et lagret utkast som nevner den (#1152): feilen per element, for mange elementer i
 * én omgang. Et element uten utkast står ikke i svaret. «Slett» spør for ett element; lista over arkiverte (#1152 4b) for alle.
 */
export async function findCourseDraftDeleteBlocks(
  items: { moduleIds: readonly string[]; sectionIds: readonly string[] },
  reader: LifecycleReader = prisma,
): Promise<{ modules: Map<string, AppError>; sections: Map<string, AppError> }> {
  const uses = await findCourseDraftUsesForDelete(items, reader);
  const errors = (subject: "Modulen" | "Seksjonen", map: Map<string, ItemUse[]>) =>
    new Map([...map].map(([id, drafts]) => [id, inCourseDraftDeleteError(subject, drafts)] as const));
  return { modules: errors("Modulen", uses.modules), sections: errors("Seksjonen", uses.sections) };
}

// #938: innhold som står i et UTSTEDT kursbevis kan aldri slettes.
//
// Produkteier 2026-08-21: «Arkivert materiale var naturligvis del av pensum når diplom ble utdelt
// og må bevares som grunnlag for diplom, men ellers ikke.»
//
// G2 over nekter sletting mens innholdet ligger i et kurs — men når det er FJERNET derfra, var
// sletting tillatt, og ingenting sjekket om et kursbevis pekte på det. Snapshotet ville da bære en
// død id, og et utstedt diplom kunne ikke lenger begrunnes.
//
// ⚠️ Arkivering er fortsatt tillatt. Skillet er med vilje:
//   arkivere = ut av sirkulasjon, raden består, diplomet tåler det
//   slette    = borte, og da mister diplomet grunnlaget sitt
//
// ⚠️ Bevisst bivirkning: innhold noen har fått diplom på blir permanent uslettbart. Det er prisen
// for at et kursbevis skal kunne etterprøves, og den er godtatt.
//
// Implementasjonsnote: snapshotene er JSON-arrayer av id-er lagret som TEXT, så vi kan ikke joine.
// `contains` på id-en er derfor riktig verktøy — id-ene er cuid-er, så en delstreng-kollisjon med
// en ANNEN id er praktisk talt umulig. Skulle snapshot-formatet en dag bli en relasjon, bør denne
// sjekken bli en join.
async function assertNotInIssuedCertificate(
  id: string,
  column: "moduleSnapshotJson" | "sectionSnapshotJson",
  noun: string,
  verb: string,
  reader: LifecycleReader = prisma,
): Promise<void> {
  const count = await reader.courseCompletion.count({ where: { [column]: { contains: id } } });
  if (count > 0) {
    throw new DomainRuleError(
      "content_in_issued_certificate",
      `${noun} kan ikke ${verb} fordi den inngår i ${count} utstedt${count === 1 ? "" : "e"} kursbevis. `
      + "Den blir stående arkivert — et kursbevis må kunne vise hva det dekket.",
      { count },
    );
  }
}

export function assertModuleNotInIssuedCertificate(moduleId: string, verb: string, reader: LifecycleReader = prisma): Promise<void> {
  return assertNotInIssuedCertificate(moduleId, "moduleSnapshotJson", "Modulen", verb, reader);
}

/**
 * Samme regel som `assertSectionNotInIssuedCertificate`, men RETURNERER grunnen i stedet for å
 * kaste — for kaskadeanalysen, som samler blokkeringer og viser dem i en forhåndsvisning.
 *
 * ⚠️ Regelen bor ett sted. To kopier — én som kaster og én som rapporterer — ville drevet fra
 * hverandre, og det er nettopp det #938 handlet om.
 */
export async function describeIssuedCertificateBlock(sectionId: string, reader: LifecycleReader = prisma): Promise<string | null> {
  try {
    await assertSectionNotInIssuedCertificate(sectionId, "slettes", reader);
    return null;
  } catch (error) {
    // ⚠️ #999: vakta kaster nå DomainRuleError, ikke ValidationError. Sto denne igjen på den gamle
    // klassen, ville den sluttet å rapportere og kastet videre i stedet — og forhåndsvisningen for
    // kaskadesletting ville mistet blokkeringen den finnes for å vise.
    //
    // Merk at `reason` fortsatt er norsk prosa i en nyttelast. Det er samme klasse som #999 retter
    // for feilsvar, men en annen kanal, og hører i #995.
    if (error instanceof DomainRuleError || error instanceof ValidationError) return error.message;
    throw error;
  }
}

export async function assertSectionNotInIssuedCertificate(sectionId: string, verb: string, reader: LifecycleReader = prisma): Promise<void> {
  await assertNotInIssuedCertificate(sectionId, "sectionSnapshotJson", "Seksjonen", verb, reader);

  // ⚠️ Kursbevis utstedt FØR v2.23.0 har `sectionSnapshotJson = NULL` — kolonnen er nullbar og med
  // vilje ikke bakfylt (`doc/DECISIONS.md`: NULL betyr ærlig «utstedt før vi registrerte dette»).
  // Et `contains`-oppslag treffer aldri NULL, så sjekken over beskyttet ingen av dem.
  //
  // Vi kan ikke vite hvilke seksjoner et slikt bevis dekket — dataene finnes ikke. Men vi har en
  // ærlig stedfortreder: leste deltakeren seksjonen i det kurset hen fikk beviset for, var den en
  // del av grunnlaget. Det er konservativt i riktig retning, og det er alt dataene tillater.
  // ⚠️ #996: spørringen går fra LESNINGENE, ikke fra bevisene. Første utkast lastet ALLE bevis med
  // NULL-snapshot og bygde én `OR`-gren per bevis — to bindeparametre hver. Med nok historikk
  // sprenger det Prismas parametergrense, og kaskade-forhåndsvisningen ble seksjoner × alle gamle
  // bevis. En vakt som slutter å virke når installasjonen blir stor, er en vakt som svikter presis
  // når den trengs mest.
  //
  // Snudd er mengden naturlig avgrenset: hvor mange har lest DENNE ene seksjonen. To `IN`-lister
  // i stedet for N `OR`-grener, og det eksakte par-treffet gjøres i minnet på et lite resultat.
  const reads = await reader.courseSectionRead.findMany({
    where: { sectionId },
    select: { userId: true, courseId: true, readAt: true },
  });
  if (reads.length === 0) return;

  // #1156: en lesing uten kurs (kurset er slettet) kan ikke ha vært grunnlaget for et bevis i et kurs som finnes. Det gamle
  // beviset gjelder kurset lesingen ble gjort i, så lesingen matches fortsatt mot det kurset, ikke på tvers.
  const readCourseIds = [...new Set(reads.flatMap((r) => (r.courseId ? [r.courseId] : [])))];
  if (readCourseIds.length === 0) return;
  const legacy = await reader.courseCompletion.findMany({
    where: {
      sectionSnapshotJson: null,
      userId: { in: [...new Set(reads.map((r) => r.userId))] },
      courseId: { in: readCourseIds },
    },
    select: { userId: true, courseId: true, completedAt: true },
  });
  if (legacy.length === 0) return;

  // `IN × IN` er et kryssprodukt-supersett: den treffer også par som ikke finnes sammen. Derfor
  // avgjøres det EKSAKTE paret her, på et resultat som allerede er lite.
  //
  // ⚠️ #1003: OG tidspunktet. En lesning ETTER at beviset ble utstedt kan ikke ha vært grunnlag for
  // det. Uten sammenligningen ble en seksjon lagt til i august permanent uslettbar fordi en deltaker
  // med mai-bevis leste den — «den står i et bevis den ikke sto i». Feilen gikk i trygg retning
  // (bevarte for mye), men den var feil. Bare lesninger ved eller før fullføringen teller.
  const earliestReadByPair = new Map<string, Date>();
  for (const r of reads) {
    if (!r.courseId) continue;
    const key = `${r.userId}|${r.courseId}`;
    const prev = earliestReadByPair.get(key);
    if (!prev || r.readAt < prev) earliestReadByPair.set(key, r.readAt);
  }
  const covered = legacy.filter((c) => {
    const firstRead = earliestReadByPair.get(`${c.userId}|${c.courseId}`);
    return firstRead !== undefined && firstRead <= c.completedAt;
  }).length;
  if (covered > 0) {
    throw new DomainRuleError(
      "content_in_legacy_certificate",
      `Seksjonen kan ikke ${verb} fordi den inngår i ${covered} kursbevis utstedt før `
      + "øyeblikksbildet ble innført. Den blir stående arkivert — et kursbevis må kunne vise hva det dekket.",
      { count: covered },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// «Deltakere midt i kurset» (G3, kurslista og forhåndsvisningen av arkiveringen). #1150 skive 2a-1.
//
// Deltakeren er midt i kurset når «Mine kurs» ville vist kurset som «I gang» for hen:
//   - IKKE fullført: hen har ikke kursbevis for kursets NÅVÆRENDE hovedversjon (klienten: `isCourseCompleted`, som leser
//     bare bevis med `current`), og har ikke gjort alle stegene (`computeCourseStatus` ≠ COMPLETED);
//   - og PÅBEGYNT: en innlevering på en modul i kurset som ikke er arkivert, eller en lesing som teller for kursets
//     nåværende hovedversjon (`myCoursesProgress.ts`, `hasStarted`).
// Stegene er de samme som i «Mine kurs»: modulene som ikke er arkivert, og seksjonene deltakeren kan lese (deltakerdøra,
// `findCourseItemsForParticipant`); beståtte fra `findModuleProgress` (#934), lesinger etter regelen for nåværende
// hovedversjon. Ett unntak, med vilje: om kurset er publisert, og om deltakeren ser det (OPEN/tildelt), spørres ikke om.
// Et avpublisert kurs ville ellers alltid vært «uten deltakere midt i», og G3 kunne vært omgått med «Avpubliser» først.
//
// #1156: en lesing gjort i et annet kurs teller her, som i «Mine kurs» (`findSectionReadCredit`): bare i kurs deltakeren ser, og
// bare fram til arkiveringen for et arkivert kurs.
//
// Før #1150 telte den alle med et kursbevis som ferdige (også for en eldre hovedversjon), og alle med en lesing eller
// innlevering i kurset som påbegynt (også lesinger i seksjoner som er tatt ut, og innleveringer på arkiverte moduler).
//
// ⚠️ Kjent og uendret: en innlevering har ikke noe kurs. En innlevering på en modul som ligger i flere kurs, gjør deltakeren
// påbegynt i alle, akkurat som i «Mine kurs» (`queryLatestSubmissionsForModules` spør per modul). Telles i den trygge
// retningen: forfatteren får heller vite om én for mye enn én for lite.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Deltakerne som er midt i kurset, og modulene som er steg i det (for `countCoursePendingReviews`).
 * #1150 skive 2a-2: `completedWithoutCertificateUserIds` er dem som har gjort alle stegene uten å ha kursbevis for kursets
 * nåværende hovedversjon («Mine kurs» viser Fullført, men beviset mangler). De er ikke midt i. Arkiveringen utsteder bevisene
 * (`issueMissingCompletionsBeforeArchive`), og forhåndsvisningen viser tallet. Lista er et forslag: utstedelsen måler på nytt.
 */
export type CourseInProgress = { courseId: string; userIds: string[]; moduleIds: string[]; completedWithoutCertificateUserIds: string[] };

/** DEN ENE tellingen av deltakere midt i kurset. G3 (`archiveCourse`), kurslista og forhåndsvisningen spør her. */
export async function findCourseInProgressParticipants(courseId: string, reader: LifecycleReader = prisma): Promise<CourseInProgress> {
  const none: CourseInProgress = { courseId, userIds: [], moduleIds: [], completedWithoutCertificateUserIds: [] };
  const course = await reader.course.findUnique({ where: { id: courseId }, select: { versionMajor: true } });
  if (!course) return none;
  const repo = createCourseRepository(reader);
  const items = await repo.findCourseItemsForParticipant(courseId);
  // Stegene, som «Mine kurs»: moduler som ikke er arkivert (`required`), og seksjonene deltakerdøra slipper gjennom.
  const moduleIds = [...new Set(items.flatMap((item) => (item.itemType === "MODULE" && item.required && item.moduleId ? [item.moduleId] : [])))];
  const sectionIds = new Set(items.flatMap((item) => (item.itemType === "SECTION" && item.sectionId ? [item.sectionId] : [])));
  const total = moduleIds.length + sectionIds.size;
  // `computeCourseStatus` sier NOT_STARTED om et kurs uten steg. Da er ingen midt i.
  if (total === 0) return { ...none, moduleIds };

  const [submitters, readCredit, currentCertificates] = await Promise.all([
    moduleIds.length > 0
      ? reader.submission.findMany({ where: { moduleId: { in: moduleIds } }, select: { userId: true }, distinct: ["userId"] })
      : Promise.resolve([] as Array<{ userId: string }>),
    // #1156: lesinger fra alle kurs med kursets seksjoner, etter regelen i «Mine kurs» (bare i kurs deltakeren ser).
    findSectionReadCredit(reader, { courseIds: [courseId], items: "participant" }),
    // Bevis for den NÅVÆRENDE hovedversjonen, også et registrert (`external`): klienten regner kurset som fullført da.
    reader.courseCompletion.findMany({ where: { courseId, versionMajor: course.versionMajor }, select: { userId: true } }),
  ]);
  const submitted = new Set(submitters.map((row) => row.userId));
  const certified = new Set(currentCertificates.map((row) => row.userId));
  const readsByUser = new Map<string, Set<string>>();
  for (const row of readCredit.rows) {
    if (!row.counts || !sectionIds.has(row.sectionId)) continue;
    readsByUser.set(row.userId, (readsByUser.get(row.userId) ?? new Set()).add(row.sectionId));
  }
  // Bare den som har gjort noe i kurset, kan være påbegynt. Den med bevis for nåværende versjon er ferdig uansett. #1156: «lest»
  // er en lesing som teller her; den som bare har lest en eldre versjon, var heller ikke påbegynt før.
  const candidates = [...new Set([...submitted, ...readsByUser.keys()])].filter((userId) => !certified.has(userId));
  if (candidates.length === 0) return { ...none, moduleIds };

  const progress = await repo.findModuleProgress({ userIds: candidates, courses: [{ courseId, moduleIds }] });

  const userIds: string[] = [];
  const completedWithoutCertificateUserIds: string[] = [];
  for (const userId of candidates) {
    const readCount = readsByUser.get(userId)?.size ?? 0;
    const passed = moduleIds.filter((moduleId) => progress.passedModuleIds(userId, courseId).has(moduleId)).length;
    const hasStarted = submitted.has(userId) || readCount > 0;
    const status = computeCourseStatus(passed + readCount, total, hasStarted);
    if (status === "IN_PROGRESS") userIds.push(userId);
    // Alle steg gjort, og (fra `candidates`) uten kursbevis for nåværende hovedversjon.
    else if (status === "COMPLETED") completedWithoutCertificateUserIds.push(userId);
  }
  return { courseId, userIds, moduleIds, completedWithoutCertificateUserIds };
}

/** Antallet deltakere midt i kurset. Kurslista og G3. */
export async function countCourseInProgressParticipants(courseId: string, reader: LifecycleReader = prisma): Promise<number> {
  return (await findCourseInProgressParticipants(courseId, reader)).userIds.length;
}

// Innleveringer som FORTSATT kan få et utfall: ikke ferdig vurdert, eller med en åpen anke. HVITELISTER over det som er ferdig
// (CLAUDE.md, Pre-flight 3): en ny status regnes som «venter» til noen har tatt stilling, og forfatteren får heller vite om én
// for mye. Ferdig er det som er avgjort (`SETTLED_SUBMISSION_STATUSES`: COMPLETED, REJECTED) og det som er forlatt (SUPERSEDED,
// #951: deltakeren leverte på nytt, og forsøket vurderes aldri). I kø (SUBMITTED), under vurdering (PROCESSING, SCORED) og til
// manuell behandling (UNDER_REVIEW) venter.
const ASSESSMENT_FINISHED_STATUSES = [...SETTLED_SUBMISSION_STATUSES, SubmissionStatus.SUPERSEDED];
const APPEAL_FINISHED_STATUSES = [AppealStatus.RESOLVED, AppealStatus.REJECTED, AppealStatus.SUPERSEDED];

/**
 * Hvor mange besvarelser på modulene i kurset som ikke er ferdig vurdert, eller har en åpen anke, fra deltakerne som er midt i
 * kurset (`findCourseInProgressParticipants`). Forhåndsvisningen av arkiveringen viser tallet: blir en av dem bestått etter
 * arkiveringen, kan deltakeren ha fullført kurset uten å få kursbevis (#1152 holder da kurset igjen fra sletting).
 */
export async function countCoursePendingReviews(inProgress: CourseInProgress, reader: LifecycleReader = prisma): Promise<number> {
  if (inProgress.userIds.length === 0) return 0;
  return countPendingReviewsOnModules(inProgress.moduleIds, inProgress.userIds, reader);
}

/**
 * Besvarelsene på modulene som venter på vurdering, manuell behandling eller anke, med regelen over. `userIds` utelatt: alle
 * deltakere. Arkiveringen spør for deltakerne midt i kurset (`countCoursePendingReviews`); slettingen av et kurs (#1152,
 * courseDeleteGuard.ts) for alle, fordi hvem som helst av dem kan fullføre kravet når saken er avgjort.
 * Manuell behandling er `UNDER_REVIEW`: vedtaket som sender saken til sensor, setter statusen i samme transaksjon som saken
 * lages, og avgjørelsen setter den til `COMPLETED`. En anke setter den samme innleveringen tilbake til `UNDER_REVIEW`.
 */
export async function countPendingReviewsOnModules(
  moduleIds: readonly string[],
  userIds: readonly string[] | undefined,
  reader: LifecycleReader = prisma,
): Promise<number> {
  if (moduleIds.length === 0 || userIds?.length === 0) return 0;
  return reader.submission.count({
    where: {
      ...(userIds ? { userId: { in: [...userIds] } } : {}),
      moduleId: { in: [...moduleIds] },
      OR: [
        { submissionStatus: { notIn: ASSESSMENT_FINISHED_STATUSES } },
        { appeals: { some: { appealStatus: { notIn: APPEAL_FINISHED_STATUSES } } } },
      ],
    },
  });
}

// G3: et kurs med minst én påbegynt-ufullført deltaker arkiveres (pensjoneres) ikke uten at forfatteren har bekreftet tallet.
// Avpublisering er bevisst unntatt (reversibel «myk» nedtaking) — derfor peker meldingen på Avpubliser som alternativ.
// #1150 skive 2a-2: fra sperre til bekreftelse (produkteier 13.11.2026). `archiveCourse` (courseArchive.ts) kaster denne når
// kallet ikke sender det forfatteren så (`expected`), og tallet kommer fra analysen den alt har regnet
// (`analyzeCourseArchive` → `findCourseInProgressParticipants`), så det er det samme tallet forhåndsvisningen viste.
export function courseHasActiveParticipantsError(count: number): AppError {
  const deltaker = count === 1 ? "1 deltaker er" : `${count} deltakere er`;
  return new DomainRuleError(
    "course_has_active_participants",
    `Kurset kan ikke arkiveres fordi ${deltaker} midt i en gjennomføring. ` +
      `Avpubliser kurset i stedet (skjuler det uten å pensjonere det), eller vent til de er ferdige.`,
    { count },
  );
}
