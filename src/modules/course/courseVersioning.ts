// #934 skive 3: kursets versjon økes, og hva en ny hovedversjon betyr for lesingene.
//
// Produkteier 2026-11-01 (doc/DESIGN_934.md):
//   - Innholdsansvarlig velger hovedversjon eller mindre versjon når et publisert kurs endres.
//     Standarden er mindre: et feiltrykk skal ikke ta kursbeviset fra noen.
//   - Har ingen kursbevis for kursets nåværende hovedversjon, stilles ikke spørsmålet: versjonen øker
//     som mindre. Tjeneren håndhever det samme — en hovedversjon uten noen å gjelde blir mindre.
//   - Et kurs som aldri er publisert, får ingen ny versjon: det blir 1.0 når det publiseres første gang.
//     Et kurs som HAR vært publisert (avpublisert, eller med kursbevis), versjoneres som et publisert —
//     ellers kunne innholdet endres mens kurset var nede og publiseres igjen uten versjon (QA-porten).
//   - Det som allerede er gjort, teller: en seksjon som er lest, står som lest — unntatt en seksjon som
//     er endret siden forrige hovedversjon. Den leses på nytt.
//
// Regelen for seksjoner bor her, og ALLE som spør «hvilke seksjoner har deltakeren lest i dette kurset»
// går gjennom `filterReadsForCurrentVersion` (kursrepositoriet). Porten for kursbevis, fremdriften i
// «Mine kurs», lesemerket i kursdetaljen og kursrapporten må svare likt — ellers står kurset som lest
// i lista mens beviset aldri kommer.
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import type { DbTransactionClient } from "../../db/transaction.js";
import type { prisma } from "../../db/prisma.js";
import { listManageableContentIds } from "../content/contentOwnershipService.js";
import type { ContentWriteTx } from "../../db/contentLock.js";
import { AppError, ConflictError, NotFoundError } from "../../errors/AppError.js";
import { raiseModuleRequirementInCourse } from "../adminContent/moduleVersioning.js";
import { assertNoCourseDraftBlocksWrite } from "./courseDraft.js";
import { assertNotArchived } from "../content/archivedGuard.js";

export type CourseVersionChoice = "major" | "minor";

/** Seksjon → aktiv seksjonsversjon. Lages av kursrepositoriet (`findSectionVersions`), kursets innhold-dør. */
export type SectionVersions = Record<string, string | null>;

/**
 * Øyeblikksbildet en hovedversjon trenger: seksjonsversjonene RETT FØR endringen (tatt av kalleren før den
 * skrev noe), og en måte å lese dem etter på. `after` kalles bare for en hovedversjon.
 * #934 skive 4b: også modulene som var levende i kurset før (`modulesBefore`), og etter — så e-posten kan si hvor
 * mange elementer som er nye eller endret (`changedItemCount`). Lages av kursrepositoriet (`snapshotContent`).
 */
export type SectionSnapshot = {
  before: SectionVersions;
  after: () => Promise<SectionVersions>;
  modulesBefore: string[];
  modulesAfter: () => Promise<string[]>;
};

/** Navn og beskrivelse er ikke seksjoner: endringen gir alltid mindre, og trenger ikke noe øyeblikksbilde. */
export const NO_SECTION_SNAPSHOT: SectionSnapshot = { before: {}, after: async () => ({}), modulesBefore: [], modulesAfter: async () => [] };

/**
 * #934 skive 4b: hvor mange elementer som er nye eller endret i en ny hovedversjon — det e-posten forteller.
 * Seksjoner med ny versjon eller nye i kurset, moduler som er levende i kurset nå, men ikke var det før, og (5a-3) moduler med
 * hevet krav. En modul med ny versjon som ikke hevet kravet, telles ikke: for deltakeren er ingenting nytt å ta.
 */
export function countChangedItems(
  before: SectionVersions,
  after: SectionVersions,
  modulesBefore: string[],
  modulesAfter: string[],
  raisedModuleIds: string[] = [],
): number {
  const sections = Object.keys(after).filter(
    (sectionId) => !Object.prototype.hasOwnProperty.call(before, sectionId) || before[sectionId] !== after[sectionId],
  ).length;
  const wasLive = new Set(modulesBefore);
  const modules = new Set([...modulesAfter.filter((moduleId) => !wasLive.has(moduleId)), ...raisedModuleIds]).size;
  return sections + modules;
}

