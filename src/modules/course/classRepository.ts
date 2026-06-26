import { prisma } from "../../db/prisma.js";

// #645/CL-1: persistence for classes (cohorts) — CRUD, membership, and course-to-class assignment.
// Business rules (authz, dynamic membership evaluation, audit) live in the service layer (CL-2).

// The built-in "Alle deltakere" class, seeded by the migration. Its membership is all PARTICIPANT
// users, resolved dynamically by the service — it has no ClassMember rows.
export const SYSTEM_ALL_PARTICIPANTS_CLASS_ID = "cls_all_participants";

type ClassRepositoryClient = Pick<typeof prisma, "class" | "classMember" | "courseGroupAssignment">;

export interface CreateClassInput {
  name: string;
  description?: string | null;
  createdById: string | null;
}

export function createClassRepository(client: ClassRepositoryClient = prisma) {
  return {
    createClass(input: CreateClassInput) {
      return client.class.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          kind: "MANUAL",
          createdById: input.createdById,
        },
        select: { id: true, name: true, description: true, kind: true, isSystem: true, archivedAt: true },
      });
    },

    updateClass(classId: string, data: { name?: string; description?: string | null }) {
      return client.class.update({
        where: { id: classId },
        data,
        select: { id: true, name: true, description: true, kind: true, isSystem: true, archivedAt: true },
      });
    },

    archiveClass(classId: string) {
      return client.class.update({ where: { id: classId }, data: { archivedAt: new Date() } });
    },

    findClassById(classId: string) {
      return client.class.findUnique({ where: { id: classId } });
    },

    // Non-archived classes, system classes first, then newest.
    listClasses() {
      return client.class.findMany({
        where: { archivedAt: null },
        orderBy: [{ isSystem: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          name: true,
          description: true,
          kind: true,
          entraGroupId: true,
          isSystem: true,
          _count: { select: { members: true, courseAssignments: true } },
        },
      });
    },

    // Idempotent add (re-adding an existing member is a no-op).
    addMember(classId: string, userId: string, addedById: string | null) {
      return client.classMember.upsert({
        where: { classId_userId: { classId, userId } },
        create: { classId, userId, addedById },
        update: {},
      });
    },

    removeMember(classId: string, userId: string) {
      return client.classMember.deleteMany({ where: { classId, userId } });
    },

    listMembers(classId: string) {
      return client.classMember.findMany({
        where: { classId },
        orderBy: { addedAt: "desc" },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
    },

    findManualMembership(userId: string) {
      return client.classMember.findMany({ where: { userId }, select: { classId: true } });
    },

    // Assign a course to a class (idempotent on the course+class pair; updates the due date).
    assignCourseToClass(courseId: string, classId: string, dueAt: Date | null, assignedById: string | null) {
      return client.courseGroupAssignment.upsert({
        where: { courseId_classId: { courseId, classId } },
        create: { courseId, classId, dueAt, assignedById },
        update: { dueAt },
      });
    },

    unassignCourseFromClass(courseId: string, classId: string) {
      return client.courseGroupAssignment.deleteMany({ where: { courseId, classId } });
    },

    listClassAssignmentsForCourse(courseId: string) {
      return client.courseGroupAssignment.findMany({
        where: { courseId },
        include: { class: { select: { id: true, name: true, isSystem: true, archivedAt: true } } },
      });
    },

    listCourseAssignmentsForClass(classId: string) {
      return client.courseGroupAssignment.findMany({
        where: { classId },
        orderBy: { createdAt: "desc" },
        include: { course: { select: { id: true, title: true } } },
      });
    },
  };
}

export const classRepository = createClassRepository();
