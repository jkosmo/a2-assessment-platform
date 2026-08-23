import { Router } from "express";
import { courseRepository, computeCourseStatus, getSection, checkCourseCompletionForCourse, reconcileCourseCompletionsForUser } from "../modules/course/index.js";
import { renderSectionMarkdown } from "../modules/course/sectionContent.js";
import { localizeContentText } from "../i18n/content.js";
import { normalizeLocale } from "../i18n/locale.js";
import { NotFoundError } from "../errors/AppError.js";
import {
  listUserEnrollments,
  selfEnroll,
  filterVisibleCourseIds,
  isCourseVisibleToUser,
  getUserClassIds,
  getClassAssignedCourseDueDates,
  deriveStatus,
} from "../modules/course/index.js";
import type { CourseListItem, CourseDetail, CourseSequenceItem } from "../modules/course/index.js";
import { queryLatestSubmissionsForModules } from "../modules/submission/submissionRepository.js";
import { isCertificationPassed } from "../modules/certification/certificationRepository.js";
import { hasCertificateBackground } from "../modules/platformConfig/certificateBackgroundService.js";
import { discussionsRouter } from "./discussions.js";

const coursesRouter = Router();

// #495/T-QA-2: diskusjon/Q&A under kurs-stien så authz arver «har tilgang til publisert kurs».
// mergeParams lar sub-routeren lese :courseId. Registreres tidlig; de spesifikke metodene/stiene
// kolliderer ikke med "/:courseId"-GET fordi de ligger under "/:courseId/discussions".
coursesRouter.use("/:courseId/discussions", discussionsRouter);

coursesRouter.get("/", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const locale = normalizeLocale(request.context?.locale) ?? "en-GB";

  try {
    const allCourses = await courseRepository.findPublishedCourses();
    // #496/EN-2 + #645/CL-2: RESTRICTED courses are visible to users with an individual enrolment OR
    // a class assignment (member of a class the course is assigned to); OPEN courses to everyone.
    const classIds = await getUserClassIds({
      userId,
      roles: request.context?.roles ?? [],
      groupIds: request.context?.principal?.groupIds,
    });
    const classCourseDue = await getClassAssignedCourseDueDates(classIds);
    const visibleIds = await filterVisibleCourseIds(userId, allCourses, new Set(classCourseDue.keys()));
    const courses = allCourses.filter((course) => visibleIds.has(course.id));

    // #799: batch every per-course read across ALL visible courses (a fixed number of queries) instead of
    // ~4 queries per course, then derive each course's progress in memory. Behaviour-preserving — the same
    // counts as the previous per-course version, just fetched together.
    const courseIds = courses.map((course) => course.id);
    const allModuleIds = courses.flatMap((course) => course.modules.map((m) => m.moduleId));

    const [sectionRows, passedModuleIds, readRows, latestSubmissions] = await Promise.all([
      courseRepository.findCourseItemSectionIdsForCourses(courseIds),
      courseRepository.findPassedModuleIds(userId, allModuleIds),
      courseRepository.findReadSectionIdsForCourses(userId, courseIds),
      allModuleIds.length > 0 ? queryLatestSubmissionsForModules(userId, allModuleIds) : Promise.resolve([]),
    ]);

    const sectionIdsByCourse = new Map<string, string[]>();
    for (const row of sectionRows) {
      const list = sectionIdsByCourse.get(row.courseId);
      if (list) list.push(row.sectionId);
      else sectionIdsByCourse.set(row.courseId, [row.sectionId]);
    }
    const passedModuleSet = new Set(passedModuleIds);
    const readSectionsByCourse = new Map<string, Set<string>>();
    for (const row of readRows) {
      const set = readSectionsByCourse.get(row.courseId);
      if (set) set.add(row.sectionId);
      else readSectionsByCourse.set(row.courseId, new Set([row.sectionId]));
    }
    const startedModuleIds = new Set(latestSubmissions.map((s) => s.moduleId));

    const items: CourseListItem[] = courses.map((course) => {
      // #938/#945: samme filter som kursdetaljen og bevisporten — den tredje telleren.
      const moduleIds = course.modules.filter((m) => m.module?.archivedAt == null).map((m) => m.moduleId);
      const sectionIds = sectionIdsByCourse.get(course.id) ?? [];
      const passed = moduleIds.filter((id) => passedModuleSet.has(id)).length;
      const readSet = readSectionsByCourse.get(course.id);
      const readCount = readSet ? sectionIds.filter((id) => readSet.has(id)).length : 0;
      const total = moduleIds.length + sectionIds.length;
      const completed = passed + readCount;
      const hasStarted = moduleIds.some((id) => startedModuleIds.has(id)) || readCount > 0;

      return {
        id: course.id,
        title: localizeContentText(locale, course.title) ?? course.title,
        description: localizeContentText(locale, course.description) ?? course.description,
        moduleCount: moduleIds.length,
        progress: {
          completed,
          total,
          courseStatus: computeCourseStatus(completed, total, hasStarted),
          moduleCompleted: passed,
          moduleTotal: moduleIds.length,
          sectionCompleted: readCount,
          sectionTotal: sectionIds.length,
        },
      };
    });

    response.json({ courses: items });
  } catch (error) {
    next(error);
  }
});

