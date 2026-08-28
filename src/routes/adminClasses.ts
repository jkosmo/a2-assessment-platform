import { Router, type Request } from "express";
import { requireContentOwnership } from "./requireContentOwnership.js";
import { listManageableContentIds } from "../modules/content/contentOwnershipService.js";
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

adminClassesRouter.get("/", async (request, response, next) => {
  try {
    const classes = await listClasses();
    // #787 slice 5: annotate each class with whether the viewer may manage it (admin or owner), so the
    // list hides the archive/restore/manage actions the ownership guard would 403 on. System classes are
    // unowned, so only an administrator manages them — which is the existing behaviour.
    const manageable = await listManageableContentIds({
      contentType: "CLASS",
      contentIds: classes.map((c) => c.id),
      actorUserId: request.context?.userId ?? "",
      roles: request.context?.roles ?? [],
    });
    response.json({ classes: classes.map((c) => ({ ...c, canManage: manageable.has(c.id) })) });
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

adminClassesRouter.delete("/:classId", requireContentOwnership("CLASS", "classId"), async (request: Request<{ classId: string }>, response, next) => {
  try {
    await archiveClass(request.params.classId, request.context?.userId ?? null);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

adminClassesRouter.post("/:classId/restore", requireContentOwnership("CLASS", "classId"), async (request: Request<{ classId: string }>, response, next) => {
  try {
    await restoreClass(request.params.classId, request.context?.userId ?? null);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// #943 (samme klasse, én ruter bortenfor det saken navnga): begge skriverutene på `/members` var
// vaktet, lesingen var ikke. ⚠️ Og lesingen er den som lekker: den gir NAVN og E-POST til hvert
// medlem av en hvilken som helst klasse. Nøyaktig det hullet #903-oppfølgingen lukket for
// `/:courseId/enrollments` — det sto fortsatt åpent her.
//
// Trygt å stramme: «Administrer» er eneste vei inn i `openClass`, og den knappen rendres bare når
// `canManage` er sann. Systemklasser er ueide og forvaltes dermed bare av administrator, som før.
adminClassesRouter.get("/:classId/members", requireContentOwnership("CLASS", "classId"), async (request: Request<{ classId: string }>, response, next) => {
  try {
    response.json({ members: await listClassMembers(request.params.classId) });
  } catch (error) {
    next(error);
  }
});

adminClassesRouter.post("/:classId/members", requireContentOwnership("CLASS", "classId"), async (request: Request<{ classId: string }>, response, next) => {
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

adminClassesRouter.delete("/:classId/members/:userId", requireContentOwnership("CLASS", "classId"), async (request: Request<{ classId: string; userId: string }>, response, next) => {
  try {
    await removeMember(request.params.classId, request.params.userId, request.context?.userId ?? null);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

// #943: makkeren til `/members` — samme skjerm, samme kall, samme vakt. Uten den kunne en fremmed
// SMO lese hvilke kurs en klasse er tildelt, og med hvilke frister.
adminClassesRouter.get("/:classId/courses", requireContentOwnership("CLASS", "classId"), async (request: Request<{ classId: string }>, response, next) => {
  try {
    response.json({ courses: await listClassCourseAssignments(request.params.classId) });
  } catch (error) {
    next(error);
  }
});

adminClassesRouter.post("/:classId/courses", requireContentOwnership("CLASS", "classId"), async (request: Request<{ classId: string }>, response, next) => {
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

adminClassesRouter.delete("/:classId/courses/:courseId", requireContentOwnership("CLASS", "classId"), async (request: Request<{ classId: string; courseId: string }>, response, next) => {
  try {
    await unassignCourseFromClass(request.params.courseId, request.params.classId, request.context?.userId ?? null);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

export { adminClassesRouter };
