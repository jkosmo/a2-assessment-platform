import { prisma } from "../../db/prisma.js";
import type { DbTransactionClient } from "../../db/transaction.js";
import { type AppError, ConflictError, DomainRuleError, ValidationError } from "../../errors/AppError.js";
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";

// Enhetlig innholds-livssyklus — delte vakter for kurs/modul/seksjon.
// Se doc/design/CONTENT_LIFECYCLE.md. G2 = bruk-lås (se «Hvilke kurs bruker dette elementet» under).
// G3 = aktivitets-lås (kurs med påbegynt-ufullført deltaker kan ikke arkiveres).
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
//     - det som stopper SLETTING                                   assertSectionNotInAnyCourse, describeModuleDeleteBlock
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

// #705-UX(G), #1149: batch — hvilke AKTIVE kurs bruker hvert av disse elementene. For «Brukt i kurs»-kolonnen,
// kursfilteret og popoveren i seksjonslista og modulbiblioteket. Ett spørsmål for alle elementene.
// Et arkivert kurs er ikke med: det er ikke bruk (se toppen av fila).
async function activeCoursesByItem(
  key: "moduleId" | "sectionId",
  ids: string[],
  locale: SupportedLocale,
): Promise<Map<string, Array<{ id: string; title: string }>>> {
  const result = new Map<string, Array<{ id: string; title: string }>>();
  if (ids.length === 0) return result;
  const items = await prisma.courseItem.findMany({
    where:
      key === "moduleId"
        ? { moduleId: { in: ids }, course: activeCourseWhere }
        : { sectionId: { in: ids }, itemType: "SECTION", course: activeCourseWhere },
    select: { moduleId: true, sectionId: true, course: { select: { id: true, title: true } } },
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

function inActiveCourseError(subject: "Modulen" | "Seksjonen", verb: string, courses: CourseUse[]) {
  // #999: koden er kontrakten. `courseTitles` følger med så klienten kan navngi kursene uten
  // å lese dem ut av setningen.
  return new DomainRuleError("content_in_use", inUseMessage(subject, verb, courses), {
    count: courses.length,
    courseTitles: courses.map((c) => c.title),
  });
}

// G2, avpublisering og arkivering: en modul som ligger i et AKTIVT kurs (publisert eller utkast) kan ikke trekkes
// vekk under det. Et arkivert kurs stopper ikke (#1149): blir det gjenopprettet, lander det som utkast, og
// publiseringen stoppes av `item_archived` til elementet er gjenopprettet eller tatt ut.
// `verb` brukes i feilmeldingen. Sletting har sin egen vakt under, og kan ikke bruke denne.
export async function assertModuleNotInActiveCourse(
  moduleId: string,
  verb: "avpubliseres" | "arkiveres",
  reader: LifecycleReader = prisma,
): Promise<void> {
  const courses = await findActiveCoursesContainingModule(moduleId, reader);
  if (courses.length > 0) throw inActiveCourseError("Modulen", verb, courses);
}

// G2 for seksjoner — samme regel.
export async function assertSectionNotInActiveCourse(
  sectionId: string,
  verb: "avpubliseres" | "arkiveres",
  reader: LifecycleReader = prisma,
): Promise<void> {
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
        // Ingen anvisning om å gjenopprette kurset og ta elementet ut (QA-porten 2.158.0): for en modul stopper
        // slettingen likevel på versjonene, og for en seksjon i et utstedt kursbevis på beviset. Rådet kostet et
        // endret arkivert kurs og førte nesten aldri til sletting. Veien som virker, kommer med #1152.
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

/**
 * Sletting av en modul: `null` når den ikke ligger i noe kurs, ellers feilen som skal kastes. Returnerer i stedet
 * for å kaste fordi sletteruta (`DELETE /api/admin/content/modules/:id`) svarer med sin egen form (#705:
 * `courseCount` øverst i kroppen) før den kaller `deleteModule`, som sjekker på nytt etter innholdslåsen.
 */
export async function describeModuleDeleteBlock(moduleId: string, reader: LifecycleReader = prisma) {
  const courses = await findAllCoursesContainingModule(moduleId, reader);
  return courses.length > 0 ? { error: deleteBlockedError("Modulen", courses), courseCount: courses.length } : null;
}

/** Sletting av en seksjon stoppes av ALLE kurs, også arkiverte. Avpublisering og arkivering: `assertSectionNotInActiveCourse`. */
export async function assertSectionNotInAnyCourse(sectionId: string, reader: LifecycleReader = prisma): Promise<void> {
  const courses = await findAllCoursesContainingSection(sectionId, reader);
  if (courses.length > 0) throw deleteBlockedError("Seksjonen", courses);
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
      + "Arkiver den i stedet — et kursbevis må kunne vise hva det dekket.",
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

  const legacy = await reader.courseCompletion.findMany({
    where: {
      sectionSnapshotJson: null,
      userId: { in: [...new Set(reads.map((r) => r.userId))] },
      courseId: { in: [...new Set(reads.map((r) => r.courseId))] },
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
      + "øyeblikksbildet ble innført. Arkiver den i stedet — et kursbevis må kunne vise hva det dekket.",
      { count: covered },
    );
  }
}

// Antall deltakere som har PÅBEGYNT (lest en seksjon eller levert et forsøk på en kurs-modul)
// men IKKE fullført (ingen CourseCompletion). Brukt av G3-vakta for kurs.
export async function countCourseInProgressParticipants(courseId: string, reader: LifecycleReader = prisma): Promise<number> {
  const [reads, submissions, completions] = await Promise.all([
    reader.courseSectionRead.findMany({
      where: { courseId },
      select: { userId: true },
      distinct: ["userId"],
    }),
    reader.submission.findMany({
      where: { module: { courseItems: { some: { courseId } } } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    reader.courseCompletion.findMany({ where: { courseId }, select: { userId: true } }),
  ]);

  const completed = new Set(completions.map((c) => c.userId));
  const started = new Set<string>();
  for (const r of reads) started.add(r.userId);
  for (const s of submissions) started.add(s.userId);

  let inProgress = 0;
  for (const userId of started) {
    if (!completed.has(userId)) inProgress += 1;
  }
  return inProgress;
}

// G3: et kurs med minst én påbegynt-ufullført deltaker kan ikke arkiveres (pensjoneres). Avpublisering
// er bevisst unntatt (reversibel «myk» nedtaking) — derfor peker meldingen på Avpubliser som alternativ.
export async function assertCourseHasNoInProgressParticipants(courseId: string, verb: string, reader: LifecycleReader = prisma): Promise<void> {
  const count = await countCourseInProgressParticipants(courseId, reader);
  if (count > 0) {
    const deltaker = count === 1 ? "1 deltaker er" : `${count} deltakere er`;
    throw new DomainRuleError(
      "course_has_active_participants",
      `Kurset kan ikke ${verb} fordi ${deltaker} midt i en gjennomføring. ` +
        `Avpubliser kurset i stedet (skjuler det uten å pensjonere det), eller vent til de er ferdige.`,
      { count },
    );
  }
}
