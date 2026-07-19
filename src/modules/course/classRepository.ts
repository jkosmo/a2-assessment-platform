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

    // #705-family: reverse of archiveClass — clear the soft-archive so the class is active again.
    restoreClass(classId: string) {
      return client.class.update({ where: { id: classId }, data: { archivedAt: null } });
    },

    findClassById(classId: string) {
      return client.class.findUnique({ where: { id: classId } });
    },

    // All classes (active + archived) for the admin list — the frontend filters by Aktive/Arkiverte.
    // System first, then active before archived, then newest. Includes archivedAt so the client can
    // render status and offer archive/restore consistently with the other lifecycle lists (#705).
    listClasses() {
      return client.class.findMany({
        orderBy: [
          { isSystem: "desc" },
          { archivedAt: { sort: "asc", nulls: "first" } },
          { createdAt: "desc" },
        ],
        select: {
          id: true,
          name: true,
          description: true,
          kind: true,
          entraGroupId: true,
          isSystem: true,
          archivedAt: true,
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

    // #498: all class assignments for ONE course (on non-archived classes), with the class kind/isSystem
    // + member users, so the cohort-status dashboard can expand the effective audience. Unlike the
    // reminder reader below, this is course-scoped and NOT filtered on dueAt (the dashboard shows every
    // participant, due or not). ENTRA classes are included but the service skips their (unresolvable)
    // membership; the system "Alle deltakere" class has no rows and is resolved separately.
    findCourseGroupAssignmentsForCourse(courseId: string) {
      return client.courseGroupAssignment.findMany({
        where: { courseId, class: { archivedAt: null } },
        include: {
          class: {
            select: {
              id: true,
              name: true,
              kind: true,
              isSystem: true,
              members: {
                select: {
                  user: {
                    select: { id: true, name: true, email: true, activeStatus: true, isAnonymized: true },
                  },
                },
              },
            },
          },
        },
      });
    },

    // #497 fase 2: class-assigned due dates for the reminder schedule. Only non-null dueAt on a
    // non-archived class. Includes the course (id + localized title) and the class kind/isSystem so
    // the service can expand membership (MANUAL rows are included; the system "Alle deltakere" class
    // has no rows and is resolved separately; ENTRA classes are not resolvable in a background job
    // and are skipped by the service).
    findCourseGroupAssignmentsWithDueDate() {
      return client.courseGroupAssignment.findMany({
        where: { dueAt: { not: null }, class: { archivedAt: null } },
        include: {
          course: { select: { id: true, title: true } },
          class: {
            select: {
              id: true,
              kind: true,
              isSystem: true,
              members: {
                select: {
                  user: {
                    select: { id: true, name: true, email: true, activeStatus: true, isAnonymized: true },
                  },
                },
              },
            },
          },
        },
      });
    },
  };
}

export const classRepository = createClassRepository();