// ---------------------------------------------------------------------------
// #934 skive 4b: hvem som får e-post om en ny hovedversjon
// ---------------------------------------------------------------------------

/**
 * Over så mange mottakere krever dialogen et ekstra «ja», og serveren et bekreftet tall (produkteier 2026-11-03).
 */
export const MAJOR_EMAIL_CONFIRM_THRESHOLD = 200;

type RecipientReader = Pick<DbTransactionClient, "user">;

/** Hvem en ny hovedversjon av kurset sender e-post til — se `findMajorVersionRecipients`. */
function majorVersionRecipientWhere(courseId: string) {
  return { activeStatus: true, isAnonymized: false, courseCompletions: { some: { courseId } } };
}

/**
 * ⚠️ DEN ENE REGELEN for hvem som får e-post om en ny hovedversjon (doc/DESIGN_934.md, «4b»): har kursbevis for
 * kurset (for en eldre hovedversjon — den nye har ingen ennå), er aktiv og ikke anonymisert. Én per person, uansett
 * hvor mange bevis hen har. Radene i `CourseVersionNotice` lages fra denne, og dialogene viser tallet fra
 * `countMajorVersionRecipients`, som bruker det samme vilkåret — så tallet forfatteren ser, og antall e-poster,
 * er det samme. Tallet kan være høyere enn `certificateHolders`, som bare teller nåværende hovedversjon.
 */
export async function findMajorVersionRecipients(client: RecipientReader, courseId: string): Promise<string[]> {
  const users = await client.user.findMany({ where: majorVersionRecipientWhere(courseId), select: { id: true }, orderBy: { id: "asc" } });
  return users.map((user) => user.id);
}

/** Tallet dialogene viser (`majorEmailRecipients`): det samme vilkåret som `findMajorVersionRecipients`. */
export function countMajorVersionRecipients(client: RecipientReader, courseId: string): Promise<number> {
  return client.user.count({ where: majorVersionRecipientWhere(courseId) });
}

/**
 * Lager én rad per mottaker for hovedversjonen, i transaksjonen som lager den (bare med innholdslåsen). Et nytt
 * forsøk på samme versjon lager ingen nye rader: den unike nøkkelen (kurs, hovedversjon, person) hopper over dem som
 * finnes. Radene venter (`waiting`) til workeren sender dem — også når e-posten er slått av, så ingen går tapt.
 */
export async function createMajorVersionNotices(
  client: ContentWriteTx,
  courseId: string,
  versionMajor: number,
  recipients: string[],
): Promise<number> {
  if (recipients.length === 0) return 0;
  const created = await client.courseVersionNotice.createMany({
    data: recipients.map((userId) => ({ courseId, versionMajor, userId })),
    skipDuplicates: true,
  });
  return created.count;
}

// #934 skive 4a: kurslåsene (`lockCourseRow`, `lockCourseRowShared`) er borte. Innholdslåsen (src/db/contentLock.ts)
// gjør jobben: alle som endrer versjonen, holder den eksklusivt (typen `ContentWriteTx` krever det), og en
// deltakers lesing tar den delt. Dermed er grensen `publishedAt` for en ny hovedversjon like ekte som før: en
// lesing gjort mens den gamle teksten var aktiv, er ferdig før versjonsendringen får låsen; en lesing etter, ser
// den nye teksten.

/**
 * «Har vært ute»: publisert nå, eller fikk delingslenka ved første publisering (2.121.0), eller har kursbevis
 * (eldre kurs uten lenke). Et kurs som aldri har vært ute, har ingen versjon å endre — og (4a) det er det eneste
 * kurset `PUT …/items` og `PUT …/modules` godtar uten telleren fra skjemaet.
 */
export async function isCourseEverPublished(
  client: Pick<DbTransactionClient, "course" | "courseCompletion">,
  courseId: string,
): Promise<boolean> {
  const course = await client.course.findUnique({ where: { id: courseId }, select: { publishedAt: true, slug: true } });
  if (!course) return false;
  return course.publishedAt != null || course.slug != null || (await client.courseCompletion.count({ where: { courseId } })) > 0;
}

