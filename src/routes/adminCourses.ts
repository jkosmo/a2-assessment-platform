import { Router } from "express";
import { requireContentOwnership } from "./requireContentOwnership.js";
import { idempotency } from "../middleware/idempotency.js";
import { deriveContentLifecycle } from "../modules/content/lifecycle.js";
import { assertContentOwnership, listManageableContentIds } from "../modules/content/contentOwnershipService.js";
import { z } from "zod";
import {
  createCourse,
  updateCourse,
  unpublishCourse,
  archiveCourse,
  restoreCourse,
  setCourseModules,
  setCourseItems,
  deleteCourse,
  courseRepository,
  createCourseRepository,
  assignEnrollments,
  revokeEnrollment,
  listCourseEnrollments,
  getCoursePublishPreview,
  publishCourseCascade,
  publishCourseChecked,
  courseFormOutdatedError,
  assertCourseItemsUsable,
  getCoursePendingVersions,
  publishCoursePendingVersions,
  getCourseCascadeDeletePreview,
  cascadeDeleteCourse,
  findThemeIdsForCourse,
  findLocalizedThemesForCourses,
  assertCourseThemesExist,
  findExistingThemeIds,
} from "../modules/course/index.js";
import { generationLocaleSchema, importBodySchema, normalizeImportPayload, localizedTextPatchSchema, parseRequest, clientRefSchema, agentRunIdSchema, publishPendingVersionedBodySchema } from "../modules/adminContent/adminContentSchemas.js";
import { publishCoursePendingVersioned } from "../modules/course/versionedPublishService.js";
import { courseAdminLinks } from "../modules/adminContent/adminUiLinks.js";
import type { AppRole as AppRoleType } from "@prisma/client";
import { hasAnyRole, ADMIN_ONLY } from "../auth/roleSets.js";
import { buildCourseExportEnvelope } from "../modules/adminContent/index.js";
import { importCourseFromEnvelope } from "../modules/adminContent/contentImportService.js";
import { localizedTextCodec } from "../codecs/localizedTextCodec.js";
import { localizeContentText } from "../i18n/content.js";
import { localizeCourseCopy } from "../modules/adminContent/llmContentGenerationService.js";
import { NotFoundError, AppError, ConflictError, DomainRuleError } from "../errors/AppError.js";
import type { AdminCourseListItem, AdminCourseDetail } from "../modules/course/index.js";
import { countCourseInProgressParticipants } from "../modules/course/contentLifecycle.js";
import { countMajorVersionRecipients } from "../modules/course/courseVersioning.js";
import {
  discardCourseDraft,
  findCourseDraft,
  findCourseIdsWithDraft,
  publishCourseDraft,
  saveCourseDraft,
  type CourseDraftRow,
} from "../modules/course/courseDraft.js";
import { prisma } from "../db/prisma.js";
import { generateLimiter } from "../middleware/rateLimiting.js";
import { respondWithAppError } from "./helpers/respondWithAppError.js";
import { requestLocale } from "../i18n/requestLocale.js";
import { packageCueWarnings } from "../modules/adminContent/mcqCueWarnings.js";
import { packageRubricWarnings } from "../modules/adminContent/rubricWarnings.js";
import { packageAltTextWarnings } from "../modules/adminContent/altTextWarnings.js";

const adminCoursesRouter = Router();

const courseBodySchema = z.object({
  title: localizedTextPatchSchema,
  description: localizedTextPatchSchema.optional(),
  certificationLevel: localizedTextPatchSchema.optional(),
  // #645/#496: course visibility — OPEN (everyone) or RESTRICTED (only enrolled / class-assigned).
  enrollmentPolicy: z.enum(["OPEN", "RESTRICTED"]).optional(),
  // #495/T-QA-4: kurs-master av/på for diskusjon (default true i datamodellen).
  discussionsEnabled: z.boolean().optional(),
  // 2.119.0: e-post til kursets eiere om nye spørsmål i diskusjonen (default true i datamodellen).
  discussionOwnerNotifications: z.boolean().optional(),
  // #1093: plassering i «Mine kurs». null = alfabetisk (det vanlige).
  sortOrder: z.number().int().min(0).max(9999).nullable().optional(),
  // 2.102.0: kursets tema i «Mine kurs». Satt = nøyaktig disse; utelatt = urørt.
  themeIds: z.array(z.string().min(1)).max(100).optional(),
});

const setCourseModulesBodySchema = z.object({
  modules: z.array(
    z.object({
      moduleId: z.string().min(1),
      sortOrder: z.number().int().min(0),
    }),
  ),
  // #934 skive 4a: som `PUT …/items`.
  expectedRevision: z.number().int().min(0).optional(),
});

const setCourseItemsBodySchema = z.object({
  items: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("MODULE"), moduleId: z.string().min(1), discussionsEnabled: z.boolean().optional() }),
      z.object({ type: z.literal("SECTION"), sectionId: z.string().min(1), discussionsEnabled: z.boolean().optional() }),
    ]),
  ),
  // AA-5 (#653): stamped into the items-update's audit event (source: agent_authoring).
  agentRunId: agentRunIdSchema.optional(),
  // #934 skive 3: forfatterens svar når et publisert kurs endres.
  version: z.enum(["major", "minor"]).optional(),
  // #934 skive 4a: overgangen fra 2.129.0 er fjernet. Markøren godtas fortsatt (en klient som sender den, skal
  // ikke få 400), men betyr ingenting: uten svar avvises endringen når noen har kursbevis.
  versionAware: z.literal(true).optional(),
  // #934 skive 4a: telleren skjemaet lastet. Uten den godtas lagringen bare for et kurs som aldri har vært ute.
  expectedRevision: z.number().int().min(0).optional(),
  // #934 skive 4b: se `confirmEmailRecipientsSchema`.
  confirmEmailRecipients: z.number().int().min(0).optional(),
});

// #934 skive 4b: tallet dialogen viste da forfatteren sa ja til at en hovedversjon sender e-post til over 200
// deltakere. Serveren teller på nytt; over grensen og ikke bekreftet (eller bekreftet lavere): `409
// major_email_confirm_required`, og ingenting er skrevet. En gammel klient sender det aldri.
const confirmEmailRecipientsSchema = setCourseItemsBodySchema.shape.confirmEmailRecipients;

