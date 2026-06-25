import { Router } from "express";
import { z } from "zod";
import {
  createCourse,
  updateCourse,
  publishCourse,
  archiveCourse,
  setCourseModules,
  setCourseItems,
  deleteCourse,
  courseRepository,
  assignEnrollments,
  revokeEnrollment,
  listCourseEnrollments,
} from "../modules/course/index.js";
import { generationLocaleSchema, importBodySchema, localizedTextPatchSchema, parseRequest } from "../modules/adminContent/adminContentSchemas.js";
import { buildCourseExportEnvelope } from "../modules/adminContent/index.js";
import { importCourseFromEnvelope } from "../modules/adminContent/contentImportService.js";
import { localizedTextCodec } from "../codecs/localizedTextCodec.js";
import { localizeCourseCopy } from "../modules/adminContent/llmContentGenerationService.js";
import { NotFoundError, AppError } from "../errors/AppError.js";
import type { AdminCourseListItem, AdminCourseDetail } from "../modules/course/index.js";
import { generateLimiter } from "../middleware/rateLimiting.js";

const adminCoursesRouter = Router();

const courseBodySchema = z.object({
  title: localizedTextPatchSchema,
  description: localizedTextPatchSchema.optional(),
  certificationLevel: localizedTextPatchSchema.optional(),
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
      z.object({ type: z.literal("MODULE"), moduleId: z.string().min(1) }),
      z.object({ type: z.literal("SECTION"), sectionId: z.string().min(1) }),
    ]),
  ),
});

const courseLocalizationBodySchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  sourceLocale: generationLocaleSchema,
  targetLocale: generationLocaleSchema,
}).refine((value) => Boolean(value.title || value.description), {
  message: "At least one field is required.",
});

adminCoursesRouter.post("/", async (request, response, next) => {
  const parsed = courseBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  try {
    const course = await createCourse({
      title: localizedTextCodec.serialize(parsed.data.title),
      description: parsed.data.description ? localizedTextCodec.serialize(parsed.data.description) : null,
      certificationLevel: parsed.data.certificationLevel ? localizedTextCodec.serialize(parsed.data.certificationLevel) : null,
      actorId: request.context?.userId,
    });
    response.status(201).json({ course });
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

adminCoursesRouter.get("/", async (_request, response, next) => {
  try {
    const courses = await courseRepository.listCourses();
    const items: AdminCourseListItem[] = courses.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      certificationLevel: c.certificationLevel,
      moduleCount: c._count.modules,
      updatedAt: c.updatedAt.toISOString(),
      publishedAt: c.publishedAt?.toISOString() ?? null,
      archivedAt: c.archivedAt?.toISOString() ?? null,
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
    response.status(201).json({ courseId: result.courseId, moduleIds: result.moduleIds });
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

adminCoursesRouter.put("/:courseId", async (request, response, next) => {
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
    });
    response.json({ course });
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.put("/:courseId/modules", async (request, response, next) => {
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
        archivedAt:
          (item.module?.archivedAt ?? item.section?.archivedAt)?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.put("/:courseId/items", async (request, response, next) => {
  const parsed = setCourseItemsBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    await setCourseItems(request.params.courseId, parsed.data.items);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.post("/:courseId/publish", async (request, response, next) => {
  try {
    const course = await publishCourse(request.params.courseId, request.context?.userId);
    response.json({ course });
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.post("/:courseId/archive", async (request, response, next) => {
  try {
    const course = await archiveCourse(request.params.courseId, request.context?.userId);
    response.json({ course });
  } catch (error) {
    next(error);
  }
});

adminCoursesRouter.delete("/:courseId", async (request, response, next) => {
  try {
    await deleteCourse(request.params.courseId, request.context?.userId);
    response.status(204).send();
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

adminCoursesRouter.post("/:courseId/enrollments", async (request, response, next) => {
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

adminCoursesRouter.delete("/:courseId/enrollments/:userId", async (request, response, next) => {
  try {
    await revokeEnrollment(request.params.courseId, request.params.userId, request.context?.userId ?? null);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

export { adminCoursesRouter };
