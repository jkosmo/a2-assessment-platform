import { prisma } from "../../db/prisma.js";
import type { CourseEnrollmentSource } from "@prisma/client";

// #496/EN-1: persistence for course enrollments (assign / revoke / read). Status is NOT stored here
// - it is derived (see enrollmentStatus.ts) by the service layer (EN-2) from CourseCompletion +
// progress + dueAt.

type EnrollmentRepositoryClient = Pick<typeof prisma, "courseEnrollment">;

export interface AssignEnrollmentInput {
  userId: string;
  courseId: string;
  assignedById: string | null;
  source: CourseEnrollmentSource;
  dueAt: Date | null;
}

export function createEnrollmentRepository(client: EnrollmentRepositoryClient = prisma) {
  return {
    // Idempotent assign: re-assigning an existing (or previously revoked) enrollment updates the
    // due date / source and clears revokedAt, rather than failing on the @@unique(userId,courseId).
    assignEnrollment(input: AssignEnrollmentInput) {
      const data = {
        assignedById: input.assignedById,
        source: input.source,
        dueAt: input.dueAt,
        revokedAt: null,
      };
      return client.courseEnrollment.upsert({
        where: { userId_courseId: { userId: input.userId, courseId: input.courseId } },
        create: { userId: input.userId, courseId: input.courseId, ...data },
        update: { ...data, assignedAt: new Date() },
      });
    },

    // Soft revoke - keep the row for history/audit.
    revokeEnrollment(userId: string, courseId: string) {
      return client.courseEnrollment.updateMany({
        where: { userId, courseId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    findEnrollment(userId: string, courseId: string) {
      return client.courseEnrollment.findUnique({
        where: { userId_courseId: { userId, courseId } },
      });
    },

    // Active (non-revoked) enrollments for a participant.
    findActiveEnrollmentsForUser(userId: string) {
      return client.courseEnrollment.findMany({
        where: { userId, revokedAt: null },
        orderBy: { assignedAt: "desc" },
      });
    },

    // Active enrollments for a course (admin view), newest first, with the participant.
    findActiveEnrollmentsForCourse(courseId: string) {
      return client.courseEnrollment.findMany({
        where: { courseId, revokedAt: null },
        orderBy: { assignedAt: "desc" },
        include: { user: { select: { id: true, name: true, email: true, department: true } } },
      });
    },
  };
}

export const enrollmentRepository = createEnrollmentRepository();