/**
 * #934 skive 4a: telleren for kursets innhold og innstillinger. Kalles etter innholdslåsen, før noe skrives.
 *
 *   - Med `expected` (kursskjemaet sender tallet det lastet): stemmer det ikke, har noen andre lagret kurset
 *     siden skjemaet ble åpnet. `409 course_changed`, og transaksjonen rulles tilbake — ingenting er skrevet.
 *   - Uten `expected` (importen, og agent-tokenet på et utkast): telleren øker bare.
 *
 * Returnerer den nye verdien.
 */
export async function claimCourseRevision(
  client: ContentWriteTx,
  courseId: string,
  expected?: number,
  // #1140 etappe 2: bare publiseringen av utkastet setter denne. Alle andre som skriver kursets felt eller liste, stoppes
  // her når kurset har et utkast: `409 course_has_draft`, og ingenting er skrevet.
  options?: { publishingDraft?: boolean },
): Promise<number> {
  // #1151: et arkivert kurs får ikke nye felt eller ny elementliste. Først, så svaret er «kurset er arkivert» og ikke noe annet.
  await assertNotArchived(client, { type: "COURSE", id: courseId });
  if (!options?.publishingDraft) await assertNoCourseDraftBlocksWrite(client, courseId);
  if (expected === undefined) {
    const updated = await client.course.updateMany({ where: { id: courseId }, data: { contentRevision: { increment: 1 } } });
    if (updated.count === 0) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  } else {
    const updated = await client.course.updateMany({
      where: { id: courseId, contentRevision: expected },
      data: { contentRevision: { increment: 1 } },
    });
    if (updated.count === 0) {
      const current = await client.course.findUnique({ where: { id: courseId }, select: { contentRevision: true } });
      if (!current) throw new NotFoundError("Course", "course_not_found", "Course not found.");
      throw new ConflictError(
        "course_changed",
        "Someone else saved this course after you opened it. Reload the page to see their changes; nothing was saved.",
        { expectedRevision: expected, currentRevision: current.contentRevision },
      );
    }
  }
  const row = await client.course.findUniqueOrThrow({ where: { id: courseId }, select: { contentRevision: true } });
  return row.contentRevision;
}

/** Hvor mange som har kursbevis for kursets nåværende hovedversjon — dem en ny hovedversjon gjelder. */
export function countCertificateHolders(
  client: Pick<DbTransactionClient, "courseCompletion">,
  courseId: string,
  versionMajor: number,
): Promise<number> {
  return client.courseCompletion.count({ where: { courseId, versionMajor } });
}

export type CourseVersionBump = {
  kind: CourseVersionChoice;
  from: { major: number; minor: number };
  to: { major: number; minor: number };
  /** #934 skive 5a-3: modulene som fikk hevet kravet i kurset. Bare der det er noen. */
  raisedModuleIds?: string[];
};

/**
 * Hvordan en endring spør om versjonen (produkteier 2026-11-01/02, doc/DESIGN_934.md):
 *   - `question`: forfatteren svarer mindre eller hoved — kursskjemaet, «Publiser nye versjoner», «Publiser
 *     kurs» med nytt innhold, import som bytter ut alt. UTEN svar avvises endringen når noen har kursbevis
 *     for kursets nåværende hovedversjon (`course_version_required`); dialogene har alltid et svar.
 *   - `minor`: designet stiller ikke spørsmålet — navn/beskrivelse, seksjon eller modul publisert fra sin egen
 *     side, import «Oppdater dette kurset», legacy `PUT …/modules`.
 *
 * #934 skive 4b: `confirmEmailRecipients` er tallet dialogen viste da forfatteren sa ja til å sende e-post til
 * over `MAJOR_EMAIL_CONFIRM_THRESHOLD` mottakere. Se `applyCourseVersionChange`.
 *
 * #934 skive 5a-3: `raiseModules` er modulene som fikk ny hovedversjon sammen med denne endringen. Blir det hovedversjon av
 * kurset, heves kravet deres her. Blir det mindre, skjer ingenting. Slik kan ikke kursets versjon og kravet komme fra to svar.
 */
export type CourseVersionRequest =
  | { kind: "question"; answer?: CourseVersionChoice; confirmEmailRecipients?: number; raiseModules?: Array<{ moduleId: string; major: number }> }
  | { kind: "minor" };