// #496/EN-2: a participant's own active enrolments (assigned courses) with due date + derived
// status. Registered before "/:courseId" so the literal path is not captured as a course id.
coursesRouter.get("/enrollments", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const now = new Date();
    const individual = await listUserEnrollments(userId, now);
    const seen = new Set(individual.map((e) => e.courseId));

    // #645/CL-2: also surface courses assigned via a class the user belongs to (dynamic, not stored).
    // Individual enrolments win on overlap (they carry the explicit assignedAt/source).
    const classIds = await getUserClassIds({
      userId,
      roles: request.context?.roles ?? [],
      groupIds: request.context?.principal?.groupIds,
    });
    const classCourseDue = await getClassAssignedCourseDueDates(classIds);
    const classEntries = await Promise.all(
      [...classCourseDue.entries()]
        .filter(([courseId]) => !seen.has(courseId))
        .map(async ([courseId, dueAt]) => ({
          courseId,
          source: "CLASS" as const,
          dueAt: dueAt ? dueAt.toISOString() : null,
          assignedAt: null,
          status: await deriveStatus(userId, courseId, dueAt, now),
        })),
    );

    response.json({ enrollments: [...individual, ...classEntries] });
  } catch (error) {
    next(error);
  }
});

coursesRouter.get("/completions", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const locale = normalizeLocale(request.context?.locale) ?? "en-GB";

  try {
    // #580 follow-up: backfill any completion whose gates are met but whose certificate was never
    // issued (event-driven issuance can miss). Idempotent — only creates genuinely-missing ones.
    await reconcileCourseCompletionsForUser(userId);
    const completions = await courseRepository.findUserCourseCompletions(userId);
    const items = completions.map((cc) => ({
      courseId: cc.courseId,
      certificateId: cc.certificateId,
      completedAt: cc.completedAt.toISOString(),
      courseTitle: localizeContentText(locale, cc.course.title) ?? cc.course.title,
      certificationLevel: cc.course.certificationLevel,
    }));
    response.json({ completions: items });
  } catch (error) {
    next(error);
  }
});

// #550: single completion by certificate ID, for the printable certificate view. Owner-scoped —
// returns 404 (not 403) for someone else's certificate so existence isn't leaked.
coursesRouter.get("/completions/:certificateId", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const locale = normalizeLocale(request.context?.locale) ?? "en-GB";

  try {
    const completion = await courseRepository.findCourseCompletionByCertificateId(
      request.params.certificateId,
    );
    if (!completion || completion.userId !== userId) {
      response.status(404).json({ error: "not_found" });
      return;
    }

    let moduleCount = 0;
    try {
      const snapshot = JSON.parse(completion.moduleSnapshotJson);
      moduleCount = Array.isArray(snapshot) ? snapshot.length : 0;
    } catch {
      moduleCount = 0;
    }

    response.json({
      certificateId: completion.certificateId,
      courseId: completion.courseId,
      courseTitle: localizeContentText(locale, completion.course.title) ?? completion.course.title,
      certificationLevel: completion.course.certificationLevel,
      completedAt: completion.completedAt.toISOString(),
      participantName: completion.user.name,
      moduleCount,
      // #580: URL of the platform-wide diploma background, or null when none is configured.
      // Served unauthenticated (branding image) so <img>/CSS background can load it without headers.
      certificateBackgroundUrl: (await hasCertificateBackground()) ? "/certificate-background" : null,
    });
  } catch (error) {
    next(error);
  }
});