// #934 skive 4a: telleren kursskjemaet lastet (`contentRevision` i kursdetaljen). Kreves av `PUT /:courseId` og
// `PUT …/content`: uten den er det en fane fra før denne utgivelsen, og den avvises før noe skrives.
const expectedRevisionSchema = z.number().int().min(0).optional();

// #934 skive 3: `PUT /:courseId/content` — kursskjemaet lagrer navnet og innholdet i ÉN lagring: `items`
// (samme form som `PUT …/items`, påkrevd) og forfatterens svar `version` skrives i samme transaksjon som
// navnet, og serveren avgjør versjonen én gang. Et EGET endepunkt, ikke nye felt på `PUT /:courseId`: under
// rullering svarer en gammel server 404 på dette i stedet for å fjerne `items` stille og svare OK (QA-porten).
// #934 skive 4a: skjemaet lagrer ALLTID et eksisterende kurs her, også når elementene er uendret.
const saveCourseContentBodySchema = courseBodySchema.partial().extend({
  items: setCourseItemsBodySchema.shape.items,
  version: z.enum(["major", "minor"]).optional(),
  expectedRevision: expectedRevisionSchema,
  confirmEmailRecipients: confirmEmailRecipientsSchema,
});

const courseLocalizationBodySchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  sourceLocale: generationLocaleSchema,
  targetLocale: generationLocaleSchema,
}).refine((value) => Boolean(value.title || value.description), {
  message: "At least one field is required.",
});

// AA-2 (#650): create accepts an optional clientRef (echoed back, never persisted)
// and returns admin links so agent orchestration can hand humans review URLs.
// AA-5 (#653): agentRunId is stamped into the create's audit event.
const courseCreateBodySchema = courseBodySchema.extend({
  clientRef: clientRefSchema.optional(),
  agentRunId: agentRunIdSchema.optional(),
});