/**
 * Regelen for om et kurs får hovedversjon: svaret er hoved, og noen har kursbevis for den nåværende hovedversjonen. Uten
 * bevis finnes det ingen å gjelde for (svar d). Én funksjon, for dialogen, publiseringen og kravet må si det samme.
 */
export function resolveCourseVersionKind(answer: CourseVersionChoice | undefined, certificateHolders: number): CourseVersionChoice {
  return answer === "major" && certificateHolders > 0 ? "major" : "minor";
}

/** #934 skive 5a-3: et kurs en publisering berører, med tallene dialogen viser. Samme funksjoner som publiseringen bruker. */
export type AffectedCourse = {
  courseId: string;
  /** Som lagret. Ruta lokaliserer. */
  title: string;
  published: boolean;
  archived: boolean;
  versionMajor: number;
  versionMinor: number;
  certificateHolders: number;
  majorEmailRecipients: number;
};

/**
 * Kursene som har et av elementene, og som har vært ute, også avpubliserte og arkiverte. Samme avgrensning som
 * `applyCourseVersionChange`, som ikke gir et kurs som aldri har vært ute, noen versjon.
 */
export async function findAffectedCourses(
  client: Pick<DbTransactionClient, "course" | "courseCompletion" | "user">,
  refs: Array<{ sectionId: string } | { moduleId: string }>,
): Promise<AffectedCourse[]> {
  if (refs.length === 0) return [];
  const courses = await client.course.findMany({
    where: { OR: refs.map((one) => ({ items: { some: one } })) },
    select: { id: true, title: true, publishedAt: true, archivedAt: true, versionMajor: true, versionMinor: true },
    orderBy: { id: "asc" },
  });
  const affected: AffectedCourse[] = [];
  for (const course of courses) {
    if (!(await isCourseEverPublished(client, course.id))) continue;
    affected.push({
      courseId: course.id,
      title: course.title,
      published: course.publishedAt != null,
      archived: course.archivedAt != null,
      versionMajor: course.versionMajor,
      versionMinor: course.versionMinor,
      certificateHolders: await countCertificateHolders(client, course.id, course.versionMajor),
      majorEmailRecipients: await countMajorVersionRecipients(client, course.id),
    });
  }
  return affected;
}

/**
 * 2.137.0 (produkteier 2026-11-06): bare kursets eier, eller en administrator, velger hovedversjon for et kurs. En hovedversjon krever
 * nytt forsøk og sender e-post til kursets deltakere, så den skal ikke kunne utløses av den som eier en modul i kurset.
 */
export function coursesActorMayChoose(
  reader: DbTransactionClient | typeof prisma,
  courses: Array<{ courseId: string }>,
  actor: { userId: string; roles: string[] },
): Promise<Set<string>> {
  return listManageableContentIds({
    contentType: "COURSE",
    contentIds: courses.map((course) => course.courseId),
    actorUserId: actor.userId,
    roles: actor.roles,
    reader,
  });
}

/** Kursene slik dialogen skal vise dem: `canChooseVersion: false` gir beskjeden, uten valg. */
export async function withVersionChoiceRights(
  reader: DbTransactionClient | typeof prisma,
  courses: AffectedCourse[],
  actor: { userId: string; roles: string[] },
): Promise<Array<AffectedCourse & { canChooseVersion: boolean }>> {
  const mayChoose = await coursesActorMayChoose(reader, courses, actor);
  return courses.map((course) => ({ ...course, canChooseVersion: mayChoose.has(course.courseId) }));
}

/**
 * ⚠️ DEN ENE VEIEN til en ny kursversjon. Alle måter innhold går live på i et kurs, eller kursets versjon
 * endres, kaller denne (eller `applyMinorVersionToCoursesContaining`, som kaller denne) — produkteier
 * 2026-11-02: «felles kode, ikke duplisert logikk». Den eier sjekken av kursbevis, regelen for manglende
 * svar, låsen, øyeblikksbildet og økningen. `test/course-version-write-guard.test.js` nekter andre skrivere.
 *
 * `snapshot.before` er seksjonsversjonene RETT FØR endringen; `snapshot.after` leser dem etter. Kalles i samme
 * transaksjon som endringen, så øyeblikksbildet og versjonen ikke kan skilles — og en avvisning ruller
 * endringen tilbake. Returnerer `null` når kurset aldri har vært publisert (det blir 1.0 ved første
 * publisering) — da økes ingenting.
 *
 * #934 skive 4b: en hovedversjon lager også e-postradene (`CourseVersionNotice`), i samme transaksjon, og avvises
 * med `409 major_email_confirm_required` når mottakerne er over grensen og tallet ikke er bekreftet. Alle veier til
 * en hovedversjon går hit, så ingen av dem kan lage en hovedversjon uten e-post, eller e-post uten regelen.
 */