coursesRouter.get("/:courseId", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const locale = normalizeLocale(request.context?.locale) ?? "en-GB";

  try {
    const course = await courseRepository.findCourseById(request.params.courseId);
    if (!course || !course.publishedAt || course.archivedAt) {
      throw new NotFoundError("Course", "course_not_found", "Course not found.");
    }
    // #778/#785: RESTRICTED courses are visible only to enrolled/class-assigned users. Gate the direct
    // detail endpoint the same way the list endpoint does; 404 (not 403) so we don't confirm existence.
    if (!(await isCourseVisibleToUser({ course, userId, roles: request.context?.roles ?? [], groupIds: request.context?.principal?.groupIds }))) {
      throw new NotFoundError("Course", "course_not_found", "Course not found.");
    }

    // #938/#945: arkiverte moduler telles IKKE, fordi bevisporten ikke krever dem. Målt mot ekte
    // data på stage 2026-08-22: «Samfunnsvitere» viste moduleTotal 5 mens porten krevde 4 — samme
    // «to tellere er uenige» som saken handlet om, bare på modulsiden. Jeg hadde fikset
    // seksjonstellingen og glemt denne.
    const moduleIds = course.modules.filter((cm) => cm.module?.archivedAt == null).map((cm) => cm.moduleId);
    const [certStatuses, passedCount, latestSubmissions] = await Promise.all([
      courseRepository.findUserCertificationStatusesForModules(userId, moduleIds),
      courseRepository.countPassedModulesForUser(userId, moduleIds),
      moduleIds.length > 0
        ? queryLatestSubmissionsForModules(userId, moduleIds)
        : Promise.resolve([]),
    ]);

    const certStatusByModuleId = new Map(certStatuses.map((cs) => [cs.moduleId, cs.status]));
    const latestSubmissionByModuleId = new Map<string, (typeof latestSubmissions)[number]>();
    for (const submission of latestSubmissions) {
      if (!latestSubmissionByModuleId.has(submission.moduleId)) {
        latestSubmissionByModuleId.set(submission.moduleId, submission);
      }
    }

    // Mixed module/section sequence (#491/P1) with per-section read state (#492).
    // #958: deltakerdøra. Seksjoner deltakeren ikke kan åpne er allerede filtrert bort, og hvert
    // element bærer et ferdig avgjort `available` — ruta har ikke lenger noen egen regel å glemme.
    const courseItems = await courseRepository.findCourseItemsForParticipant(course.id);
    const readSectionIds = new Set(await courseRepository.findReadSectionIds(userId, course.id));
    let readSectionCount = 0;
    // ⚠️ #992: upubliserte seksjoner UTELATES fra deltakerens sekvens — de vises ikke som en
    // nedtonet rad, de er borte.
    //
    // #944 valgte det motsatte: raden skulle fortelle deltakeren at «det er noe her» i stedet for at
    // noe forsvant. Produkteier 2026-08-23 snudde det: «utkastseksjoner skal ikke ha konsekvenser
    // for kandidater før de er publisert». For en kandidat som ALDRI har sett seksjonen finnes det
    // ingenting å forklare — raden var en beskjed om vår egen redigeringstilstand.
    //
    // ⚠️ Her sto det først et `visibleItems`-filter i denne ruta. #958 flyttet det inn i døra, og da
    // ble filteret her en ANDRE anvendelse av samme regel — nøyaktig mønsteret begge sakene finnes
    // for å fjerne. Det er slettet med vilje: legg det ikke tilbake.
    //
    // Klientens `available`-håndtering er dermed forsvar i dybden for seksjoner. Den beholdes:
    // MODULER sender fortsatt `available: false` (se under), og en klient kan møte en eldre server.
    //
    // Moduler filtreres IKKE bort. Forskjellen er historikk: deltakeren kan allerede ha bestått en
    // modul som senere ble avpublisert, og da er raden hens egen fortid, ikke vår redigering.
    // Se `doc/DECISIONS.md`.
    const items: CourseSequenceItem[] = courseItems.map((item) => {
      if (item.itemType === "SECTION" && item.section) {
        const read = readSectionIds.has(item.section.id);
        // #992: teller og nevner leser nå fra SAMME liste — `visibleItems`. Før filtreringen var de
        // to uavhengige uttrykk, og telleren glemte tilgjengelighet: en lesning fra før seksjonen
        // ble upublisert talte mot en nevner som ikke lenger inneholdt den, så detaljen rapporterte
        // «1/1» og COMPLETED mens bevisporten korrekt nektet.
        //
        // ⚠️ Ikke legg et predikat til her. At bare tilgjengelige seksjoner kan telles er nå en
        // egenskap ved lista, ikke en regel hvert uttrykk må huske.
        if (read) readSectionCount += 1;
        return {
          type: "SECTION",
          sortOrder: item.sortOrder,
          sectionId: item.section.id,
          courseItemId: item.id,
          title: localizeContentText(locale, item.section.title) ?? item.section.title,
          read,
          // #944/#958: flagget står igjen i DTO-en fordi klienten leser det på MODULE, og et felt
          // som forsvinner for én av to typer er en ny regel klienten må kjenne. For seksjoner er
          // det alltid `true` — de uleselige kommer ikke ut av deltakerdøra i det hele tatt.
          available: item.available,
          required: item.required,
          discussionsEnabled: item.discussionsEnabled,
        };
      }
      const moduleId = item.moduleId ?? item.module?.id ?? "";
      const certStatus = certStatusByModuleId.get(moduleId);
      const passed = isCertificationPassed(certStatus);
      const hasStarted = latestSubmissionByModuleId.has(moduleId);
      // #502-followup/#958: regelen bor nå i `findCourseItemsForParticipant`. Ruta leser en
      // avgjørelse i stedet for å ta en — feltene den ble regnet ut av finnes ikke her lenger.
      //
      // ⚠️ #995: BEGGE avgjørelsene. En avpublisert modul er `available: false` men fortsatt
      // `required: true` — den er midlertidig nede, ikke tatt ut av kurset. Klienten skal ikke
      // utlede det ene av det andre.
      const available = item.available;
      return {
        type: "MODULE",
        sortOrder: item.sortOrder,
        moduleId,
        courseItemId: item.id,
        title: localizeContentText(locale, item.module?.title ?? "") ?? item.module?.title ?? moduleId,
        moduleStatus: passed ? "PASSED" : hasStarted ? "IN_PROGRESS" : "NOT_STARTED",
        discussionsEnabled: item.discussionsEnabled,
        available,
        required: item.required,
      };
    });

    // All elements count toward progress: passed modules + read sections (#492).
    // Module count derived from CourseItem (itemType MODULE); sections from CourseItem too.
    // #944/#938/#958: framdriften teller de seksjonene som FAKTISK KREVES — de deltakeren kan lese.
    // Kortet kunne før vise «Seksjonar 0/1» ved siden av et utstedt kursbevis, fordi telleren og
    // bevisporten filtrerte ulikt.
    //
    // ⚠️ Nå er dette ikke lenger en telling MED filter. Sekvensen inneholder bare det som kreves,
    // fordi telleren og bevisporten har fått radene fra SAMME dør. Legg ikke et predikat tilbake
    // her — det ville gjeninnført nettopp uenigheten linja finnes for å ha fjernet.
    const sectionCount = items.filter((i) => i.type === "SECTION").length;
    const totalElements = moduleIds.length + sectionCount;
    const completedElements = passedCount + readSectionCount;

    const detail: CourseDetail = {
      id: course.id,
      title: localizeContentText(locale, course.title) ?? course.title,
      description: localizeContentText(locale, course.description) ?? course.description,
      certificationLevel: course.certificationLevel,
      publishedAt: course.publishedAt.toISOString(),
      discussionsEnabled: course.discussionsEnabled,
      moduleCount: moduleIds.length,
      progress: {
        completed: completedElements,
        total: totalElements,
        courseStatus: computeCourseStatus(completedElements, totalElements, latestSubmissions.length > 0 || readSectionCount > 0),
        moduleCompleted: passedCount,
        moduleTotal: moduleIds.length,
        sectionCompleted: readSectionCount,
        sectionTotal: sectionCount,
      },
      modules: course.modules.map((cm) => {
        const certStatus = certStatusByModuleId.get(cm.moduleId);
        const passed = isCertificationPassed(certStatus);
        const hasStarted = latestSubmissionByModuleId.has(cm.moduleId);
        return {
          moduleId: cm.moduleId,
          sortOrder: cm.sortOrder,
          title: localizeContentText(locale, cm.module.title) ?? cm.module.title,
          moduleStatus: passed ? "PASSED" : hasStarted ? "IN_PROGRESS" : "NOT_STARTED",
        };
      }),
      items,
    };

    response.json({ course: detail });
  } catch (error) {
    next(error);
  }
});