adminCoursesRouter.post("/", idempotency("courses.create"), async (request, response, next) => {
  const parsed = courseCreateBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  try {
    const course = await createCourse({
      title: localizedTextCodec.serialize(parsed.data.title),
      description: parsed.data.description ? localizedTextCodec.serialize(parsed.data.description) : null,
      certificationLevel: parsed.data.certificationLevel ? localizedTextCodec.serialize(parsed.data.certificationLevel) : null,
      enrollmentPolicy: parsed.data.enrollmentPolicy,
      discussionsEnabled: parsed.data.discussionsEnabled,
      discussionOwnerNotifications: parsed.data.discussionOwnerNotifications,
      sortOrder: parsed.data.sortOrder,
      themeIds: parsed.data.themeIds,
      actorId: request.context?.userId,
      agent: { clientRef: parsed.data.clientRef, agentRunId: parsed.data.agentRunId },
    });
    response.status(201).json({
      course,
      links: courseAdminLinks(course.id),
      ...(parsed.data.clientRef !== undefined ? { clientRef: parsed.data.clientRef } : {}),
    });
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.post("/localize-copy", generateLimiter, async (request, response, next) => {
  const parsed = courseLocalizationBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  try {
    if (parsed.data.sourceLocale === parsed.data.targetLocale) {
      response.json({
        title: parsed.data.title,
        description: parsed.data.description,
      });
      return;
    }

    const result = await localizeCourseCopy(parsed.data);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.get("/", async (request, response, next) => {
  try {
    const courses = await courseRepository.listCourses();
    // #705-UX(F): vis antall påbegynte-ufullførte deltakere per kurs (samme signal som G3-vakta).
    const inProgressCounts = await Promise.all(
      courses.map((c) => countCourseInProgressParticipants(c.id)),
    );
    // #787 slice 5: hvilke kurs kan innlogget bruker forvalte (admin eller eier)? Styrer om lista viser
    // rediger/livssyklus-handlingene — speiler eierskaps-vakta så vi ikke rendrer knapper som gir 403.
    const manageable = await listManageableContentIds({
      contentType: "COURSE",
      contentIds: courses.map((c) => c.id),
      actorUserId: request.context?.userId ?? "",
      roles: request.context?.roles ?? [],
    });
    const locale = requestLocale(request);
    // 2.102.0: temaene står i lista, så oversikten kan filtreres på dem.
    const themesByCourse = await findLocalizedThemesForCourses(courses.map((c) => c.id), locale);
    // #1140 etappe 2: et publisert kurs med et lagret utkast står som «Publisert» med «Nyere utkast», som en modul.
    const withDraft = await findCourseIdsWithDraft(prisma, courses.map((c) => c.id));
    const items: AdminCourseListItem[] = courses.map((c, i) => ({
      id: c.id,
      title: c.title,
      displayTitle: localizeContentText(locale, c.title) ?? c.title,
      description: c.description,
      certificationLevel: c.certificationLevel,
      moduleCount: c._count.modules,
      sortOrder: c.sortOrder ?? null,
      updatedAt: c.updatedAt.toISOString(),
      publishedAt: c.publishedAt?.toISOString() ?? null,
      archivedAt: c.archivedAt?.toISOString() ?? null,
      lifecycle: deriveContentLifecycle({ archivedAt: c.archivedAt, publishedAt: c.publishedAt, hasDraft: withDraft.has(c.id) }),
      inProgressCount: inProgressCounts[i],
      canManage: manageable.has(c.id),
      themes: themesByCourse.get(c.id) ?? [],
      versionMajor: c.versionMajor,
      versionMinor: c.versionMinor,
    }));
    response.json({ courses: items });
  } catch (error) {
    next(error);
  }
});

// Course import from a2-content-export/v1 envelope (#433). Counterpart to
// /:courseId/export-package. Inlined modules are always imported as fresh
// modules (createNew); course-level mode controls whether the course itself
// is new or whether the imported modules attach to an existing target course.
adminCoursesRouter.post("/import", async (request, response, next) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  // #937: en kurspakke kan ikke løftes ut av noe større, så her er det bare den bare payloaden som
  // pakkes inn. Den lesbare feilmeldingen er derimot like nødvendig som på de to andre flatene.
  const rawBody = (request.body ?? {}) as Record<string, unknown>;
  const normalized = normalizeImportPayload(rawBody.payload, "course");
  if (!normalized.ok) {
    response.status(400).json({
      error: "not_an_export_envelope",
      message: "This does not look like a course package. Use Export on a course to produce a valid file.",
    });
    return;
  }
  const { data, error } = parseRequest(importBodySchema, { ...rawBody, payload: normalized.envelope });
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }
  if (data.payload.scope !== "course") {
    response.status(400).json({ error: "scope_mismatch", message: "Envelope scope must be 'course' for this endpoint." });
    return;
  }
  try {
    // #942 (security): `replaceExisting` skriver nye seksjoner, moduler og item-sekvens inn i
    // targetId. Uten denne vakta kunne en SMO hente en vilkårlig kurs-ID og overskrive et kurs de
    // ikke eier — også et publisert kurs deltakere står midt i.
    //
    // ⚠️ Dette er NØYAKTIG angrepet #528 tettet for modulimport (adminContent.ts:453) og som
    // seksjonsimport har vakt mot (adminSections.ts:236). Kursruta var den ene av tre som manglet
    // den. Tjenestelaget hjelper ikke: `importCourseFromEnvelope` gjør kun en eksistenssjekk på
    // targetCourseId og har ingen referanse til eierskap i det hele tatt.
    const mode = data.mode ?? "createNew";
    // #1095: `updateExisting` skriver nye versjoner inn i targetId — samme vakt som `replaceExisting`.
    // (Uten targetId stopper tjenesten selv med en valideringsfeil.)
    if ((mode === "replaceExisting" || mode === "updateExisting") && data.targetId) {
      await assertContentOwnership({
        contentType: "COURSE",
        contentId: data.targetId,
        actorUserId: actorId,
        roles: request.context?.roles ?? [],
      });
    }
    const envelope = data.payload as unknown as Parameters<typeof importCourseFromEnvelope>[0];
    const result = await importCourseFromEnvelope(envelope, {
      actorId,
      mode,
      targetCourseId: data.targetId,
      // #1095: eierskapet sjekkes per element i tjenesten (seksjoner og moduler kan ha andre eiere enn kurset).
      actorRoles: request.context?.roles ?? [],
      // #934 skive 3: kreves for `replaceExisting` når kurset har kursbevis.
      version: data.version,
      // #934 skive 4b: kreves når hovedversjonen sender e-post til over 200.
      confirmEmailRecipients: data.confirmEmailRecipients,
    });
    // AA-2 (#650): links + clientRef echo make the response agent-orchestrable.
    response.status(201).json({
      courseId: result.courseId,
      moduleIds: result.moduleIds,
      // #957: forfatteren skal vite HVORFOR kurset ligger som utkast. Flagget er den eneste kilden
      // til den forklaringen — et kurs kan også være utkast fordi KILDEN var det, og de to sier
      // helt ulike ting om hva forfatteren må gjøre videre.
      //
      // ⚠️ `importCourseFromEnvelope` regnet ut flagget, brukte det til å holde kurset tilbake, og
      // slapp det så på gulvet i sin egen retur — mens modul- og seksjonsimporten rapporterte det.
      // Kommentaren i `contentImportService.ts` lovet at det ble rapportert. Nå gjør det det.
      heldBackByTranslationGate: result.heldBackByTranslationGate,
      ...(result.summary ? { summary: result.summary } : {}),
      // #1119: tester der svaret kan røpe seg — varsel, ikke stopp. Regnet på fila, med seksjonene før hver test.
      cueWarnings: packageCueWarnings(data.payload),
      // #1122: kriterier med én linje for hele skalaen, per modul.
      rubricWarnings: packageRubricWarnings(data.payload),
      // #1128: seksjoner der et bilde har en tittel som alt-tekst.
      altWarnings: packageAltTextWarnings(data.payload),
      links: courseAdminLinks(result.courseId),
      ...(data.clientRef !== undefined ? { clientRef: data.clientRef } : {}),
    });
  } catch (err) {
    if (err instanceof AppError) {
      respondWithAppError(response, err);
      return;
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    if (/not found/i.test(message)) {
      response.status(404).json({ error: "import_target_not_found", message });
      return;
    }
    next(err);
  }
});

// Versioned export envelope for cross-environment transfer / file backup (#433).
// Self-contained: inlines each referenced module's full active-version payload
// so the file can recreate the course in another environment without external
// lookups. Counterpart to /api/admin/content/modules/:id/export-package.
// #903: this route had no ownership guard while every sibling on :courseId has one, and the
// envelope inlines each module's full payload - MCQ correctAnswer and rationale included. Any
// SUBJECT_MATTER_OWNER could therefore download another owner's answer keys by exporting their
// course. Guarded like the siblings.
//
// Deliberate scope (product decision 2026-08-14, #903): course ownership is NOT module
// ownership, and this route does not check the latter. A course owner who has assembled
// another author's module into their course receives that module's answer key in the export.
// Accepted: the course is theirs, the content is what they put in it, and an answer key is
// not a state secret. What this guard stops is reading a course you have nothing to do with.
// ⚠️ LESING AV KURSINNHOLD ER ÅPEN FOR ALLE FORFATTERE — DET ER EN BESLUTNING, IKKE ET HULL.
//
// Produkteier 2026-09-08:
//
//   «Er man SMO skal man kunne se alt kursinnhold. Hvis de benytter dette til å jukse, så er det
//   til slutt deres eget problem. Dette er et verktøy for kompetansebygging, og å motivere for
//   kompetansebygging — hvis noen ønsker å omgå dette er det deres eget problem.»
//
// #943 la eierskapsvakt på disse leserutene. Begrunnelsen var ikke at kolleger ikke skal se
// hverandres arbeid, men REKOGNOSERING: lesetilgangen skulle gjøre et eierskapshull i
// kursimporten utnyttbart. Det hullet er tettet — `POST /import` krever eierskap for
// `replaceExisting` — så den begrunnelsen står ikke lenger.
//
// ⚠️ SKRIVING ER FORTSATT VAKTET. Beslutningen gjelder å SE, ikke å endre. De tolv skriverutene i
// denne fila er urørt.
//
// ⚠️ OG `/enrollments` ER FORTSATT VAKTET. Den lister navn, e-post og avdeling på deltakere —
// personopplysninger, ikke kursinnhold. «Juks er deres eget problem» dekker ikke andres data, så
// den er holdt utenfor med vilje. Skal den også åpnes, er det en egen beslutning.
adminCoursesRouter.get("/:courseId/export-package", async (request, response, next) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const envelope = await buildCourseExportEnvelope(request.params.courseId, { userId: actorId });
    response.json({ envelope });
  } catch (error) {
    if (error instanceof AppError) {
      respondWithAppError(response, error);
      return;
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (/not found/i.test(message)) {
      response.status(404).json({ error: "course_export_failed", message });
      return;
    }
    // Course exists but is not exportable yet — e.g. has no modules, or one of
    // its modules has no rubric/prompt/MCQ/active-version content. 422 is
    // semantically correct (the resource is there but cannot be processed in
    // its current state) and gives the UI a clear actionable message.
    // "items" included: an empty course threw "Course has no items to export", which the
    // pattern missed - so clicking Eksporter on a fresh course gave a generic 500 instead of
    // the actionable 422 this branch exists for.
    if (/no (items|modules|versions|rubric|prompt|MCQ)/i.test(message)) {
      response.status(422).json({ error: "course_not_exportable", message });
      return;
    }
    next(error);
  }
});

// #943: tolv skriveruter på `/:courseId` var vaktet, denne lesingen var det ikke. Den gir hele
// oppsettet til et fremmed kurs — moduler, seksjoner, publiseringsstatus, `enrollmentPolicy`. Det
// er rekognoseringen som gjør resten utnyttbart, og eksportruta rett over ble vaktet med nettopp
// den begrunnelsen (#903).
//
// Trygt å stramme: ruta brukes kun av kursredigeringen (`renderDetailView`), og lista merker
// allerede hver rad med `canManage` — «Rediger» rendres ikke for den som ville fått 403.
// Samme grep som seksjonene fikk i #916, og linja går der: LISTA er åpen (du må kunne finne dine
// egne), DETALJEN er ikke.
// ⚠️ Ingen eierskapsvakt, med vilje: produkteier ønsker størst mulig deling mellom fagansvarlige i
// organisasjonen (2026-09-07, bekreftet 2026-11-02). Også `certificateHolders` (#934) er åpent for dem.
// Blir det flere organisasjoner, må lesevaktene på plass. Se doc/DECISIONS.md.
adminCoursesRouter.get("/:courseId", async (request, response, next) => {
  try {
    const course = await courseRepository.findCourseById(request.params.courseId);
    if (!course) {
      throw new NotFoundError("Course", "course_not_found", "Course not found.");
    }
    const hasDraft = (await findCourseDraft(prisma, course.id)) != null;
    const detail: AdminCourseDetail = {
      id: course.id,
      title: course.title,
      description: course.description,
      certificationLevel: course.certificationLevel,
      enrollmentPolicy: course.enrollmentPolicy,
      discussionsEnabled: course.discussionsEnabled,
      discussionOwnerNotifications: course.discussionOwnerNotifications,
      slug: course.slug ?? null,
      sortOrder: course.sortOrder ?? null,
      themeIds: await findThemeIdsForCourse(course.id),
      updatedAt: course.updatedAt.toISOString(),
      publishedAt: course.publishedAt?.toISOString() ?? null,
      archivedAt: course.archivedAt?.toISOString() ?? null,
      versionMajor: course.versionMajor,
      versionMinor: course.versionMinor,
      certificateHolders: await courseRepository.countCertificateHolders(course.id, course.versionMajor),
      majorEmailRecipients: await countMajorVersionRecipients(prisma, course.id),
      contentRevision: course.contentRevision,
      hasDraft,
      lifecycle: deriveContentLifecycle({ archivedAt: course.archivedAt, publishedAt: course.publishedAt, hasDraft }),
      modules: course.modules.map((cm) => ({
        moduleId: cm.moduleId,
        sortOrder: cm.sortOrder,
        moduleTitle: cm.module.title,
        moduleArchivedAt: cm.module.archivedAt?.toISOString() ?? null,
      })),
    };
    response.json({ course: detail });
  } catch (error) {
    next(error);
  }
});

/**
 * Kursets felt fra en validert kropp, slik `updateCourse` tar dem imot (lokaliserte tekster lagres som JSON-tekst). Utelatt
 * felt = urørt. Brukt av `PUT /:courseId`, `PUT …/content` og publiseringen av utkastet, så de tre ikke kan drive fra hverandre.
 */
function courseFieldsFromBody(body: Partial<z.infer<typeof courseBodySchema>>) {
  return {
    title: body.title ? localizedTextCodec.serialize(body.title) : undefined,
    description: body.description ? localizedTextCodec.serialize(body.description) : undefined,
    certificationLevel: body.certificationLevel ? localizedTextCodec.serialize(body.certificationLevel) : undefined,
    enrollmentPolicy: body.enrollmentPolicy,
    discussionsEnabled: body.discussionsEnabled,
    discussionOwnerNotifications: body.discussionOwnerNotifications,
    sortOrder: body.sortOrder,
    themeIds: body.themeIds,
  };
}

// #934 skive 4a: kursskjemaet bruker ikke lenger denne for et eksisterende kurs (alt går til `…/content`). En fane
// fra før utrullingen gjør det, og den sender ikke telleren: `409 course_form_outdated` før noe skrives — ellers
// ville navnet stått lagret mens elementene ble avvist i neste kall, eller skrevet over en annens endring.
adminCoursesRouter.put("/:courseId", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  const parsed = courseBodySchema.partial().extend({ expectedRevision: expectedRevisionSchema }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  try {
    if (parsed.data.expectedRevision === undefined) throw courseFormOutdatedError();
    const course = await updateCourse(request.params.courseId, courseFieldsFromBody(parsed.data), request.context?.userId, { expectedRevision: parsed.data.expectedRevision });
    response.json({ course });
  } catch (error) {
    next(error);
  }
});

// #934 skive 3: navn og innhold i ÉN lagring, i én transaksjon (se skjemaet over).
// #934 skive 4a: med telleren skjemaet lastet. Har noen andre lagret kurset siden, `409 course_changed`, og
// ingenting er skrevet. Uten telleren: en gammel fane, `409 course_form_outdated`.
adminCoursesRouter.put("/:courseId/content", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  const parsed = saveCourseContentBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    if (parsed.data.expectedRevision === undefined) throw courseFormOutdatedError();
    const course = await updateCourse(request.params.courseId, courseFieldsFromBody(parsed.data), request.context?.userId, {
      items: parsed.data.items,
      version: parsed.data.version,
      expectedRevision: parsed.data.expectedRevision,
      confirmEmailRecipients: parsed.data.confirmEmailRecipients,
    });
    response.json({ course });
  } catch (error) {
    next(error);
  }
});

// ── #1140 etappe 2: utkastet til et publisert kurs (doc/design/PLAN_1140_E2.md) ──────────────────────────────────────────────
//
// «Lagre» i kursbyggeren skriver hit når kurset er publisert. Ingenting deltakerne ser, endres
// før utkastet publiseres. Alt om `CourseDraft` bor i modules/course/courseDraft.ts; rutene her eier skjemaet, og leser den
// lagrede teksten gjennom det, både ved henting og ved publisering. Agent-tokenet når ingen av rutene (ikke i hvitelista).

/** Det utkastet inneholder: kroppen til `PUT …/content`, uten svaret om versjon og uten telleren. */
const courseDraftPayloadSchema = courseBodySchema.partial().extend({ items: setCourseItemsBodySchema.shape.items });
type CourseDraftPayload = z.infer<typeof courseDraftPayloadSchema>;

/** Utkastet fana lastet (`LoadedCourseDraft` i courseDraft.ts). Kreves for å lagre videre, forkaste og publisere. */
const loadedCourseDraftSchema = z.object({ draftId: z.string().min(1), revision: z.number().int().min(1) }).strict();

/** Det skjemaet lastet: et utkast, eller den publiserte utgaven uten utkast (`LoadedCourseEdition`). */
const loadedCourseEditionSchema = z.union([loadedCourseDraftSchema, z.object({ expectedRevision: z.number().int().min(0) }).strict()]);

const saveCourseDraftBodySchema = courseDraftPayloadSchema.extend({ loaded: loadedCourseEditionSchema });

const publishCourseDraftBodySchema = z
  .object({
    loaded: loadedCourseDraftSchema,
    // Forfatterens svar når lista er endret og noen har kursbevis, som i `PUT …/content`.
    version: z.enum(["major", "minor"]).optional(),
    confirmEmailRecipients: confirmEmailRecipientsSchema,
  })
  .strict();

/**
 * Leser den lagrede teksten gjennom skjemaet. En rad som ikke passer (skjemaet er strammet inn siden den ble lagret), kan
 * verken vises eller publiseres: `409 course_draft_unreadable`, med id og teller så den kan forkastes. Ikke en 500.
 */
function readCourseDraftPayload(draft: CourseDraftRow): CourseDraftPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(draft.payloadText);
  } catch {
    raw = undefined;
  }
  const parsed = courseDraftPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConflictError(
      "course_draft_unreadable",
      "This draft was saved by an older version of the platform and cannot be opened. Discard the draft and make the changes again.",
      { courseId: draft.courseId, draftId: draft.id, revision: draft.revision },
    );
  }
  return parsed.data;
}