export async function applyCourseVersionChange(
  // #934 skive 4a: bare en transaksjon som holder innholdslåsen eksklusivt, kan endre versjonen. Låsen gjør det
  // `lockCourseRow` gjorde: to endringer som overlapper, kan ikke lese samme versjon og skrive samme neste.
  client: ContentWriteTx,
  courseId: string,
  request: CourseVersionRequest,
  snapshot: SectionSnapshot,
  actorId?: string,
): Promise<CourseVersionBump | null> {
  const { before } = snapshot;
  const course = await client.course.findUnique({
    where: { id: courseId },
    select: { publishedAt: true, slug: true, versionMajor: true, versionMinor: true },
  });
  if (!course) return null;
  if (!(await isCourseEverPublished(client, courseId))) return null;

  const from = { major: course.versionMajor, minor: course.versionMinor };
  const holders = request.kind === "question" ? await countCertificateHolders(client, courseId, course.versionMajor) : 0;
  if (request.kind === "question" && !request.answer && holders > 0) {
    throw new AppError(
      "course_version_required",
      400,
      'Participants have a course certificate for this course: say whether this is a minor or a major version (version: "minor" | "major").',
      { certificateHolders: holders },
    );
  }
  const choice: CourseVersionChoice = request.kind === "question" && request.answer ? request.answer : "minor";
  // Hovedversjon er et valg som gjelder kursbevis. Har ingen bevis for denne hovedversjonen, finnes det
  // ingen å gjelde for — og en hovedversjon ville bare krevd ny lesing av dem som er midt i kurset.
  const kind = resolveCourseVersionKind(choice, holders);

  let to: { major: number; minor: number };
  let emailRecipients: number | undefined;
  const raisedModuleIds: string[] = [];
  if (kind === "minor") {
    to = { major: from.major, minor: from.minor + 1 };
    await client.course.update({ where: { id: courseId }, data: { versionMinor: to.minor } });
  } else {
    to = { major: from.major + 1, minor: 0 };
    // #934 skive 4b: mottakerne regnes ut etter låsen, i denne transaksjonen — tallet dialogen viste, er bare et
    // forslag. Over grensen må forfatteren ha bekreftet minst så mange; ellers avvises endringen, og ingenting er
    // skrevet (transaksjonen rulles tilbake). En gammel klient sender aldri bekreftelsen og avvises over grensen.
    const recipients = await findMajorVersionRecipients(client, courseId);
    const confirmed = request.kind === "question" ? request.confirmEmailRecipients : undefined;
    if (recipients.length > MAJOR_EMAIL_CONFIRM_THRESHOLD && (confirmed === undefined || confirmed < recipients.length)) {
      throw new ConflictError(
        "major_email_confirm_required",
        `A major version e-mails ${recipients.length} participants. Confirm the number (confirmEmailRecipients) to go ahead; nothing was saved.`,
        { majorEmailRecipients: recipients.length, confirmEmailRecipients: confirmed ?? null, threshold: MAJOR_EMAIL_CONFIRM_THRESHOLD },
      );
    }
    const now = new Date();
    const after = await snapshot.after();
    // #934 skive 5a-3: kravet heves i samme transaksjon, i kursene som fikk hovedversjon. Det er ingen glipe (sannhetstabellen).
    for (const raise of request.kind === "question" ? (request.raiseModules ?? []) : []) {
      if (await raiseModuleRequirementInCourse(client, courseId, raise.moduleId, raise.major)) raisedModuleIds.push(raise.moduleId);
    }
    const changedItemCount = countChangedItems(before, after, snapshot.modulesBefore, await snapshot.modulesAfter(), raisedModuleIds);
    // Raden for versjonen som slutter: det som gjaldt rett før endringen. Fantes den (kurset har hatt en
    // hovedversjon før), skrives slutten av den over starten — regelen sammenligner slutten av N−1 med
    // starten av N, så en seksjon som fikk ny versjon INNENFOR N−1 (mindre versjon, #1095) ikke telles
    // som endret en gang til.
    await client.courseVersion.upsert({
      where: { courseId_versionMajor: { courseId, versionMajor: from.major } },
      update: { sectionVersionsJson: JSON.stringify(before) },
      create: {
        courseId,
        versionMajor: from.major,
        publishedAt: course.publishedAt ?? now,
        sectionVersionsJson: JSON.stringify(before),
      },
    });
    await client.courseVersion.create({
      data: { courseId, versionMajor: to.major, publishedAt: now, sectionVersionsJson: JSON.stringify(after), changedItemCount },
    });
    await client.course.update({ where: { id: courseId }, data: { versionMajor: to.major, versionMinor: 0 } });
    // #934 skive 4b: e-posten, én rad per mottaker, i samme transaksjon som hovedversjonen.
    await createMajorVersionNotices(client, courseId, to.major, recipients);
    emailRecipients = recipients.length;
  }

  await recordAuditEvent(
    {
      entityType: auditEntityTypes.course,
      entityId: courseId,
      action: auditActions.course.versionChanged,
      actorId,
      metadata: {
        courseId,
        kind,
        requested: choice,
        from: `${from.major}.${from.minor}`,
        to: `${to.major}.${to.minor}`,
        ...(emailRecipients !== undefined ? { emailRecipients } : {}),
        ...(raisedModuleIds.length > 0 ? { raisedModuleIds } : {}),
      },
    },
    client,
  );
  return { kind, from, to, ...(raisedModuleIds.length > 0 ? { raisedModuleIds } : {}) };
}

