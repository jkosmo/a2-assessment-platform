import { beforeEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

// #1156 (QA-porten, funn 2): «påbegynt» teller lesinger gjort i et annet kurs (`findSectionReadCredit`). Kullstatusen, påminnelsene
// og påmeldingslistene regnet statusen én deltaker om gangen; med lesing på tvers ble det 7–12 spørringer per person. Nå regnes hele
// kullet i ett kall (`deriveStatuses`). Testene måler at lesingene telles ÉN gang for N deltakere, og at kullstatusen spør én gang.

const findSectionReadCredit = vi.fn();
vi.mock("../../src/modules/course/sectionReadCredit.js", () => ({ findSectionReadCredit }));

const queries: Record<string, number> = {};
const count = (table: string) => {
  queries[table] = (queries[table] ?? 0) + 1;
};
const prismaHolder = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("../../src/db/prisma.js", () => ({ prisma: prismaHolder }));

const findActiveEnrollmentsForCourse = vi.fn();
vi.mock("../../src/modules/course/enrollmentRepository.js", () => ({
  enrollmentRepository: { findActiveEnrollmentsForCourse },
  createEnrollmentRepository: vi.fn(),
}));

const learners = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);

function installPrisma(input: { completed?: string[]; ownReads?: string[] }) {
  Object.assign(prismaHolder, {
    course: {
      findUnique: async () => (count("course"), { id: "K", publishedAt: new Date(), archivedAt: null }),
      // #1192 punkt 2: kursets nåværende hovedversjon (`findCurrentMajors`), én spørring uansett antall.
      findMany: async () => (count("course"), [{ id: "K", versionMajor: 1 }]),
    },
    courseVersion: { findMany: async () => (count("courseVersion"), []) },
    courseCompletion: {
      findMany: async () => (count("courseCompletion"), (input.completed ?? []).map((userId) => ({ userId, courseId: "K", versionMajor: 1 }))),
    },
    courseSectionRead: {
      findMany: async () => (count("courseSectionRead"), (input.ownReads ?? []).map((userId) => ({ userId, courseId: "K" }))),
    },
    courseItem: { findMany: async () => (count("courseItem"), []) },
    submission: { findMany: async () => (count("submission"), []) },
    courseGroupAssignment: { findMany: async () => (count("courseGroupAssignment"), []) },
  });
}

warmModuleGraph(() => import("../../src/modules/course/cohortStatusService.js"));
warmModuleGraph(() => import("../../src/modules/course/enrollmentService.js"));

describe("#1156: statusene for mange deltakere i ett kall", () => {
  beforeEach(() => {
    for (const key of Object.keys(queries)) delete queries[key];
    findSectionReadCredit.mockReset();
    findActiveEnrollmentsForCourse.mockReset();
  });

  it("deriveStatuses: lesingene (også på tvers) telles i ÉN omgang for alle deltakerne, og spørringene er like mange for 10 som for 200", async () => {
    const { deriveStatuses } = await import("../../src/modules/course/enrollmentService.js");
    const measure = async (n: number) => {
      for (const key of Object.keys(queries)) delete queries[key];
      findSectionReadCredit.mockReset();
      const users = learners(n);
      // u0 har fullført, u1 har lest i kurset selv, u2 har lest et annet sted (telles her), resten har ikke begynt.
      installPrisma({ completed: ["u0"], ownReads: ["u1"] });
      findSectionReadCredit.mockResolvedValue({ readSectionIds: (userId: string) => new Set(userId === "u2" ? ["s1"] : []), readerIds: () => new Set(), rows: [] });
      const statuses = await deriveStatuses(users.map((userId) => ({ userId, courseId: "K", dueAt: null })), new Date());
      return { statuses, credits: findSectionReadCredit.mock.calls.length, queries: { ...queries } };
    };
    const small = await measure(10);
    const large = await measure(200);
    expect(large.credits).toBe(1);
    expect(small.credits).toBe(1);
    expect(large.queries).toEqual(small.queries);
    expect(findSectionReadCredit.mock.calls[0]![1]).toMatchObject({ courseIds: ["K"], items: "participant" });
    expect(findSectionReadCredit.mock.calls[0]![1].userIds).toHaveLength(200);
    // KONTROLL: svaret per deltaker.
    expect(large.statuses.get("u0\nK")).toBe("COMPLETED");
    expect(large.statuses.get("u1\nK")).toBe("IN_PROGRESS");
    expect(large.statuses.get("u2\nK")).toBe("IN_PROGRESS");
    expect(large.statuses.get("u3\nK")).toBe("ASSIGNED");
  });

  it("kullstatusen spør om statusene ÉN gang for hele kullet", async () => {
    installPrisma({});
    const users = learners(150);
    findActiveEnrollmentsForCourse.mockResolvedValue(
      users.map((userId) => ({ userId, dueAt: null, user: { id: userId, activeStatus: true, isAnonymized: false } })),
    );
    findSectionReadCredit.mockResolvedValue({ readSectionIds: () => new Set(), readerIds: () => new Set(), rows: [] });
    const { getCohortStatus } = await import("../../src/modules/course/cohortStatusService.js");
    const summary = await getCohortStatus("K", new Date());
    expect(findSectionReadCredit).toHaveBeenCalledTimes(1);
    expect(queries.courseCompletion).toBe(1);
    expect(summary.counts).toMatchObject({ ASSIGNED: 150 });
  });
});