type DraftItemReader = Pick<typeof prisma, "module" | "courseSection">;

/**
 * Elementene i utkastet slik de står NÅ: tittel, og om noe hindrer at de publiseres ut i kurset (arkivert, slettet, eller
 * nytt i utkastet uten å være publisert). `liveItems` er kursets publiserte liste, hentet av kalleren gjennom den navngitte
 * døra (`findAllCourseItems`, #958).
 */
async function describeCourseDraftItems(
  client: DraftItemReader,
  items: CourseDraftPayload["items"],
  liveItems: ReadonlyArray<{ moduleId: string | null; sectionId: string | null }>,
) {
  const moduleIds = items.flatMap((item) => (item.type === "MODULE" ? [item.moduleId] : []));
  const sectionIds = items.flatMap((item) => (item.type === "SECTION" ? [item.sectionId] : []));
  const select = { id: true, title: true, archivedAt: true, activeVersionId: true } as const;
  const modules = moduleIds.length > 0 ? await client.module.findMany({ where: { id: { in: moduleIds } }, select }) : [];
  const sections = sectionIds.length > 0 ? await client.courseSection.findMany({ where: { id: { in: sectionIds } }, select }) : [];
  const known = new Map([...modules, ...sections].map((row) => [row.id, row]));
  // Det som alt står i det publiserte kurset. Et slikt element stopper ikke publiseringen selv om det ikke er publisert:
  // det er tilstanden kurset alt har (kursimporten kan legge en ny seksjon inn som utkast), og utkastet gjør den ikke verre.
  const alreadyInCourse = new Set(liveItems.map((row) => row.moduleId ?? row.sectionId));
  return items.map((item, index) => {
    const refId = item.type === "MODULE" ? item.moduleId : item.sectionId;
    const row = known.get(refId);
    return {
      type: item.type,
      sortOrder: index,
      moduleId: item.type === "MODULE" ? item.moduleId : null,
      sectionId: item.type === "SECTION" ? item.sectionId : null,
      title: row?.title ?? null,
      discussionsEnabled: item.discussionsEnabled !== false,
      archivedAt: row?.archivedAt?.toISOString() ?? null,
      // NYTT i utkastet og uten publisert versjon. Et element som bare står i utkastet, ses ikke av bruk-låsen (den leser
      // kursets liste), så det kan avpubliseres etter at utkastet ble lagret; og velgeren i kursbyggeren tilbyr seksjoner
      // som aldri har vært publisert. I et levende kurs ville deltakerne da møtt noe NYTT som ikke kan åpnes.
      unpublished: row != null && row.activeVersionId == null && !alreadyInCourse.has(refId),
      missing: !row,
    };
  });
}

