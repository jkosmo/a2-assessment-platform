// #969: `enrolledParticipants` i kursrapporten skal telle kursets PUBLIKUM (resolveCourseAudience,
// #498), ikke distinkte brukere med innlevering på kursets moduler. Testene her dekker begge
// retninger med vilje:
//
//   - at fullføringsgraden ikke KAN overstige 100 % (scenario B i saken: 12 / 3 = 400 %)
//   - at en ekte 50 % fortsatt rapporteres som 50 %
//
// Uten det andre paret ville «alltid null» eller «alltid 1» bestått den første testen.

import { beforeEach, describe, expect, it, vi } from "vitest";

const findPublishedCoursesWithModuleDetails = vi.fn();
const findCourseCompletionsForLearnerReport = vi.fn();
const countCourseCompletions = vi.fn();
const countDistinctEnrolledUsersForModules = vi.fn();
const countPassedUsersForModule = vi.fn();
const countUsersWithSubmissionsForModule = vi.fn();
const findPassedUserIdsForModule = vi.fn();

const resolveCourseAudience = vi.fn();
const findUserIdsInDepartment = vi.fn();

vi.mock("../../src/modules/course/courseRepository.js", () => ({
  courseRepository: {
    findPublishedCoursesWithModuleDetails,
    findCourseCompletionsForLearnerReport,
    countCourseCompletions,
    countDistinctEnrolledUsersForModules,
    countPassedUsersForModule,
    countUsersWithSubmissionsForModule,
    findPassedUserIdsForModule,
  },
}));

vi.mock("../../src/modules/course/cohortStatusService.js", () => ({
  resolveCourseAudience,
}));

vi.mock("../../src/repositories/userRepository.js", () => ({
  findUserIdsInDepartment,
}));

function course(id: string, moduleIds: string[] = []) {
  return {
    id,
    title: `Course ${id}`,
    modules: moduleIds.map((moduleId, index) => ({
      moduleId,
      sortOrder: index,
      module: { id: moduleId, title: `Module ${moduleId}` },
    })),
  };
}

function audience(...userIds: string[]) {
  return userIds.map((userId) => ({
    userId,
    dueAt: null,
    source: "individual" as const,
    classId: null,
    className: null,
  }));
}

function completions(...userIds: string[]) {
  return userIds.map((userId) => ({
    userId,
    completedAt: new Date("2026-08-01T00:00:00Z"),
    certificateId: `cert-${userId}`,
    user: { id: userId, name: userId, email: `${userId}@example.com`, department: "Legal" },
  }));
}

