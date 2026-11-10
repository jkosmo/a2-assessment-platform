// #1145: kursbevis for kurs tatt utenfor plattformen, registrert av administrator (doc/design/PLAN_1145.md).
//
// Den ENE veien inn for `source = "external"`. Kalles bare fra `POST /api/admin/platform/course-completions/external`.
// Hver person får sin egen transaksjon under innholdslåsen (delt) og deltakerlåsen, som utstedelsen på plattformen:
//   - innholdslåsen: en ny hovedversjon kan ikke komme midt i, så beviset gjelder den versjonen kurset faktisk har;
//   - deltakerlåsen: en utstedelse på plattformen for samme person kan ikke skje samtidig.
// Er låsen opptatt (`content_busy`), blir utfallet `busy` for den personen, og resten fortsetter. Kallet er idempotent:
// kjøres det på nytt, blir det som alt er registrert `exists`.
import { prisma } from "../../db/prisma.js";
import { runContentReadForLearner } from "../../db/contentLock.js";
import { AppError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { createCourseRepository } from "./courseRepository.js";
import { isReachableParticipant } from "../user/participantReach.js";

export type ExternalCompletionOutcome =
  | "created"
  | "would_create"
  | "exists"
  | "exists_older_version"
  | "exists_related_course"
  | "not_reachable"
  | "unknown_user"
  | "busy";

export type ExternalCompletionResult = { userId: string; outcome: ExternalCompletionOutcome; certificateId?: string };

export type RegisterExternalCompletionsInput = {
  actorId: string;
  courseId: string;
  userIds: string[];
  reference: string;
  dryRun: boolean;
  /** Andre kurs (f.eks. en arkivert kopi med samme tittel) der et bevis også betyr at personen har tatt kurset. */
  relatedCourseIds?: string[];
};

export class ExternalCompletionCourseError extends AppError {
  constructor(code: "course_not_found" | "course_not_published", message: string) {
    super(code, code === "course_not_found" ? 404 : 409, message);
  }
}

export async function registerExternalCompletions(input: RegisterExternalCompletionsInput): Promise<{
  course: { id: string; versionMajor: number; versionMinor: number };
  results: ExternalCompletionResult[];
}> {
  const course = await prisma.course.findUnique({
    where: { id: input.courseId },
    select: { id: true, publishedAt: true, archivedAt: true, versionMajor: true, versionMinor: true },
  });
  if (!course) throw new ExternalCompletionCourseError("course_not_found", "Course not found.");
  if (!course.publishedAt || course.archivedAt) {
    throw new ExternalCompletionCourseError("course_not_published", "Only a published, non-archived course can be registered.");
  }

  const results: ExternalCompletionResult[] = [];
  for (const userId of input.userIds) {
    try {
      results.push(await registerOne(input, userId));
    } catch (error) {
      if (error instanceof AppError && error.code === "content_busy") {
        results.push({ userId, outcome: "busy" });
        continue;
      }
      throw error;
    }
  }
  return { course: { id: course.id, versionMajor: course.versionMajor, versionMinor: course.versionMinor }, results };
}

async function registerOne(input: RegisterExternalCompletionsInput, userId: string): Promise<ExternalCompletionResult> {
  return runContentReadForLearner(userId, async (locked) => {
    // Alt måles på nytt under låsene: kurset kan ha fått ny versjon eller blitt avpublisert siden kontrollen over.
    const course = await locked.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, publishedAt: true, archivedAt: true, versionMajor: true, versionMinor: true },
    });
    if (!course || !course.publishedAt || course.archivedAt) {
      throw new ExternalCompletionCourseError("course_not_published", "Only a published, non-archived course can be registered.");
    }

    const user = await locked.user.findUnique({ where: { id: userId }, select: { id: true, activeStatus: true, isAnonymized: true } });
    if (!user) return { userId, outcome: "unknown_user" as const };
    if (!isReachableParticipant(user)) return { userId, outcome: "not_reachable" as const };

    // Et bevis for en hvilken som helst hovedversjon betyr at kurset er tatt (som `deriveStatus`). Gjeldende versjon og eldre
    // skilles i rapporten, så produkteier ser hvem som bare har en eldre.
    const existing = await locked.courseCompletion.findMany({
      where: { userId, courseId: course.id },
      select: { versionMajor: true, certificateId: true },
    });
    const current = existing.find((c) => c.versionMajor === course.versionMajor);
    if (current) return { userId, outcome: "exists" as const, certificateId: current.certificateId };
    if (existing.length > 0) return { userId, outcome: "exists_older_version" as const };

    const related = input.relatedCourseIds?.filter((id) => id !== course.id) ?? [];
    if (related.length > 0) {
      const onRelated = await locked.courseCompletion.count({ where: { userId, courseId: { in: related } } });
      if (onRelated > 0) return { userId, outcome: "exists_related_course" as const };
    }

    if (input.dryRun) return { userId, outcome: "would_create" as const };

    const completion = await createCourseRepository(locked).createExternalCourseCompletion(locked, {
      userId,
      courseId: course.id,
      version: { major: course.versionMajor, minor: course.versionMinor },
      registeredById: input.actorId,
      externalReference: input.reference,
    });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: course.id,
        action: auditActions.course.completionRegisteredExternal,
        actorId: input.actorId,
        metadata: {
          userId,
          courseId: course.id,
          certificateId: completion.certificateId,
          versionMajor: course.versionMajor,
          reference: input.reference,
        },
      },
      locked,
    );
    return { userId, outcome: "created" as const, certificateId: completion.certificateId };
  });
}