/** Hvorfor et element i utkastet ikke kan publiseres ut i kurset, eller `null` når det kan. */
function draftItemProblem(item: { missing: boolean; archivedAt: string | null; unpublished: boolean }): "missing" | "archived" | "unpublished" | null {
  if (item.missing) return "missing";
  if (item.archivedAt != null) return "archived";
  return item.unpublished ? "unpublished" : null;
}

/**
 * Utkastet slik kursbyggeren skal vise det: det lagrede, flettet med den publiserte utgaven der et felt er utelatt («som
 * publisert»), og med titlene på elementene. Et element som er arkivert eller borte, merkes: det stopper publiseringen.
 */
async function courseDraftView(courseId: string, draft: CourseDraftRow) {
  const course = await courseRepository.findCourseById(courseId);
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  const payload = readCourseDraftPayload(draft);
  // Navnet på den som lagret sist, til linja «Utkast lagret av …» i kursbyggeren. Forfatternavn, ikke deltakerdata.
  const savedBy = draft.updatedById ? await prisma.user.findUnique({ where: { id: draft.updatedById }, select: { name: true } }) : null;
  return {
    id: draft.id,
    revision: draft.revision,
    source: draft.source,
    updatedById: draft.updatedById,
    updatedByName: savedBy?.name ?? null,
    updatedAt: draft.updatedAt.toISOString(),
    course: {
      title: payload.title ? localizedTextCodec.serialize(payload.title) : course.title,
      description: payload.description ? localizedTextCodec.serialize(payload.description) : course.description,
      certificationLevel: payload.certificationLevel ? localizedTextCodec.serialize(payload.certificationLevel) : course.certificationLevel,
      enrollmentPolicy: payload.enrollmentPolicy ?? course.enrollmentPolicy,
      discussionsEnabled: payload.discussionsEnabled ?? course.discussionsEnabled,
      discussionOwnerNotifications: payload.discussionOwnerNotifications ?? course.discussionOwnerNotifications,
      sortOrder: payload.sortOrder !== undefined ? payload.sortOrder : course.sortOrder ?? null,
      themeIds: payload.themeIds ?? (await findThemeIdsForCourse(courseId)),
    },
    items: await describeCourseDraftItems(prisma, payload.items, await courseRepository.findAllCourseItems(courseId)),
  };
}