// Rendered learning-section content for a participant (#491/P1). Validates the
// section belongs to the published course, then returns sanitised HTML in the
// participant's locale.
coursesRouter.get("/:courseId/sections/:sectionId", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  const locale = normalizeLocale(request.context?.locale) ?? "en-GB";
  try {
    const course = await courseRepository.findCourseById(request.params.courseId);
    if (!course || !course.publishedAt || course.archivedAt) {
      throw new NotFoundError("Course", "course_not_found", "Course not found.");
    }
    // #778/#785: gate RESTRICTED-course section content on enrolment/class visibility.
    if (!(await isCourseVisibleToUser({ course, userId, roles: request.context?.roles ?? [], groupIds: request.context?.principal?.groupIds }))) {
      throw new NotFoundError("Course", "course_not_found", "Course not found.");
    }
    // #944/#958: medlemskap i kurset er IKKE nok. En arkivert seksjon, eller en som
    // oversettelsesgaten har holdt tilbake, har ingen aktiv versjon — og ga tidligere 200 med tom
    // side. Deltakerdøra leverer den ikke, så «finnes ikke i kurset» og «kan ikke leses» er nå det
    // samme oppslaget og kan ikke svare hver sin ting. 404 fordi vi ikke bekrefter at seksjonen
    // finnes i det hele tatt, på samme måte som synlighetssjekken over.
    const courseItems = await courseRepository.findCourseItemsForParticipant(course.id);
    const item = courseItems.find(
      (i) => i.itemType === "SECTION" && i.sectionId === request.params.sectionId,
    );
    if (!item) {
      throw new NotFoundError("CourseSection", "section_not_found", "Section not found in this course.");
    }
    const section = await getSection(request.params.sectionId);
    if (!section) {
      throw new NotFoundError("CourseSection", "section_not_found", "Section not found.");
    }
    const localizedTitle = localizeContentText(locale, section.title) ?? section.title;
    const localizedBody = localizeContentText(locale, section.activeVersion?.bodyMarkdown ?? "") ?? "";
    response.json({ title: localizedTitle, html: renderSectionMarkdown(localizedBody, locale) });
  } catch (error) {
    next(error);
  }
});

