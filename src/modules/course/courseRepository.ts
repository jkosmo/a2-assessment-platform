import { prisma } from "../../db/prisma.js";
import type { ReportFilters } from "../reporting/types.js";
import { CERTIFICATION_PASSED_STATUSES } from "../certification/certificationRepository.js";
import { sectionAvailableWhere } from "./sectionAvailability.js";

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
          completedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
  };
}

function buildCertificationWhere(filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {}) {
  return {
    ...(filters.dateFrom || filters.dateTo
      ? {
          passedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
  };
}

type CourseRepositoryClient = Pick<
  typeof prisma,
  "course" | "courseItem" | "courseCompletion" | "courseSectionRead" | "certificationStatus" | "submission"
>;

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

    countPassedModulesForUser(userId: string, moduleIds: string[]) {
      return client.certificationStatus.count({
        where: {
          userId,
          moduleId: { in: moduleIds },
          status: { in: CERTIFICATION_PASSED_STATUSES },
        },
      });
    },

    findUserCertificationStatusesForModules(userId: string, moduleIds: string[]) {
      return client.certificationStatus.findMany({
        where: {
          userId,
          moduleId: { in: moduleIds },
        },
        select: { moduleId: true, status: true },
      });
    },

    findCourseCompletion(userId: string, courseId: string) {
      return client.courseCompletion.findUnique({
        where: { userId_courseId: { userId, courseId } },
      });
    },

    // #933: seksjonene lagres nå ved siden av modulene. Produkteiers regel er «alle moduler kurset
    // inneholdt DA, samt bekreftet lest alle seksjoner kurset inneholdt på det tidspunkt» — uten
    // seksjonene var halve regelen uetterprøvbar, og et bevis kunne ikke vise hva det dekket.
    createCourseCompletion(
      userId: string,
      courseId: string,
      moduleSnapshotJson: string,
      sectionSnapshotJson?: string,
    ) {
      return client.courseCompletion.create({
        data: { userId, courseId, moduleSnapshotJson, sectionSnapshotJson },
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

    markSectionRead(userId: string, courseId: string, sectionId: string) {
      return client.courseSectionRead.upsert({
        where: { userId_courseId_sectionId: { userId, courseId, sectionId } },
        update: {},
        create: { userId, courseId, sectionId },
      });
    },

    findReadSectionIds(userId: string, courseId: string) {
      return client.courseSectionRead
        .findMany({ where: { userId, courseId }, select: { sectionId: true } })
        .then((rows) => rows.map((r) => r.sectionId));
    },

    // #799: batch variants of the per-course reads above, so the participant course listing does a fixed
    // number of queries instead of ~4 per visible course. Each returns rows the caller groups in memory.
    findReadSectionIdsForCourses(userId: string, courseIds: string[]) {
      if (courseIds.length === 0) return Promise.resolve([] as Array<{ courseId: string; sectionId: string }>);
      return client.courseSectionRead.findMany({
        where: { userId, courseId: { in: courseIds } },
        select: { courseId: true, sectionId: true },
      });
    },

    // The set of the user's PASSED module ids among the given modules (one query across every course's
    // modules). The caller counts per course by intersecting with each course's module ids.
    findPassedModuleIds(userId: string, moduleIds: string[]) {
      if (moduleIds.length === 0) return Promise.resolve([] as string[]);
      return client.certificationStatus
        .findMany({
          where: { userId, moduleId: { in: moduleIds }, status: { in: CERTIFICATION_PASSED_STATUSES } },
          select: { moduleId: true },
        })
        .then((rows) => rows.map((r) => r.moduleId));
    },

    // SECTION course-item ids for many courses at once (one query), for the listing's section counts.
    findCourseItemSectionIdsForCourses(courseIds: string[]) {
      if (courseIds.length === 0) return Promise.resolve([] as Array<{ courseId: string; sectionId: string }>);
      return client.courseItem
        // #944/#938: lista teller de seksjonene deltakeren FAKTISK KAN LESE — samme regel som
        // bevisporten og kursdetaljen. Sto tidligere uten filter, og var derfor den tredje telleren
        // som svarte noe annet enn de to andre: et kort kunne vise «Seksjonar 0/1» ved siden av et
        // utstedt kursbevis. Filtreres i spørringen, ikke i minnet, så batchen fortsatt er én runde.
        .findMany({
          where: {
            courseId: { in: courseIds },
            itemType: "SECTION",
            sectionId: { not: null },
            // #958/#992: samme filter som `findCourseItemsForParticipant`, fra samme konstant. Sto
            // tidligere som en egen literal her — den andre formuleringen av setningen.
            section: sectionAvailableWhere,
          },
          select: { courseId: true, sectionId: true },
        })
        .then((rows) =>
          rows
            .filter((r): r is { courseId: string; sectionId: string } => Boolean(r.sectionId))
            .map((r) => ({ courseId: r.courseId, sectionId: r.sectionId })),
        );
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
          module: { select: { id: true, title: true, archivedAt: true } },
          section: { select: { id: true, title: true, archivedAt: true } },
        },
      });
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

    async findPublishedCoursesWithModuleDetails(filters: Pick<ReportFilters, "courseId"> = {}) {
      const courses = await client.course.findMany({
        where: {
          publishedAt: { not: null },
          archivedAt: null,
          ...(filters.courseId ? { id: filters.courseId } : {}),
        },
        orderBy: { publishedAt: "asc" },
        include: {
          items: {
            where: { itemType: "MODULE" },
            orderBy: { sortOrder: "asc" },
            include: { module: { select: { id: true, title: true } } },
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

    findUserCourseCompletions(userId: string) {
      return client.courseCompletion.findMany({
        where: { userId },
        include: {
          course: {
            select: { id: true, title: true, certificationLevel: true },
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
          course: { select: { id: true, title: true, certificationLevel: true } },
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

    countDistinctEnrolledUsersForModules(
      moduleIds: string[],
      filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {},
    ) {
      if (moduleIds.length === 0) return Promise.resolve(0);
      return client.submission.groupBy({
        by: ["userId"],
        where: {
          moduleId: { in: moduleIds },
          ...buildSubmissionWhere(filters),
        },
      }).then((rows) => rows.length);
    },

    countPassedUsersForModule(moduleId: string, filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {}) {
      return client.certificationStatus.count({
        where: {
          moduleId,
          status: { in: CERTIFICATION_PASSED_STATUSES },
          ...buildCertificationWhere(filters),
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