// Lesingen er åpen for alle forfattere, som kursdetaljen og `GET …/items` (produkteier 2026-09-07: størst mulig deling).
adminCoursesRouter.get("/:courseId/draft", async (request, response, next) => {
  try {
    const draft = await findCourseDraft(prisma, request.params.courseId);
    if (!draft) throw new NotFoundError("CourseDraft", "course_draft_not_found", "This course has no draft.");
    response.json({ draft: await courseDraftView(request.params.courseId, draft) });
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.put("/:courseId/draft", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  const parsed = saveCourseDraftBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const { loaded, ...payload } = parsed.data;
    const draft = await saveCourseDraft({
      courseId: request.params.courseId,
      payload,
      loaded,
      actorId: request.context?.userId,
      // Samme sjekker som lagringen av et kurs gjør: ingen dobbel, ingenting arkivert eller borte, og temaene finnes. En feil
      // kommer da ved lagring av utkastet, og ikke først når det publiseres.
      checkUsable: async (tx) => {
        await assertCourseItemsUsable(tx, payload.items);
        if (payload.themeIds) await assertCourseThemesExist(tx, payload.themeIds);
      },
    });
    response.json({ draft: await courseDraftView(request.params.courseId, draft) });
  } catch (error) {
    next(error);
  }
});

// Forkast: utkastet fana lastet, som `?draftId=…&revision=…` (en DELETE har ingen kropp). Har noen andre lagret siden,
// `409 course_draft_changed`, og ingenting er forkastet.
adminCoursesRouter.delete("/:courseId/draft", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  const loaded = loadedCourseDraftSchema.safeParse({ draftId: request.query.draftId, revision: Number(request.query.revision) });
  if (!loaded.success) {
    response.status(400).json({ error: "validation_error", issues: loaded.error.issues });
    return;
  }
  try {
    await discardCourseDraft(request.params.courseId, loaded.data, request.context?.userId);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

// «Publiser utkastet»: skriver utkastet til kurset med den vanlige lagringen (`updateCourse`: felt, tema, liste, versjon og
// e-post avgjøres som ved `PUT …/content`) og sletter utkastet, i ÉN transaksjon. Feiler noe, står begge som før.
//   - Lista endret og noen har kursbevis: forfatterens svar kreves (`400 course_version_required`), som ved direkte lagring.
//   - Et element som er arkivert eller borte siden utkastet ble lagret: `400 course_draft_item_unusable`, med navnene.
//   - Et tema som er slettet siden utkastet ble lagret, tas bort (det stopper ikke publiseringen).
adminCoursesRouter.post("/:courseId/draft/publish", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  const parsed = publishCourseDraftBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const courseId = request.params.courseId;
    const actorId = request.context?.userId;
    const course = await publishCourseDraft({
      courseId,
      loaded: parsed.data.loaded,
      actorId,
      apply: async (tx, draft) => {
        const payload = readCourseDraftPayload(draft);
        const liveItems = await createCourseRepository(tx).findAllCourseItems(courseId);
        const unusable = (await describeCourseDraftItems(tx, payload.items, liveItems)).flatMap((item) => {
          const reason = draftItemProblem(item);
          return reason ? [{ type: item.type, id: item.moduleId ?? item.sectionId, title: item.title, reason }] : [];
        });
        if (unusable.length > 0) {
          throw new DomainRuleError(
            "course_draft_item_unusable",
            "One or more items in the draft are archived, deleted or not published. Publish them or take them out of the draft, and publish again; nothing was published.",
            { items: unusable },
          );
        }
        const themeIds = payload.themeIds ? await findExistingThemeIds(tx, payload.themeIds) : undefined;
        // Ingen `expectedRevision`: mens utkastet finnes, stopper låsen alt annet som øker kursets teller, så kurset er
        // som da utkastet ble laget.
        return updateCourse(courseId, { ...courseFieldsFromBody(payload), themeIds }, actorId, {
          items: payload.items,
          version: parsed.data.version,
          confirmEmailRecipients: parsed.data.confirmEmailRecipients,
          publishingDraft: true,
        }, tx);
      },
    });
    response.json({ course });
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.put("/:courseId/modules", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  const parsed = setCourseModulesBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  try {
    // #934 skive 4a: uten telleren bare på et kurs som aldri har vært ute (sjekkes etter innholdslåsen).
    await setCourseModules(request.params.courseId, parsed.data.modules, undefined, request.context?.userId, undefined, {
      expected: parsed.data.expectedRevision,
      requireUnlessDraft: true,
    });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Mixed item ordering — modules and learning sections interleaved (#486/B2).
// #943: samme vakt som søsteren `PUT /items` og som detaljruta over — kursbyggeren er det eneste
// kallstedet, og den åpnes bare for en eier.
adminCoursesRouter.get("/:courseId/items", async (request, response, next) => {
  try {
    // #958: forfatterlista skal se ALT — den er verktøyet man rydder opp arkivert innhold MED.
    // ⚠️ `archivedAt` sendes videre og regelen overlates til klienten. Det er fortsatt en åpen
    // flate (#992: kursbyggeren tilbyr arkiverte seksjoner backend avviser), men det er en
    // klientside-regel og hører ikke i denne aksessoren.
    const items = await courseRepository.findAllCourseItems(request.params.courseId);
    response.json({
      items: items.map((item) => ({
        id: item.id,
        type: item.itemType,
        sortOrder: item.sortOrder,
        moduleId: item.moduleId,
        sectionId: item.sectionId,
        title: item.module?.title ?? item.section?.title ?? null,
        discussionsEnabled: item.discussionsEnabled,
        archivedAt:
          (item.module?.archivedAt ?? item.section?.archivedAt)?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.put("/:courseId/items", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  const parsed = setCourseItemsBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    // AA-3 (#651): agent-token-requests kan kun endre item-sekvensen på UPUBLISERTE
    // kurs — å endre et publisert kurs er en live-endring utenfor draft-scopet.
    if (request.context?.agentToken) {
      const course = await courseRepository.findCourseById(request.params.courseId);
      if (course?.publishedAt) {
        response.status(403).json({
          error: "agent_token_scope",
          message: "Agent tokens may only set items on unpublished (draft) courses.",
        });
        return;
      }
    }
    await setCourseItems(request.params.courseId, parsed.data.items, {
      actorId: request.context?.userId,
      agent: { agentRunId: parsed.data.agentRunId },
      // #934 skive 4a: overgangen fra 2.129.0 er borte. Uten svar avvises endringen når noen har kursbevis.
      versionRequest: { kind: "question", answer: parsed.data.version, confirmEmailRecipients: parsed.data.confirmEmailRecipients },
      // #934 skive 4a: uten telleren bare på et kurs som aldri har vært ute — agent-tokenet, og et nytt kurs fra
      // skjemaet. En gammel fane på et kurs som har vært ute, avvises før noe skrives.
      revision: { expected: parsed.data.expectedRevision, requireUnlessDraft: true },
    });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

// #734: preview the unpublished modules/sections in a course before publishing, and whether each is
// currently publishable. The UI calls this before opening the cascade-publish confirm dialog. Read-
// only; agent tokens cannot reach it (not in the agent-token allowlist — enforceAgentTokenScope).
// #943: vaktet som `POST /publish` den er forspillet til. Uten vakta kunne enhver SMO lese hvilke
// elementer i et fremmed kurs som ennå er UPUBLISERTE — altså hva eieren holder tilbake.
adminCoursesRouter.get("/:courseId/publish-preview", async (request, response, next) => {
  try {
    const preview = await getCoursePublishPreview(request.params.courseId);
    response.json(preview);
  } catch (error) {
    next(error);
  }
});

// #734: publishing a course must not leave it containing unavailable content (invariant I1). If the
// course has unpublished modules/sections the caller must opt in to cascade-publishing them via
// `{ publishItems: true }`; otherwise we return 409 with the unpublished-item preview so the UI can
// ask the author to confirm. If any unpublished item cannot be published we return 422 with the
// blockers and publish nothing. Agent tokens cannot publish (publish endpoints are outside the
// agent-token allowlist — this route is unchanged in that respect).
const publishCourseBodySchema = z.object({
  publishItems: z.boolean().optional(),
  // #934 skive 3: mindre eller hovedversjon når nytt innhold går live i et kurs som har vært ute og har kursbevis.
  courseVersion: z.enum(["major", "minor"]).optional(),
  confirmEmailRecipients: confirmEmailRecipientsSchema,
});

adminCoursesRouter.post("/:courseId/publish",requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  const parsed = publishCourseBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  const publishItems = parsed.data.publishItems === true;

  try {
    const preview = await getCoursePublishPreview(request.params.courseId);

    const askForCascade = (unpublishedItems: unknown, publishable: boolean) => {
      response.status(409).json({
        error: "course_has_unpublished_items",
        message: "The course has unpublished items. Confirm cascade publish with { publishItems: true }.",
        unpublishedItems,
        publishable,
      });
    };

    // No unpublished items — plain publish (unchanged happy path; still enforces G1: ≥1 module).
    // #934 skive 4a: forhåndsvisningen over er regnet ut før innholdslåsen. `publishCourseChecked` ser på nytt etter
    // den; har noen lagt et upublisert element inn i mellomtiden, får forfatteren samme spørsmål som her under.
    if (preview.allPublished) {
      try {
        const course = await publishCourseChecked(request.params.courseId, request.context?.userId);
        response.json({ course, publishedItems: [] });
      } catch (error) {
        if (error instanceof AppError && error.code === "course_has_unpublished_items") {
          const details = error.details as { unpublishedItems?: unknown; publishable?: boolean } | undefined;
          askForCascade(details?.unpublishedItems ?? [], details?.publishable ?? false);
          return;
        }
        throw error;
      }
      return;
    }

    // Unpublished items exist but the caller has not opted into cascade — ask for confirmation.
    if (!publishItems) {
      askForCascade(preview.unpublishedItems, preview.publishable);
      return;
    }

    // Cascade requested: publish items then the course. publishCourseCascade throws a 422 AppError if
    // any item is un-publishable, and never publishes the course unless every item succeeded.
    const result = await publishCourseCascade(request.params.courseId, request.context?.userId, parsed.data.courseVersion, {
      confirmEmailRecipients: parsed.data.confirmEmailRecipients,
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

// 2.101.0: nye versjoner som ligger klar i kurset (etter en kursoppdatering, #1095, eller lagret
// én og én), med det revisjonsspørsmålet trenger: hvor mange som har bestått hvilke moduler. Lesingen
// er vaktet som publiseringen den er forspillet til (#943).
adminCoursesRouter.get("/:courseId/pending-versions", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  try {
    const pending = await getCoursePendingVersions(request.params.courseId, {
      userId: request.context?.userId ?? "",
      roles: request.context?.roles ?? [],
    });
    // #934 skive 5a-3: `affectedCourses`. Titlene lokaliseres her, som i de andre rutene.
    const locale = requestLocale(request);
    response.json({ ...pending, affectedCourses: pending.affectedCourses.map((course) => ({ ...course, title: localizeContentText(locale, course.title) ?? course.title })) });
  } catch (error) {
    next(error);
  }
});

// 2.101.0: publiser alle. `versionIds` er versjonene forfatteren så i dialogen; et annet sett gir
// 409. `supersedesEarlierPasses` er ETT svar for alle modulene, og kreves når noen har bestått.
const publishPendingBodySchema = z.object({
  versionIds: z.array(z.string().min(1)).max(1000),
  supersedesEarlierPasses: z.boolean().optional(),
  // #934 skive 3: mindre eller hovedversjon for kurset. Utelatt = mindre (standarden).
  courseVersion: z.enum(["major", "minor"]).optional(),
  confirmEmailRecipients: confirmEmailRecipientsSchema,
});

adminCoursesRouter.post("/:courseId/publish-pending", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  const parsed = publishPendingBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const result = await publishCoursePendingVersions(
      request.params.courseId,
      { userId: request.context?.userId ?? "", roles: request.context?.roles ?? [] },
      parsed.data,
    );
    response.json(result);
  } catch (error) {
    next(error);
  }
});

// #934 skive 5a-3: «Publiser nye versjoner» med svar per kurs. Svar for alle berørte kurs, listet i `affectedCourses` over.
// Agent-tokenet slipper ikke til.
adminCoursesRouter.post("/:courseId/publish-pending-versioned", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  const parsed = publishPendingVersionedBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const result = await publishCoursePendingVersioned(
      request.params.courseId,
      { userId: request.context?.userId ?? "", roles: request.context?.roles ?? [] },
      parsed.data,
    );
    response.json(result);
  } catch (error) {
    next(error);
  }
});

// #705: avpubliser et kurs (motstykke til publish). G3-vakt (påbegynt deltaker) i kommandolaget.
adminCoursesRouter.post("/:courseId/unpublish", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  try {
    const course = await unpublishCourse(request.params.courseId, request.context?.userId);
    response.json({ course });
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.post("/:courseId/archive", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  try {
    const course = await archiveCourse(request.params.courseId, request.context?.userId);
    response.json({ course });
  } catch (error) {
    next(error);
  }
});

// #673: gjenopprett et arkivert kurs.
adminCoursesRouter.post("/:courseId/restore", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  try {
    const course = await restoreCourse(request.params.courseId, request.context?.userId);
    response.json({ course });
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.delete("/:courseId", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  try {
    await deleteCourse(request.params.courseId, request.context?.userId);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

// #762: ADMINISTRATOR-only destructive cleanup — delete a course together with the modules/sections
// it exclusively owns. The admin_content mount already lets SMO+ADMIN in; this per-route
// ADMINISTRATOR gate is the extra guard because the action can destroy content, not just a course.
// #962: bruker det delte settet i stedet for sin egen streng. Uendret betydning.
function isAdministrator(roles: AppRoleType[] | undefined): boolean {
  return hasAnyRole(roles, ADMIN_ONLY);
}

// Read-only preview of what would be deleted, spared (shared with other courses), or block the
// operation (course completions, or an exclusive module with submissions/certifications).
adminCoursesRouter.get("/:courseId/cascade-delete-preview", async (request, response, next) => {
  if (!isAdministrator(request.context?.roles)) {
    response.status(403).json({ error: "forbidden", message: "Only ADMINISTRATOR can preview a course cascade delete." });
    return;
  }
  try {
    const preview = await getCourseCascadeDeletePreview(request.params.courseId);
    response.json(preview);
  } catch (error) {
    next(error);
  }
});

// Run the cascade. All-or-nothing: if any blocker exists the service throws a ValidationError (400)
// carrying the blockers in `details` and deletes nothing; otherwise 200 with the delete summary.
adminCoursesRouter.post("/:courseId/cascade-delete", async (request, response, next) => {
  // #787 slice 4b: NOT ownership-guarded — cascade-delete is deliberately ADMINISTRATOR-only (it can
  // destroy modules/sections beyond the course itself), enforced by the isAdministrator check below.
  if (!isAdministrator(request.context?.roles)) {
    response.status(403).json({ error: "forbidden", message: "Only ADMINISTRATOR can cascade-delete a course." });
    return;
  }
  // #934 skive 4a: det forhåndsvisningen sa ville bli slettet. Stemmer det ikke etter innholdslåsen, 409 og
  // ingenting slettet. KREVES: uten det kunne en delt seksjon som nettopp ble eksklusiv, slettes uten at
  // administratoren så det — en eldre fane (som ikke sender det) får `409 course_form_outdated` før noe skjer.
  const expected = z
    .object({
      expectedDeletedModuleIds: z.array(z.string().min(1)).max(1000).optional(),
      expectedDeletedSectionIds: z.array(z.string().min(1)).max(1000).optional(),
    })
    .safeParse(request.body ?? {});
  if (!expected.success) {
    response.status(400).json({ error: "validation_error", issues: expected.error.issues });
    return;
  }
  try {
    if (expected.data.expectedDeletedModuleIds === undefined || expected.data.expectedDeletedSectionIds === undefined) {
      throw courseFormOutdatedError();
    }
    const summary = await cascadeDeleteCourse(request.params.courseId, request.context?.userId, {
      deletedModuleIds: expected.data.expectedDeletedModuleIds,
      deletedSectionIds: expected.data.expectedDeletedSectionIds,
    });
    response.json(summary);
  } catch (error) {
    next(error);
  }
});

// #496/EN-2: enrollment management (SMO/ADMINISTRATOR — gated by the /api/admin/content mount).
const assignEnrollmentsSchema = z
  .object({
    userIds: z.array(z.string().min(1)).optional(),
    department: z.string().trim().min(1).optional(),
    dueAt: z.string().datetime().nullish(),
  })
  .refine((v) => (v.userIds?.length ?? 0) > 0 || !!v.department, {
    message: "Provide userIds or a department.",
  });

// #903 follow-up: POST and DELETE on this path were guarded, GET was not - and it returns
// participant names, e-mail, department, deadline and progress. Any SMO could read another
// owner's participant list by taking the course ID from the shared course list.
adminCoursesRouter.get("/:courseId/enrollments", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  try {
    const enrollments = await listCourseEnrollments(request.params.courseId);
    response.json({ enrollments });
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.post("/:courseId/enrollments", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  const parsed = assignEnrollmentsSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const result = await assignEnrollments(
      request.params.courseId,
      {
        userIds: parsed.data.userIds,
        department: parsed.data.department ?? null,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      },
      request.context?.userId ?? null,
    );
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.delete("/:courseId/enrollments/:userId", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  try {
    await revokeEnrollment(request.params.courseId, request.params.userId, request.context?.userId ?? null);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

export { adminCoursesRouter };