/**
 * En seksjon eller modul går live fra sin EGEN side (publisert, lagret med alle språk, ny terskel). Den er
 * levende innhold i hvert kurs den ligger i; designet stiller ikke spørsmålet der («Ingen — mindre for
 * kursene»), så hvert kurs som har vært ute får en mindre versjon. Modulens eget hoved/mindre-valg per kurs
 * kommer i skive 5. Kursene gås i id-rekkefølge; innholdslåsen gjør at to slike endringer aldri går samtidig.
 */
export async function applyMinorVersionToCoursesContaining(
  client: ContentWriteTx,
  ref: { sectionId: string } | { moduleId: string } | Array<{ sectionId: string } | { moduleId: string }>,
  actorId?: string,
  // «Publiser nye versjoner» og «Publiser kurs» avgjør versjonen for kurset de står i, med forfatterens svar.
  // De delte elementene er levende også i ANDRE kurs — de får en mindre versjon her, én gang hvert.
  options?: { exceptCourseId?: string },
): Promise<void> {
  const refs = Array.isArray(ref) ? ref : [ref];
  if (refs.length === 0) return;
  const courses = await client.course.findMany({
    where: {
      OR: refs.map((one) => ({ items: { some: one } })),
      ...(options?.exceptCourseId ? { id: { not: options.exceptCourseId } } : {}),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const course of courses) {
    await applyCourseVersionChange(client, course.id, { kind: "minor" }, NO_SECTION_SNAPSHOT, actorId);
  }
}

/**
 * Navn og beskrivelse lagres som språkkart i JSON. Samme tekst med nøklene i en annen rekkefølge, et tomt
 * språk med eller uten nøkkel, eller ren tekst mot `{"nb": …}` med samme tekst, er ingen endring og skal ikke
 * gi ny versjon. Ren tekst er bokmål — slik klienten leser den (`parseLocalizedFieldValues`). Kursskjemaet og
 * importen sender hele kartet ved hver lagring.
 */
export function sameLocalizedText(a: string | null | undefined, b: string | null | undefined) {
  const canonical = (value: string | null | undefined) => {
    if (value == null) return "[]";
    let map: Record<string, unknown> = { nb: value };
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) map = parsed as Record<string, unknown>;
      else if (typeof parsed === "string") map = { nb: parsed };
    } catch {
      // Ren tekst, ikke et språkkart: bokmål.
    }
    return JSON.stringify(
      Object.keys(map).sort().map((key) => [key, typeof map[key] === "string" ? (map[key] as string).trim() : (map[key] ?? "")]).filter(([, v]) => v !== ""),
    );
  };
  return canonical(a) === canonical(b);
}

