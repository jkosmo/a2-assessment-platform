import { prisma } from "../../db/prisma.js";
import type { ReportFilters } from "../reporting/types.js";
import { findModuleProgress, type ModuleProgressInput } from "./moduleCredit.js";
import { sectionAvailableWhere } from "./sectionAvailability.js";
import { countCertificateHolders, loadSectionReadRules, readCountsForCurrentVersion, type SectionSnapshot } from "./courseVersioning.js";
import type { LearnerContentTx } from "../../db/contentLock.js";

function buildSubmissionWhere(filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {}) {
  return {
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
  };
}

function buildCompletionWhere(filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {}) {
  return {
    ...(filters.dateFrom || filters.dateTo
      ? {
          // #1145: et bevis registrert for et kurs tatt utenfor plattformen har ingen kjent dato; `completedAt` er registreringen.
          // Det telles som fullført uavhengig av perioden, i stedet for å falle inn eller ut etter når det ble registrert.
          OR: [
            {
              completedAt: {
                ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
                ...(filters.dateTo ? { lte: filters.dateTo } : {}),
              },
            },
            { source: "external" },
          ],
        }
      : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
  };
}

type CourseRepositoryClient = Pick<
  typeof prisma,
  | "course"
  | "courseItem"
  | "courseCompletion"
  | "courseSectionRead"
  | "courseVersion"
  | "certificationStatus"
  | "courseModuleRequirement"
  | "modulePass"
  | "platformConfig"
  | "submission"
  | "$queryRaw"
>;

// #934 skive 3: seksjon → aktiv seksjonsversjon for seksjonene kurset inneholder nå. Øyeblikksbildet en
// ny hovedversjon lagrer i `CourseVersion` (courseVersioning.ts). Alle seksjoner, også arkiverte og
// tilbakeholdte: det er hva kurset INNEHOLDER som sammenlignes, ikke hva en deltaker kan lese.
async function findSectionVersions(client: Pick<CourseRepositoryClient, "courseItem">, courseId: string): Promise<Record<string, string | null>> {
  const items = await client.courseItem.findMany({
    where: { courseId, itemType: "SECTION", sectionId: { not: null } },
    select: { sectionId: true, section: { select: { activeVersionId: true } } },
  });
  const map: Record<string, string | null> = {};
  for (const item of items) if (item.sectionId) map[item.sectionId] = item.section?.activeVersionId ?? null;
  return map;
}

/**
 * #1156: hvilken elementliste et kurs spør for når lesinger telles (sectionReadCredit.ts).
 *   - `participant`: seksjonene deltakeren kan lese nå (`sectionAvailableWhere`, som deltakerdøra). Fremdrift, kursbevis, «Mine
 *     kurs», kursdetaljen og rapportens «leste seksjoner».
 *   - `all`: alle seksjonene kurset inneholder, også arkiverte og tilbakeholdte. #1152-vakta (kravet slik det var da kurset ble
 *     arkivert, med seksjoner arkivert sammen med kurset) og rapportens «har lest i kurset».
 */
export type SectionItemList = "participant" | "all";

/** Seksjonene i flere kurs på én gang, fra den valgte lista. Bare id-er: ingenting her går til en deltaker. */
export async function findSectionItemsForCourses(
  client: Pick<CourseRepositoryClient, "courseItem">,
  courseIds: string[],
  list: SectionItemList,
): Promise<Array<{ courseId: string; sectionId: string }>> {
  if (courseIds.length === 0) return [];
  const rows = await client.courseItem.findMany({
    where: {
      courseId: { in: courseIds },
      itemType: "SECTION",
      sectionId: { not: null },
      // #958/#992: samme filter som `findCourseItemsForParticipant`, fra samme konstant.
      ...(list === "participant" ? { section: sectionAvailableWhere } : {}),
    },
    select: { courseId: true, sectionId: true },
  });
  return rows.flatMap((row) => (row.sectionId ? [{ courseId: row.courseId, sectionId: row.sectionId }] : []));
}

/**
 * Modulene i flere kurs på én gang, også arkiverte moduler: bare id-er, ingen tilgjengelighetsregel, og ingenting av det går til en
 * deltaker. For «påbegynt» (`learnerVisibility.ts`, `enrollmentService.ts`): svaret brukes bare til å spørre om deltakeren har
 * levert noe. #1156: frittstående, så den kan leses på transaksjonens klient.
 */
export function findModuleItemsForCourses(client: Pick<CourseRepositoryClient, "courseItem">, courseIds: string[]) {
  if (courseIds.length === 0) return Promise.resolve([] as Array<{ courseId: string; moduleId: string | null }>);
  return client.courseItem.findMany({
    where: { courseId: { in: courseIds }, itemType: "MODULE", moduleId: { not: null } },
    select: { courseId: true, moduleId: true },
  });
}

// #934 skive 4b: modulene i kurset som har en aktiv versjon — de deltakeren kan ta nå.
async function findLiveModuleIds(client: Pick<CourseRepositoryClient, "courseItem">, courseId: string): Promise<string[]> {
  const items = await client.courseItem.findMany({
    where: { courseId, itemType: "MODULE", module: { activeVersionId: { not: null } } },
    select: { moduleId: true },
  });
  return items.flatMap((item) => (item.moduleId ? [item.moduleId] : []));
}

export function createCourseRepository(client: CourseRepositoryClient = prisma) {
  return {
    async findPublishedCoursesContainingModule(moduleId: string) {
      const courses = await client.course.findMany({
        where: {
          publishedAt: { not: null },
          archivedAt: null,
          items: { some: { moduleId } },
        },
        include: {
          items: {
            where: { itemType: "MODULE" },
            orderBy: { sortOrder: "asc" },
            // #945: `module.archivedAt` er med fordi bevisporten filtrerer arkiverte moduler bort.
            // Uten det ville filteret virket på den ene veien inn (findCourseById) og ikke på de to
            // andre — samme «to steder svarer ulikt» som saken handler om.
            select: { moduleId: true, module: { select: { archivedAt: true } } },
          },
        },
      });
      return courses.map(({ items, ...rest }) => ({
        ...rest,
        modules: items.filter((i) => i.moduleId).map((i) => ({ moduleId: i.moduleId as string, module: i.module })),
      }));
    },

    // #934 skive 5a-3: den ene veien til fremdrift i kurs (`moduleCredit.ts`), på denne klienten. Bryteren og beståttene leses
    // altså i den transaksjonen kalleren eventuelt står i. Ingen andre metoder her svarer på «har deltakeren bestått».
    findModuleProgress(input: ModuleProgressInput) {
      return findModuleProgress(client, input);
    },

    // #934: et kursbevis gjelder sin hovedversjon. «Har deltakeren bevis?» spørres derfor alltid for
    // én hovedversjon — kursets nåværende, når det er utstedelsen som spør.
    findCourseCompletion(userId: string, courseId: string, versionMajor: number) {
      return client.courseCompletion.findUnique({
        where: { userId_courseId_versionMajor: { userId, courseId, versionMajor } },
      });
    },

    // #933: seksjonene lagres nå ved siden av modulene. Produkteiers regel er «alle moduler kurset
    // inneholdt DA, samt bekreftet lest alle seksjoner kurset inneholdt på det tidspunkt» — uten
    // seksjonene var halve regelen uetterprøvbar, og et bevis kunne ikke vise hva det dekket.
    // #934 skive 5a-1: `locked` holder innholdslåsen delt og deltakerlåsen. Beviset skrives altså i samme låste
    // transaksjon som kravet ble målt i. Uten den merkede klienten kompilerer ikke kallet.
    createCourseCompletion(
      locked: LearnerContentTx,
      userId: string,
      courseId: string,
      version: { major: number; minor: number },
      moduleSnapshotJson: string,
      sectionSnapshotJson?: string,
    ) {
      return locked.courseCompletion.create({
        data: { userId, courseId, versionMajor: version.major, versionMinor: version.minor, moduleSnapshotJson, sectionSnapshotJson },
      });
    },

    // #1145: et kurs tatt utenfor plattformen, registrert av administrator (doc/design/PLAN_1145.md). Ingen moduler eller
    // seksjoner ble målt: begge snapshotene er `"[]"` — IKKE `null`, som betyr «utstedt før 2.23.0» (contentLifecycle.ts).
    createExternalCourseCompletion(
      locked: LearnerContentTx,
      input: { userId: string; courseId: string; version: { major: number; minor: number }; registeredById: string; externalReference: string },
    ) {
      return locked.courseCompletion.create({
        data: {
          userId: input.userId,
          courseId: input.courseId,
          versionMajor: input.version.major,
          versionMinor: input.version.minor,
          moduleSnapshotJson: "[]",
          sectionSnapshotJson: "[]",
          source: "external",
          registeredById: input.registeredById,
          externalReference: input.externalReference,
        },
      });
    },

    // #1145: deltakeren oppfylte kravet på plattformen etter at et `external`-bevis for samme hovedversjon var registrert. Beviset
    // blir et vanlig bevis med målt dato og snapshot; `certificateId` beholdes, så lenker virker. Bare en rad som FORTSATT er
    // `external` oppdateres (to samtidige oppgraderinger: den andre treffer ingenting). `registeredById` står igjen for sporbarhet.
    upgradeExternalCourseCompletion(
      locked: LearnerContentTx,
      input: { completionId: string; version: { major: number; minor: number }; moduleSnapshotJson: string; sectionSnapshotJson: string },
    ) {
      return locked.courseCompletion.updateMany({
        where: { id: input.completionId, source: "external" },
        data: {
          source: "platform",
          completedAt: new Date(),
          versionMinor: input.version.minor,
          moduleSnapshotJson: input.moduleSnapshotJson,
          sectionSnapshotJson: input.sectionSnapshotJson,
        },
      });
    },

    async listCourses() {
      // #502: tell MODULE-elementer fra CourseItem i stedet for CourseModule; behold _count.modules-shapen.
      const courses = await client.course.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { items: { where: { itemType: "MODULE" } } } } },
      });
      return courses.map(({ _count, ...rest }) => ({ ...rest, _count: { modules: _count.items } }));
    },

    // #934 skive 3: en lesing som ikke teller for kursets nåværende hovedversjon (seksjonen er endret
    // siden forrige), får nytt tidspunkt når deltakeren leser den på nytt — ellers kunne den aldri telle.
    // En lesing som teller, står urørt: tidspunktet er når hen leste, og aktivitetsrapporten bygger på det.
    // #934 skive 4a: `locked` er transaksjonen som holder innholdslåsen DELT, og det er den lesingen skrives på. Den
    // venter på en åpen versjonsendring, så tidspunktet aldri havner på feil side av grensen `publishedAt`. Skive 5a-1:
    // den holder også deltakerlåsen. Uten den merkede klienten kompilerer ikke kallet.
    //
    // #1156: lesingen teller i alle kurs med seksjonen (sectionReadCredit.ts), så regelen sjekkes for ALLE kurs som har den og
    // ikke er arkivert. Teller den ikke i ett av dem, får den nytt tidspunkt: ellers kunne en ny lesing i A, etter en ny
    // hovedversjon i B, latt B vise seksjonen som ulest. `changed` er sann når raden er ny eller fikk nytt tidspunkt; da skal
    // kursbevisene i de andre kursene sjekkes (utboksen, `recordSectionRead`).
    async markSectionRead(locked: LearnerContentTx, userId: string, courseId: string, sectionId: string) {
      const existing = await locked.courseSectionRead.findUnique({
        where: { userId_courseId_sectionId: { userId, courseId, sectionId } },
      });
      const read = existing ?? (await locked.courseSectionRead.create({ data: { userId, courseId, sectionId } }));
      const courses = await locked.courseItem.findMany({
        where: { sectionId, itemType: "SECTION", course: { archivedAt: null } },
        select: { courseId: true },
      });
      const courseIds = [...new Set([courseId, ...courses.map((row) => row.courseId)])];
      const rules = await loadSectionReadRules(locked, courseIds);
      if (courseIds.every((id) => readCountsForCurrentVersion(rules.get(id), sectionId, read.readAt))) {
        return { read, changed: existing === null };
      }
      const refreshed = await locked.courseSectionRead.update({ where: { id: read.id }, data: { readAt: new Date() } });
      return { read: refreshed, changed: true };
    },

    // #799: batch variants of the per-course reads above, so the participant course listing does a fixed
    // number of queries instead of ~4 per visible course. Each returns rows the caller groups in memory.
    // #934 skive 3: dem en ny hovedversjon gjelder — kursbevis for kursets nåværende hovedversjon.
    countCertificateHolders(courseId: string, versionMajor: number) {
      return countCertificateHolders(client, courseId, versionMajor);
    },

    // SECTION course-item ids for many courses at once (one query), for the listing's section counts.
    // #944/#938: lista teller de seksjonene deltakeren FAKTISK KAN LESE — samme regel som bevisporten og kursdetaljen. Sto
    // tidligere uten filter, og var derfor den tredje telleren som svarte noe annet enn de to andre: et kort kunne vise
    // «Seksjonar 0/1» ved siden av et utstedt kursbevis. #1156: samme spørring som lesingene telles mot (`participant`).
    findCourseItemSectionIdsForCourses(courseIds: string[]) {
      return findSectionItemsForCourses(client, courseIds, "participant");
    },

    /**
     * #1156: de publiserte kursene som ikke er arkivert og som har seksjonen. Omvendt oppslag (seksjon → kurs) for utboksens
     * kursbevis etter en lesing (`checkAndIssueCourseCompletionsForSection`). Lista er et forslag: utstedelsen måler alt på nytt.
     */
    async findPublishedCoursesContainingSection(sectionId: string) {
      const rows = await client.courseItem.findMany({
        where: { sectionId, itemType: "SECTION", course: { publishedAt: { not: null }, archivedAt: null } },
        select: { course: { select: { id: true, enrollmentPolicy: true } } },
      });
      return [...new Map(rows.map((row) => [row.course.id, row.course])).values()];
    },

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // #958: TO navngitte dører inn til et kurs' elementer — «det deltakeren kan bruke» og «alt».
    //
    // ⚠️ Hvorfor det ikke lenger finnes én `findCourseItems`.
    //
    // Den hentet `archivedAt`, `activeVersionId` og `activeVersion.publishedAt` — nøyaktig feltene
    // som avgjør tilgjengelighet — og filtrerte INGENTING. Åtte kallere tok hver sin avgjørelse, med
    // fem ulike regler, og samme rad ga «tilgjengelig», «påkrevd», «publiserbar» og «slettbar» ulike
    // svar. Det er roten til #938, #944, #945 og #992.
    //
    // Kuren er ikke et filter til: det er at kalleren ikke lenger KAN unnlate å ta stilling. Man
    // velger dør i det man kaller, og deltakerdøra leverer ikke feltene regelen bygger på — så en
    // niende variant av regelen kan ikke skrives der uten å hente dataene på nytt, synlig.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * Kursets elementer slik de gjelder for en DELTAKER.
     *
     * - Seksjoner deltakeren ikke kan åpne er **utelatt**, ikke merket. Begge deltakerrutene
     *   (`GET`/`POST .../sections/:id`) svarer allerede 404 på dem, bevisporten krever dem ikke, og
     *   framdriften teller dem ikke — en rad i sekvensen som ingen av delene støtter er en blindvei.
     *   #992 viste at klienten dessuten ignorerer `available` på seksjoner (`isSection || …`), så
     *   flagget beskyttet ingen: raden så klikkbar ut og endte i 404.
     * - Moduler er ALLE med, hver med et ferdig avgjort `available`. En avpublisert modul er en
     *   midlertidig tilstand deltakeren skal se at finnes (`FEATURE_SURFACE_MAP` §6b-2), klienten
     *   rendrer den som deaktivert, og den teller fortsatt i `moduleTotal`. Å skjule den ville
     *   endret hva kursbeviset krever — en policy-endring, ikke en opprydding.
     *
     * Returtypen bærer med vilje verken `archivedAt`, `activeVersionId` eller `publishedAt`.
     */
    findCourseItemsForParticipant(courseId: string) {
      return client.courseItem
        .findMany({
          where: {
            courseId,
            OR: [
              { itemType: "MODULE" },
              // Filtreres i databasen, ikke i minnet: kalleren får aldri radene den ikke skal bruke.
              { itemType: "SECTION", section: sectionAvailableWhere },
            ],
          },
          orderBy: { sortOrder: "asc" },
          include: {
            module: {
              select: {
                id: true,
                title: true,
                archivedAt: true,
                activeVersionId: true,
                activeVersion: { select: { publishedAt: true } },
              },
            },
            section: { select: { id: true, title: true } },
          },
        })
        .then((items) =>
          items.map((item) => ({
            id: item.id,
            courseId: item.courseId,
            itemType: item.itemType,
            sortOrder: item.sortOrder,
            moduleId: item.moduleId,
            sectionId: item.sectionId,
            discussionsEnabled: item.discussionsEnabled,
            // #502-followup, flyttet hit fra `courses.ts`: en modul er tilgjengelig når den har en
            // PUBLISERT aktiv versjon og ikke er arkivert. Seksjonene som kom gjennom `where`-en
            // over er tilgjengelige ved konstruksjon — derfor `true`, ikke en ny utregning.
            available:
              item.itemType === "SECTION"
                ? true
                : Boolean(item.module?.activeVersionId && item.module.activeVersion?.publishedAt && !item.module.archivedAt),
            // ⚠️ «Tilgjengelig» og «påkrevd» er IKKE det samme for moduler, og å blande dem er en
            // blindvei.
            //
            // Bevisporten (`courseCompletionService`) filtrerer bare på `archivedAt`. En AVPUBLISERT
            // modul er altså fortsatt PÅKREVD — den er bare ikke åpnbar akkurat nå. En ARKIVERT
            // modul er tatt ut av sirkulasjon og kreves ikke.
            //
            // QA-porten fant at klienten utledet «ikke påkrevd» fra `available: false` og dermed
            // tilbød «Avslutt kurset» i et kurs serveren ikke ville utstedt bevis for: klikket
            // registrerte lesningen, og ingenting skjedde. Nøyaktig #929 om igjen.
            //
            // Kuren er at DØRA svarer på begge spørsmålene, fra samme regel porten bruker — ikke at
            // klienten gjetter det ene ut fra det andre. Seksjoner som er med er påkrevd ved
            // konstruksjon; de utilgjengelige er allerede filtrert bort.
            required: item.itemType === "SECTION" ? true : item.module?.archivedAt == null,
            module: item.module ? { id: item.module.id, title: item.module.title } : null,
            section: item.section,
          })),
        );
    },

    /**
     * Alle elementer, ufiltrert — forfatterflater, publiseringsgaten, kaskadesletting og eksport.
     *
     * Disse skal nettopp SE det arkiverte og upubliserte: en publiseringsgate som ikke fikk se det
     * upubliserte hadde ingenting å rapportere, og en sletting som ikke fikk se det arkiverte ville
     * etterlatt foreldreløse rader.
     *
     * `activeVersionId`/`activeVersion.publishedAt` er TATT UT: ingen av de fire kallerne leste dem,
     * og de er byggeklossene i deltakerregelen. Publiseringsgaten henter selv sin egen «er dette
     * publisert»-tilstand (`evaluateModule`/`evaluateSection`) sammen med versjonsradene den uansett
     * trenger — den regelen er en annen enn deltakerens, og skal ikke kunne forveksles med den.
     * `archivedAt` blir stående fordi `GET /admin/content/courses/:id/items` sender det videre.
     */
    findAllCourseItems(courseId: string) {
      return client.courseItem.findMany({
        where: { courseId },
        orderBy: { sortOrder: "asc" },
        include: {
          // #1150 skive 2a-2: merkene fra kursarkiveringen, for gjenopprettingen av kurset (`analyzeCourseRestore`).
          module: { select: { id: true, title: true, archivedAt: true, archivedWithCourseId: true, activeVersionIdBeforeArchive: true } },
          section: { select: { id: true, title: true, archivedAt: true, archivedWithCourseId: true, activeVersionIdBeforeArchive: true } },
        },
      });
    },

    /**
     * Modulene i flere kurs på én gang, også arkiverte moduler. For «påbegynt» i arkiverte klasser (`classService.ts`).
     * Samme slag som `findCourseItemSectionIdsForCourses`: bare id-er, ingen tilgjengelighetsregel, og ingenting av det går til
     * en deltaker. Svaret brukes bare til å spørre om deltakeren har levert noe. Kursets innhold leses fortsatt gjennom de to
     * dørene (`test/course-items-accessor-guard.test.js`).
     */
    findModuleItemsForCourses(courseIds: string[]) {
      return findModuleItemsForCourses(client, courseIds);
    },

    // #934 skive 3: se `findSectionVersions` over.
    findSectionVersions(courseId: string): Promise<Record<string, string | null>> {
      return findSectionVersions(client, courseId);
    },

    // #934 skive 4b: øyeblikksbildet før en endring som kan gi ny versjon — seksjonsversjonene og modulene som er
    // levende i kurset — og hvordan de leses etterpå. `applyCourseVersionChange` bruker det til regelen for seksjoner
    // og til tallet i e-posten (`changedItemCount`). Tas i samme transaksjon, før noe skrives.
    async snapshotContent(courseId: string): Promise<SectionSnapshot> {
      return {
        before: await findSectionVersions(client, courseId),
        after: () => findSectionVersions(client, courseId),
        modulesBefore: await findLiveModuleIds(client, courseId),
        modulesAfter: () => findLiveModuleIds(client, courseId),
      };
    },

    // #502 contract-fase: `modules` deriveres nå fra CourseItem (MODULE-elementer) i stedet for den
    // gamle CourseModule-join-en, så CourseItem er eneste sannhetskilde. Retur-shapen beholdes
    // ({ moduleId, sortOrder, module }) så konsumentene er uendret.
    async findCourseById(courseId: string) {
      const course = await client.course.findUnique({
        where: { id: courseId },
        include: {
          items: {
            where: { itemType: "MODULE" },
            orderBy: { sortOrder: "asc" },
            include: {
              module: {
                select: { id: true, title: true, certificationLevel: true, archivedAt: true },
              },
            },
          },
        },
      });
      if (!course) return null;
      const { items, ...rest } = course;
      const modules = items
        .filter((item) => item.moduleId && item.module)
        .map((item) => ({ moduleId: item.moduleId as string, sortOrder: item.sortOrder, module: item.module! }));
      return { ...rest, modules };
    },

    async findPublishedCourses() {
      const courses = await client.course.findMany({
        where: { publishedAt: { not: null }, archivedAt: null },
        orderBy: { publishedAt: "asc" },
        include: {
          items: {
            where: { itemType: "MODULE" },
            orderBy: { sortOrder: "asc" },
            // #945: `module.archivedAt` er med fordi bevisporten filtrerer arkiverte moduler bort.
            // Uten det ville filteret virket på den ene veien inn (findCourseById) og ikke på de to
            // andre — samme «to steder svarer ulikt» som saken handler om.
            select: { moduleId: true, module: { select: { archivedAt: true } } },
          },
        },
      });
      return courses.map(({ items, ...rest }) => ({
        ...rest,
        modules: items
          .filter((item) => item.moduleId)
          .map((item) => ({ moduleId: item.moduleId as string, module: item.module })),
      }));
    },

    async findPublishedCoursesWithModuleDetails(filters: { courseIds?: string[] } = {}) {
      const courses = await client.course.findMany({
        where: {
          publishedAt: { not: null },
          archivedAt: null,
          // #1058: kallerens kurs (valgt kurs ∩ tillatte kurs); undefined = alle.
          ...(filters.courseIds ? { id: { in: filters.courseIds } } : {}),
        },
        orderBy: { publishedAt: "asc" },
        include: {
          items: {
            where: { itemType: "MODULE" },
            orderBy: { sortOrder: "asc" },
            // #966: `archivedAt` hentes nå, fordi rapporten må kunne stille SAMME krav som
            // bevisporten. Uten feltet kunne den ikke filtrere arkiverte moduler, og en arkivert
            // modul i et publisert kurs gjorde kravet uoppfyllelig — nøyaktig feilen #945
            // rettet i porten, som sto igjen her.
            include: { module: { select: { id: true, title: true, archivedAt: true } } },
          },
        },
      });
      return courses.map(({ items, ...rest }) => ({
        ...rest,
        modules: items
          .filter((item) => item.moduleId && item.module)
          .map((item) => ({ moduleId: item.moduleId as string, sortOrder: item.sortOrder, module: item.module! })),
      }));
    },

    // #1156: lesingene (hvem har lest, hvilke seksjoner som teller) leses ikke her lenger, men i sectionReadCredit.ts, på tvers
    // av kurs. `test/section-read-reader-guard.test.js` nekter nye lesere av tabellen.

    findUserCourseCompletions(userId: string) {
      return client.courseCompletion.findMany({
        where: { userId },
        include: {
          course: {
            select: { id: true, title: true, certificationLevel: true, versionMajor: true },
          },
        },
        orderBy: { completedAt: "desc" },
      });
    },

    // #550: single completion by certificate ID, including course + participant name, for the
    // printable certificate view. certificateId is unique. Caller must scope to the owner.
    findCourseCompletionByCertificateId(certificateId: string) {
      return client.courseCompletion.findUnique({
        where: { certificateId },
        include: {
          course: { select: { id: true, title: true, certificationLevel: true, versionMajor: true } },
          user: { select: { id: true, name: true } },
        },
      });
    },

    countCourseCompletions(courseId: string, filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {}) {
      return client.courseCompletion.count({
        where: {
          courseId,
          ...buildCompletionWhere(filters),
        },
      });
    },

    countUsersWithSubmissionsForModule(
      moduleId: string,
      filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {},
    ) {
      return client.submission.groupBy({
        by: ["userId"],
        where: {
          moduleId,
          ...buildSubmissionWhere(filters),
        },
      }).then((rows) => rows.length);
    },

    findLearnerSubmissionsForModules(
      moduleIds: string[],
      filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {},
    ) {
      if (moduleIds.length === 0) {
        return Promise.resolve([]);
      }
      return client.submission.findMany({
        where: {
          moduleId: { in: moduleIds },
          ...buildSubmissionWhere(filters),
        },
        orderBy: [{ userId: "asc" }, { moduleId: "asc" }, { submittedAt: "desc" }],
        select: {
          userId: true,
          moduleId: true,
          submittedAt: true,
          submissionStatus: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              department: true,
            },
          },
          decisions: {
            orderBy: { finalisedAt: "desc" },
            take: 1,
            select: {
              totalScore: true,
              passFailTotal: true,
              finalisedAt: true,
            },
          },
        },
      });
    },

    findCourseCompletionsForLearnerReport(
      courseId: string,
      filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {},
    ) {
      return client.courseCompletion.findMany({
        where: {
          courseId,
          ...buildCompletionWhere(filters),
        },
        orderBy: [{ userId: "asc" }, { completedAt: "desc" }],
        select: {
          userId: true,
          completedAt: true,
          certificateId: true,
          // #934: rapporten skiller bevis for kursets nåværende hovedversjon fra eldre.
          versionMajor: true,
          // #1145: et registrert bevis (tatt utenfor plattformen) har ingen dato og er ingen aktivitet.
          source: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              department: true,
            },
          },
        },
      });
    },
  };
}

export const courseRepository = createCourseRepository();