// Mark a section as read for the current participant (#492). Idempotent.
coursesRouter.post("/:courseId/sections/:sectionId/read", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const course = await courseRepository.findCourseById(request.params.courseId);
    if (!course || !course.publishedAt || course.archivedAt) {
      throw new NotFoundError("Course", "course_not_found", "Course not found.");
    }
    // #778/#785: gate RESTRICTED-course read-progress writes on enrolment/class visibility.
    if (!(await isCourseVisibleToUser({ course, userId, roles: request.context?.roles ?? [], groupIds: request.context?.principal?.groupIds }))) {
      throw new NotFoundError("Course", "course_not_found", "Course not found.");
    }
    // #944/#958: samme dør som lesestien. Var dette to oppslag med hver sin regel, kunne markeringen
    // gå gjennom for en seksjon lesestien nektet — og kursbeviset bli utstedt for innhold som aldri
    // ble publisert. Det var nøyaktig hullet i #944.
    const courseItems = await courseRepository.findCourseItemsForParticipant(course.id);
    const item = courseItems.find(
      (i) => i.itemType === "SECTION" && i.sectionId === request.params.sectionId,
    );
    if (!item) {
      throw new NotFoundError("CourseSection", "section_not_found", "Section not found in this course.");
    }
    await courseRepository.markSectionRead(userId, course.id, request.params.sectionId);
    // Reading the final section can be the last gate for certification (#476/#525) — re-check.
    await checkCourseCompletionForCourse({ userId, courseId: course.id });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

// #496/EN-2: self-enrolment on an OPEN course (source=SELF). RESTRICTED courses reject with 400.
coursesRouter.post("/:courseId/enroll", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const course = await courseRepository.findCourseById(request.params.courseId);
    if (!course || !course.publishedAt || course.archivedAt) {
      throw new NotFoundError("Course", "course_not_found", "Course not found.");
    }
    await selfEnroll(request.params.courseId, userId);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

export { coursesRouter };