describe("#969 course report — enrolledParticipants is the course audience", () => {
  beforeEach(() => {
    findPublishedCoursesWithModuleDetails.mockReset();
    findCourseCompletionsForLearnerReport.mockReset().mockResolvedValue([]);
    countCourseCompletions.mockReset().mockResolvedValue(0);
    countDistinctEnrolledUsersForModules.mockReset().mockResolvedValue(0);
    countPassedUsersForModule.mockReset().mockResolvedValue(0);
    countUsersWithSubmissionsForModule.mockReset().mockResolvedValue(0);
    findPassedUserIdsForModule.mockReset().mockResolvedValue([]);
    resolveCourseAudience.mockReset().mockResolvedValue([]);
    findUserIdsInDepartment.mockReset().mockResolvedValue([]);
  });

  // Scenario B i #969: datofilteret slipper fullføringene inn og innleveringene ut.
  it("never reports a completion rate above 100 % when completions outnumber recent submissions", async () => {
    findPublishedCoursesWithModuleDetails.mockResolvedValue([course("course-1", ["module-1"])]);
    // Bare 3 brukere har levert inn i vinduet — den gamle nevneren.
    countDistinctEnrolledUsersForModules.mockResolvedValue(3);
    // ...men 12 fullførte i vinduet, og alle 12 er fortsatt i kursets publikum.
    const learners = Array.from({ length: 12 }, (_, i) => `user-${i}`);
    resolveCourseAudience.mockResolvedValue(audience(...learners));
    findCourseCompletionsForLearnerReport.mockResolvedValue(completions(...learners));

    const { getCourseReport } = await import("../../src/modules/course/courseReport.js");
    const { rows } = await getCourseReport({ dateFrom: new Date("2026-07-22T00:00:00Z") });

    // Med den gamle nevneren ble dette 12 / 3 = 4 — 400 % i CSV-en til ledelsen.
    expect(rows[0].completionRate).toBe(1);
    expect(rows[0].enrolledParticipants).toBe(12);
    expect(rows[0].completedParticipants).toBe(12);
  });

  // Kontrollcase: fiksen må ikke bare ha gjort graden null/1 overalt.
  it("still reports a genuine 50 % as 0.5", async () => {
    findPublishedCoursesWithModuleDetails.mockResolvedValue([course("course-1", ["module-1"])]);
    resolveCourseAudience.mockResolvedValue(
      audience("user-0", "user-1", "user-2", "user-3", "user-4", "user-5", "user-6", "user-7", "user-8", "user-9"),
    );
    findCourseCompletionsForLearnerReport.mockResolvedValue(
      completions("user-0", "user-1", "user-2", "user-3", "user-4"),
    );

    const { getCourseReport } = await import("../../src/modules/course/courseReport.js");
    const { rows } = await getCourseReport();

    expect(rows[0].enrolledParticipants).toBe(10);
    expect(rows[0].completedParticipants).toBe(5);
    expect(rows[0].completionRate).toBe(0.5);
  });

  // Scenario A i #969: et rent lesekurs har ingen moduler, så den gamle nevneren var 0 per
  // kortslutning i countDistinctEnrolledUsersForModules — completionRate ble null selv med 25
  // fullføringer. Publikummet finnes uansett om kurset har moduler eller ikke.
  it("reports a completion rate for a module-free reading course", async () => {
    findPublishedCoursesWithModuleDetails.mockResolvedValue([course("course-1", [])]);
    const learners = Array.from({ length: 25 }, (_, i) => `user-${i}`);
    resolveCourseAudience.mockResolvedValue(audience(...learners));
    findCourseCompletionsForLearnerReport.mockResolvedValue(completions(...learners));

    const { getCourseReport } = await import("../../src/modules/course/courseReport.js");
    const { rows } = await getCourseReport();

    expect(rows[0].enrolledParticipants).toBe(25);
    expect(rows[0].completedParticipants).toBe(25);
    expect(rows[0].completionRate).toBe(1);
    expect(rows[0].moduleBreakdown).toEqual([]);
  });

  // Den som fullførte og SIDEN mistet innmeldingen må fortsatt telle i nevneren, ellers er
  // 1 / 0 tilbake.
  it("counts a completer who has left the audience", async () => {
    findPublishedCoursesWithModuleDetails.mockResolvedValue([course("course-1", ["module-1"])]);
    resolveCourseAudience.mockResolvedValue(audience("still-enrolled"));
    findCourseCompletionsForLearnerReport.mockResolvedValue(completions("revoked-user"));

    const { getCourseReport } = await import("../../src/modules/course/courseReport.js");
    const { rows } = await getCourseReport();

    expect(rows[0].enrolledParticipants).toBe(2);
    expect(rows[0].completedParticipants).toBe(1);
    expect(rows[0].completionRate).toBe(0.5);
  });

  // orgUnit-filteret gjelder telleren (buildCompletionWhere), så det må gjelde nevneren også —
  // ellers blir graden systematisk for lav.
  it("narrows the audience to the requested org unit", async () => {
    findPublishedCoursesWithModuleDetails.mockResolvedValue([course("course-1", ["module-1"])]);
    resolveCourseAudience.mockResolvedValue(audience("legal-1", "legal-2", "sales-1", "sales-2"));
    findUserIdsInDepartment.mockResolvedValue(["legal-1", "legal-2"]);
    findCourseCompletionsForLearnerReport.mockResolvedValue(completions("legal-1"));

    const { getCourseReport } = await import("../../src/modules/course/courseReport.js");
    const { rows } = await getCourseReport({ orgUnit: "Legal" });

    // Uten innsnevringen ville nevneren vært alle fire og graden 0.25.
    expect(rows[0].enrolledParticipants).toBe(2);
    expect(rows[0].completionRate).toBe(0.5);
    expect(findUserIdsInDepartment).toHaveBeenCalledWith(
      ["legal-1", "legal-2", "sales-1", "sales-2"],
      "Legal",
    );
  });

  it("leaves the completion rate null when nobody is in the course at all", async () => {
    findPublishedCoursesWithModuleDetails.mockResolvedValue([course("course-1", ["module-1"])]);

    const { getCourseReport } = await import("../../src/modules/course/courseReport.js");
    const { rows } = await getCourseReport();

    expect(rows[0].enrolledParticipants).toBe(0);
    expect(rows[0].completionRate).toBeNull();
  });

  // Den gamle kilden må være ute av kallveien — ellers kunne fiksen vært «riktig tall, feil grunn».
  it("no longer counts distinct users with submissions as the course audience", async () => {
    findPublishedCoursesWithModuleDetails.mockResolvedValue([course("course-1", ["module-1"])]);
    resolveCourseAudience.mockResolvedValue(audience("user-0", "user-1"));

    const { getCourseReport } = await import("../../src/modules/course/courseReport.js");
    await getCourseReport();

    expect(countDistinctEnrolledUsersForModules).not.toHaveBeenCalled();
  });
});