/**
 * En seksjon byttes ut med en kopi under ny id (import «Oppdater dette kurset», #1095: et fremmed element
 * byttes med forfatterens kopi av den LEVENDE versjonen, og lesingene kopieres med samme tidspunkt). For
 * regelen er det samme seksjon: øyeblikksbildene for nåværende og forrige hovedversjon flytter nøkkelen til
 * den nye id-en, og en seksjon som var uendret, forblir uendret — ellers ville de kopierte lesingene ikke telle.
 */
export async function renameSectionInVersionSnapshots(
  client: ContentWriteTx,
  courseId: string,
  oldSectionId: string,
  newSectionId: string,
): Promise<void> {
  const rows = await client.courseVersion.findMany({ where: { courseId }, orderBy: { versionMajor: "desc" }, take: 2 });
  const [current, previous] = rows;
  if (!current) return;
  const now = parseSectionVersions(current.sectionVersionsJson);
  if (!Object.prototype.hasOwnProperty.call(now, oldSectionId)) return;
  const then = previous ? parseSectionVersions(previous.sectionVersionsJson) : {};
  const hadBefore = Object.prototype.hasOwnProperty.call(then, oldSectionId);
  const unchanged = hadBefore && then[oldSectionId] === now[oldSectionId];
  if (hadBefore) {
    then[newSectionId] = then[oldSectionId];
    delete then[oldSectionId];
  }
  // Uendret: begge sider sier det samme. Endret (eller ny i denne versjonen): forskjellig, som før byttet.
  now[newSectionId] = unchanged ? then[newSectionId] : `erstattet:${newSectionId}`;
  delete now[oldSectionId];
  await client.courseVersion.update({ where: { id: current.id }, data: { sectionVersionsJson: JSON.stringify(now) } });
  if (previous && hadBefore) {
    await client.courseVersion.update({ where: { id: previous.id }, data: { sectionVersionsJson: JSON.stringify(then) } });
  }
}

/** Regelen for én hovedversjon: lesinger fra før `since` teller bare for seksjonene i `unchanged`. */
export type SectionReadRule = { since: Date; unchanged: Set<string> };

/**
 * Regelen for kursenes NÅVÆRENDE hovedversjon, per kurs. Et kurs uten rader har ingen regel (`null`):
 * alle lesinger teller, som før skive 3. Raden med høyest hovedversjon er den nåværende — rader lages
 * bare når en hovedversjon lages, i samme transaksjon som kursets versjon økes.
 */
export async function loadSectionReadRules(
  client: Pick<DbTransactionClient, "courseVersion">,
  courseIds: string[],
): Promise<Map<string, SectionReadRule | null>> {
  const rules = new Map<string, SectionReadRule | null>();
  if (courseIds.length === 0) return rules;
  const rows = await client.courseVersion.findMany({
    where: { courseId: { in: courseIds } },
    select: { courseId: true, versionMajor: true, publishedAt: true, sectionVersionsJson: true },
  });
  const byCourse = new Map<string, typeof rows>();
  for (const row of rows) byCourse.set(row.courseId, [...(byCourse.get(row.courseId) ?? []), row]);
  for (const courseId of courseIds) {
    const own = byCourse.get(courseId) ?? [];
    if (own.length === 0) {
      rules.set(courseId, null);
      continue;
    }
    const current = own.reduce((a, b) => (b.versionMajor > a.versionMajor ? b : a));
    const previous = own.find((row) => row.versionMajor === current.versionMajor - 1);
    const now = parseSectionVersions(current.sectionVersionsJson);
    const then = previous ? parseSectionVersions(previous.sectionVersionsJson) : {};
    const unchanged = new Set(
      Object.keys(now).filter((sectionId) => Object.prototype.hasOwnProperty.call(then, sectionId) && then[sectionId] === now[sectionId]),
    );
    rules.set(courseId, { since: current.publishedAt, unchanged });
  }
  return rules;
}

/** Teller denne lesingen for kursets nåværende hovedversjon? */
export function readCountsForCurrentVersion(rule: SectionReadRule | null | undefined, sectionId: string, readAt: Date | null | undefined): boolean {
  if (!rule) return true;
  if (rule.unchanged.has(sectionId)) return true;
  return readAt != null && readAt.getTime() >= rule.since.getTime();
}

function parseSectionVersions(json: string): SectionVersions {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as SectionVersions) : {};
  } catch {
    return {};
  }
}
