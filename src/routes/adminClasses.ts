import { Router, type Request } from "express";
import { z } from "zod";
import {
  createClass,
  archiveClass,
  restoreClass,
  addMember,
  removeMember,
  listClasses,
  listClassMembers,
  listClassCourseAssignments,
  assignCourseToClass,
  unassignCourseFromClass,
} from "../modules/course/index.js";

// #645/CL-2: class (cohort) administration. Mounted under /api/admin/content/classes, so it inherits
// the SMO/ADMINISTRATOR gate from the admin-content router.
const adminClassesRouter = Router();

const createClassSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
});
const addMemberSchema = z.object({ userId: z.string().min(1) });
const assignCourseSchema = z.object({ courseId: z.string().min(1), dueAt: z.string().datetime().nullish() });

adminClassesRouter.get("/", async (_request, response, next) => {
  try {
    response.json({ classes: await listClasses() });
  } catch (error) {
    next(error);
  }
});

adminClassesRouter.post("/", async (request, response, next) => {
  const parsed = createClassSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const klass = await createClass(parsed.data, request.context?.userId ?? null);
    response.status(201).json({ class: klass });
  } catch (error) {
    next(error);
  }
});

adminClassesRouter.delete("/:classId", async (request: Request<{ classId: string }>, response, next) => {
  try {
    await archiveClass(request.params.classId, request.context?.userId ?? null);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

adminClassesRouter.post("/:classId/restore", async (request: Request<{ classId: string }>, response, next) => {
  try {
    await restoreClass(request.params.classId, request.context?.userId ?? null);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

adminClassesRouter.get("/:classId/members", async (request: Request<{ classId: string }>, response, next) => {
  try {
    response.json({ members: await listClassMembers(request.params.classId) });
  } catch (error) {
    next(error);
  }
});

adminClassesRouter.post("/:classId/members", async (request: Request<{ classId: string }>, response, next) => {
  const parsed = addMemberSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    await addMember(request.params.classId, parsed.data.userId, request.context?.userId ?? null);
    response.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

adminClassesRouter.delete("/:classId/members/:userId", async (request: Request<{ classId: string; userId: string }>, response, next) => {
  try {
    await removeMember(request.params.classId, request.params.userId, request.context?.userId ?? null);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

adminClassesRouter.get("/:classId/courses", async (request: Request<{ classId: string }>, response, next) => {
  try {
    response.json({ courses: await listClassCourseAssignments(request.params.classId) });
  } catch (error) {
    next(error);
  }
});

adminClassesRouter.post("/:classId/courses", async (request: Request<{ classId: string }>, response, next) => {
  const parsed = assignCourseSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    await assignCourseToClass(
      parsed.data.courseId,
      request.params.classId,
      parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      request.context?.userId ?? null,
    );
    response.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

adminClassesRouter.delete("/:classId/courses/:courseId", async (request: Request<{ classId: string; courseId: string }>, response, next) => {
  try {
    await unassignCourseFromClass(request.params.courseId, request.params.classId, request.context?.userId ?? null);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

export { adminClassesRouter };
