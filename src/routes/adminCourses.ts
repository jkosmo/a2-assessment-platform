import { Router } from "express";
import { requireContentOwnership } from "./requireContentOwnership.js";
import { listManageableContentIds } from "../modules/content/contentOwnershipService.js";
import { z } from "zod";
import {
  createCourse,
  updateCourse,
  publishCourse,
  unpublishCourse,
  archiveCourse,
  restoreCourse,
  setCourseModules,
  setCourseItems,
  deleteCourse,
  courseRepository,
  assignEnrollments,
  revokeEnrollment,
  listCourseEnrollments,
  getCoursePublishPreview,
  publishCourseCascade,
  getCourseCascadeDeletePreview,
  cascadeDeleteCourse,
} from "../modules/course/index.js";
import { generationLocaleSchema, importBodySchema, localizedTextPatchSchema, parseRequest, clientRefSchema, agentRunIdSchema } from "../modules/adminContent/adminContentSchemas.js";
import { courseAdminLinks } from "../modules/adminContent/adminUiLinks.js";
import { buildCourseExportEnvelope } from "../modules/adminContent/index.js";
import { importCourseFromEnvelope } from "../modules/adminContent/contentImportService.js";
import { localizedTextCodec } from "../codecs/localizedTextCodec.js";
import { localizeCourseCopy } from "../modules/adminContent/llmContentGenerationService.js";
import { NotFoundError, AppError } from "../errors/AppError.js";
import type { AdminCourseListItem, AdminCourseDetail } from "../modules/course/index.js";
import { countCourseInProgressParticipants } from "../modules/course/contentLifecycle.js";
import { generateLimiter } from "../middleware/rateLimiting.js";

const adminCoursesRouter = Router();

const courseBodySchema = z.object({
  title: localizedTextPatchSchema,
  description: localizedTextPatchSchema.optional(),
  certificationLevel: localizedTextPatchSchema.optional(),
  // #645/#496: course visibility — OPEN (everyone) or RESTRICTED (only enrolled / class-assigned).
  enrollmentPolicy: z.enum(["OPEN", "RESTRICTED"]).optional(),
  // #495/T-QA-4: kurs-master av/på for diskusjon (default true i datamodellen).
  discussionsEnabled: z.boolean().optional(),
});

const setCourseModulesBodySchema = z.object({
  modules: z.array(
    z.object({
      moduleId: z.string().min(1),
      sortOrder: z.number().int().min(0),
    }),
  ),
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

adminCoursesRouter.post("/", async (request, response, next) => {
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
    const items: AdminCourseListItem[] = courses.map((c, i) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      certificationLevel: c.certificationLevel,
      moduleCount: c._count.modules,
      updatedAt: c.updatedAt.toISOString(),
      publishedAt: c.publishedAt?.toISOString() ?? null,
      archivedAt: c.archivedAt?.toISOString() ?? null,
      inProgressCount: inProgressCounts[i],
      canManage: manageable.has(c.id),
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
  const { data, error } = parseRequest(importBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }
  if (data.payload.scope !== "course") {
    response.status(400).json({ error: "scope_mismatch", message: "Envelope scope must be 'course' for this endpoint." });
    return;
  }
  try {
    const envelope = data.payload as unknown as Parameters<typeof importCourseFromEnvelope>[0];
    const result = await importCourseFromEnvelope(envelope, {
      actorId,
      mode: data.mode ?? "createNew",
      targetCourseId: data.targetId,
    });
    // AA-2 (#650): links + clientRef echo make the response agent-orchestrable.
    response.status(201).json({
      courseId: result.courseId,
      moduleIds: result.moduleIds,
      links: courseAdminLinks(result.courseId),
      ...(data.clientRef !== undefined ? { clientRef: data.clientRef } : {}),
    });
  } catch (err) {
    if (err instanceof AppError) {
      response.status(err.httpStatus).json({ error: err.code, message: err.message });
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
      response.status(error.httpStatus).json({ error: error.code, message: error.message });
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
    if (/no (modules|versions|rubric|prompt|MCQ)/i.test(message)) {
      response.status(422).json({ error: "course_not_exportable", message });
      return;
    }
    next(error);
  }
});

adminCoursesRouter.get("/:courseId", async (request, response, next) => {
  try {
    const course = await courseRepository.findCourseById(request.params.courseId);
    if (!course) {
      throw new NotFoundError("Course", "course_not_found", "Course not found.");
    }
    const detail: AdminCourseDetail = {
      id: course.id,
      title: course.title,
      description: course.description,
      certificationLevel: course.certificationLevel,
      enrollmentPolicy: course.enrollmentPolicy,
      discussionsEnabled: course.discussionsEnabled,
      updatedAt: course.updatedAt.toISOString(),
      publishedAt: course.publishedAt?.toISOString() ?? null,
      archivedAt: course.archivedAt?.toISOString() ?? null,
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

adminCoursesRouter.put("/:courseId", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  const parsed = courseBodySchema.partial().safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  try {
    const course = await updateCourse(request.params.courseId, {
      title: parsed.data.title ? localizedTextCodec.serialize(parsed.data.title) : undefined,
      description: parsed.data.description ? localizedTextCodec.serialize(parsed.data.description) : undefined,
      certificationLevel: parsed.data.certificationLevel ? localizedTextCodec.serialize(parsed.data.certificationLevel) : undefined,
      enrollmentPolicy: parsed.data.enrollmentPolicy,
      discussionsEnabled: parsed.data.discussionsEnabled,
    }, request.context?.userId);
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
    await setCourseModules(request.params.courseId, parsed.data.modules);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Mixed item ordering — modules and learning sections interleaved (#486/B2).
adminCoursesRouter.get("/:courseId/items", async (request, response, next) => {
  try {
    const items = await courseRepository.findCourseItems(request.params.courseId);
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
    });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

// #734: preview the unpublished modules/sections in a course before publishing, and whether each is
// currently publishable. The UI calls this before opening the cascade-publish confirm dialog. Read-
// only; agent tokens cannot reach it (not in the agent-token allowlist — enforceAgentTokenScope).
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
const publishCourseBodySchema = z.object({ publishItems: z.boolean().optional() });

adminCoursesRouter.post("/:courseId/publish", requireContentOwnership("COURSE", "courseId"), async (request, response, next) => {
  const parsed = publishCourseBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  const publishItems = parsed.data.publishItems === true;

  try {
    const preview = await getCoursePublishPreview(request.params.courseId);

    // No unpublished items — plain publish (unchanged happy path; still enforces G1: ≥1 module).
    if (preview.allPublished) {
      const course = await publishCourse(request.params.courseId, request.context?.userId);
      response.json({ course, publishedItems: [] });
      return;
    }

    // Unpublished items exist but the caller has not opted into cascade — ask for confirmation.
    if (!publishItems) {
      response.status(409).json({
        error: "course_has_unpublished_items",
        message: "The course has unpublished items. Confirm cascade publish with { publishItems: true }.",
        unpublishedItems: preview.unpublishedItems,
        publishable: preview.publishable,
      });
      return;
    }

    // Cascade requested: publish items then the course. publishCourseCascade throws a 422 AppError if
    // any item is un-publishable, and never publishes the course unless every item succeeded.
    const result = await publishCourseCascade(request.params.courseId, request.context?.userId);
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
function isAdministrator(roles: string[] | undefined): boolean {
  return roles?.includes("ADMINISTRATOR") ?? false;
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
  try {
    const summary = await cascadeDeleteCourse(request.params.courseId, request.context?.userId);
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

adminCoursesRouter.get("/:courseId/enrollments", async (request, response, next) => {
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
