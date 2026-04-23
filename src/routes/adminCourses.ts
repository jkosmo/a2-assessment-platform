import { Router } from "express";
import { z } from "zod";
import {
  createCourse,
  updateCourse,
  publishCourse,
  archiveCourse,
  setCourseModules,
  deleteCourse,
  courseRepository,
} from "../modules/course/index.js";
import { localizedTextPatchSchema } from "../modules/adminContent/adminContentSchemas.js";
import { localizedTextCodec } from "../codecs/localizedTextCodec.js";
import { NotFoundError } from "../errors/AppError.js";
import type { AdminCourseListItem, AdminCourseDetail } from "../modules/course/index.js";

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

adminCoursesRouter.get("/", async (_request, response, next) => {
  try {
    const courses = await courseRepository.listCourses();
    const items: AdminCourseListItem[] = courses.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      certificationLevel: c.certificationLevel,
      moduleCount: c._count.modules,
      publishedAt: c.publishedAt?.toISOString() ?? null,
      archivedAt: c.archivedAt?.toISOString() ?? null,
    }));
    response.json({ courses: items });
  } catch (error) {
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

export { adminCoursesRouter };
