import { prisma } from "../../db/prisma.js";
import { NotFoundError } from "../../errors/AppError.js";
import { resolveCourseAudience } from "./cohortStatusService.js";
import { classRepository } from "./classRepository.js";
import { findActiveParticipants } from "../../repositories/userRepository.js";
import { isReachableParticipant } from "../user/participantReach.js";

// #1164 (produkteier 14.11.2026): «Publiser» og «Publiser utkastet» på et kurs spør før publiseringen, og dialogen sier hvem
// som ser kurset etterpå. Det regnes her, på tjeneren, ikke i klienten.
//
// - Et ÅPENT kurs ser alle deltakere. Tallet er ikke med: «alle deltakere» er svaret, og et tall ville bare vært en
//   øyeblikksverdi av noe som vokser.
// - Et BEGRENSET kurs ser de tildelte: klassene (aktive; en arkivert klasse gir ikke et nytt kurs til noen), med antall
//   medlemmer som kan nås (samme regel som publikummet, `isReachableParticipant`), og de enkeltvis tildelte. `totalCount` er
//   publikummet regnet ETT sted, `resolveCourseAudience` (#969), der en person i flere klasser telles én gang.
//
// `policy`: synligheten som gjelder etter publiseringen, når den ikke er kursets egen — ved «Publiser utkastet» synligheten i
// kursets lagrede utkast (#1140). Ruta leser utkastet (courseDraft.ts har én tolk, og bare rutene og noen få andre leser det,
// test/course-draft-guard.test.js); denne fila rører det ikke.

export type CoursePublishAudience =
  | { policy: "OPEN" }
  | {
      policy: "RESTRICTED";
      classes: Array<{ id: string; name: string; isSystem: boolean; memberCount: number }>;
      individualCount: number;
      totalCount: number;
    };

export async function getCoursePublishAudience(courseId: string, options: { policy?: "OPEN" | "RESTRICTED" } = {}): Promise<CoursePublishAudience> {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, enrollmentPolicy: true } });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");

  const policy = options.policy ?? course.enrollmentPolicy;
  if (policy === "OPEN") return { policy: "OPEN" };

  const assignments = await classRepository.findCourseGroupAssignmentsForCourse(courseId);
  let allParticipants: number | null = null;
  const classes: Array<{ id: string; name: string; isSystem: boolean; memberCount: number }> = [];
  for (const assignment of assignments) {
    // #1017: ingen ENTRA-klasser kan opprettes i dag; medlemmene kan ikke slås opp (som i publikummet).
    if (assignment.class.kind === "ENTRA") continue;
    const memberCount = assignment.class.isSystem
      ? (allParticipants ??= (await findActiveParticipants()).length)
      : assignment.class.members.filter((member) => isReachableParticipant(member.user)).length;
    classes.push({ id: assignment.class.id, name: assignment.class.name, isSystem: assignment.class.isSystem, memberCount });
  }
  classes.sort((a, b) => a.name.localeCompare(b.name, "nb", { numeric: true, sensitivity: "base" }));

  const audience = await resolveCourseAudience(courseId);
  return {
    policy: "RESTRICTED",
    classes,
    individualCount: audience.filter((member) => member.source === "individual").length,
    totalCount: audience.length,
  };
}
