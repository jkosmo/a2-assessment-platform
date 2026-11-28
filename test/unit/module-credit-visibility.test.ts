// Produkteier 28.11.2026 (doc/DECISIONS.md, #1169 punkt 9; doc/design/PLAN_MODULER_TELLER_DER_DELTAKEREN_SER.md): et bestått i en
// modul teller bare i kurs deltakeren ser, og i et arkivert kurs bare på en besvarelse levert fram til arkiveringen. Regelen står
// i `findModuleProgress` (moduleCredit.ts), den ene veien til fremdrift i kurs. Her uten database, med en falsk klient som tolker
// filtrene regelen bruker, og som teller oppslagene i synligheten.
import { describe, expect, it } from "vitest";
import { findModuleProgress, findModuleStanding } from "../../src/modules/course/moduleCredit.js";

type Course = { id: string; enrollmentPolicy: "OPEN" | "RESTRICTED"; archivedAt: Date | null };
type Pass = { userId: string; moduleId: string; submittedAt: Date; passedAt?: Date; versionMajor?: number };

function fakeClient(options: { courses: Course[]; passes: Pass[]; enrolled?: Array<{ userId: string; courseId: string }> }) {
  const calls = { enrollment: 0, assignment: 0 };
  const client = {
    course: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => options.courses.filter((c) => where.id.in.includes(c.id)),
    },
    courseModuleRequirement: {
      findMany: async ({ where }: { where: { courseId: { in: string[] }; moduleId: { in: string[] } } }) =>
        options.courses
          .filter((c) => where.courseId.in.includes(c.id))
          .flatMap((c) => where.moduleId.in.map((moduleId) => ({ courseId: c.id, moduleId, minModuleMajor: 1 }))),
    },
    modulePass: {
      findMany: async ({ where }: { where: { moduleId: { in: string[] }; userId?: { in: string[] } } }) =>
        options.passes
          .filter((p) => where.moduleId.in.includes(p.moduleId) && (!where.userId || where.userId.in.includes(p.userId)))
          .map((p) => ({
            userId: p.userId,
            moduleId: p.moduleId,
            invalidatedAt: null,
            passedAt: p.passedAt ?? p.submittedAt,
            moduleVersion: { versionMajor: p.versionMajor ?? 1 },
            submission: { submittedAt: p.submittedAt },
          })),
    },
    moduleVersion: { groupBy: async () => [] },
    courseEnrollment: {
      findMany: async ({ where }: { where: { courseId: { in: string[] }; userId: { in: string[] } } }) => {
        calls.enrollment += 1;
        return (options.enrolled ?? []).filter((row) => where.courseId.in.includes(row.courseId) && where.userId.in.includes(row.userId));
      },
    },
    courseGroupAssignment: {
      findMany: async () => {
        calls.assignment += 1;
        return [];
      },
    },
  };
  return { client: client as never, calls };
}

const T0 = new Date("2026-10-01T10:00:00.000Z");
const ARCHIVED = new Date("2026-11-01T10:00:00.000Z");
const LATER = new Date("2026-11-15T10:00:00.000Z");
const COURSES = (courseId: string) => [{ courseId, moduleIds: ["m"] }];

describe("bestått modul teller bare i kurs deltakeren ser (28.11.2026)", () => {
  it("åpent kurs: teller, og ingen slår opp synligheten", async () => {
    const { client, calls } = fakeClient({ courses: [{ id: "open", enrollmentPolicy: "OPEN", archivedAt: null }], passes: [{ userId: "u", moduleId: "m", submittedAt: T0 }] });
    const progress = await findModuleProgress(client, { userIds: ["u"], courses: COURSES("open") });
    expect([...progress.passedModuleIds("u", "open")]).toEqual(["m"]);
    expect(calls.enrollment).toBe(0);
  });

  it("begrenset kurs hen ikke er tildelt: teller ikke, og ståstedet er null (ikke «ta modulen på nytt»)", async () => {
    const { client } = fakeClient({ courses: [{ id: "copy", enrollmentPolicy: "RESTRICTED", archivedAt: null }], passes: [{ userId: "u", moduleId: "m", submittedAt: T0 }] });
    const progress = await findModuleProgress(client, { userIds: ["u"], courses: COURSES("copy") });
    expect(progress.passedModuleIds("u", "copy").size).toBe(0);
    expect(progress.passedUserIds("copy", "m").size).toBe(0);
    expect(progress.standing("u", "copy", "m")).toBeNull();
  });

  it("KONTROLL: begrenset kurs hen er påmeldt: teller", async () => {
    const { client } = fakeClient({
      courses: [{ id: "copy", enrollmentPolicy: "RESTRICTED", archivedAt: null }],
      passes: [{ userId: "u", moduleId: "m", submittedAt: T0 }],
      enrolled: [{ userId: "u", courseId: "copy" }],
    });
    const progress = await findModuleProgress(client, { userIds: ["u"], courses: COURSES("copy") });
    expect(progress.standing("u", "copy", "m")).toBe("PASSED");
  });

  it("kalleren vet at hen ser kurset: teller, uten oppslag", async () => {
    const { client, calls } = fakeClient({ courses: [{ id: "copy", enrollmentPolicy: "RESTRICTED", archivedAt: null }], passes: [{ userId: "u", moduleId: "m", submittedAt: T0 }] });
    const progress = await findModuleProgress(client, { userIds: ["u"], courses: COURSES("copy"), knownVisibleCourseIds: ["copy"] });
    expect(progress.standing("u", "copy", "m")).toBe("PASSED");
    expect(calls.enrollment + calls.assignment).toBe(0);
  });

  it("lista er hele svaret (`visibilityComplete`): et kurs som ikke står der, teller ikke, uten oppslag", async () => {
    const { client, calls } = fakeClient({
      courses: [{ id: "copy", enrollmentPolicy: "RESTRICTED", archivedAt: null }],
      passes: [{ userId: "u", moduleId: "m", submittedAt: T0 }],
      enrolled: [{ userId: "u", courseId: "copy" }],
    });
    const progress = await findModuleProgress(client, { userIds: ["u"], courses: COURSES("copy"), knownVisibleCourseIds: [], visibilityComplete: true });
    expect(progress.standing("u", "copy", "m")).toBeNull();
    expect(calls.enrollment + calls.assignment).toBe(0);
  });

  it("arkivert kurs: levert før arkiveringen teller (også bestått etterpå); levert etter teller ikke", async () => {
    const { client } = fakeClient({
      courses: [{ id: "arch", enrollmentPolicy: "OPEN", archivedAt: ARCHIVED }],
      passes: [
        // Levert før arkiveringen, bestått etter (saken ventet): teller. Med `passedAt` ville den ikke telt.
        { userId: "before", moduleId: "m", submittedAt: T0, passedAt: LATER },
        { userId: "after", moduleId: "m", submittedAt: LATER },
      ],
    });
    const progress = await findModuleProgress(client, { courses: COURSES("arch") });
    expect([...progress.passedUserIds("arch", "m")]).toEqual(["before"]);
    expect(progress.standing("after", "arch", "m")).toBeNull();
  });

  it("rapporten (alle deltakere, to kurs): ÉN omgang med oppslag for alle, ikke én per deltaker", async () => {
    const { client, calls } = fakeClient({
      courses: [
        { id: "a", enrollmentPolicy: "RESTRICTED", archivedAt: null },
        { id: "b", enrollmentPolicy: "RESTRICTED", archivedAt: null },
      ],
      passes: ["u1", "u2", "u3"].map((userId) => ({ userId, moduleId: "m", submittedAt: T0 })),
      enrolled: [{ userId: "u2", courseId: "a" }, { userId: "u3", courseId: "b" }],
    });
    const progress = await findModuleProgress(client, { courses: [{ courseId: "a", moduleIds: ["m"] }, { courseId: "b", moduleIds: ["m"] }] });
    expect([...progress.passedUserIds("a", "m")]).toEqual(["u2"]);
    expect([...progress.passedUserIds("b", "m")]).toEqual(["u3"]);
    expect(calls.enrollment).toBe(1);
  });

  it("kjent synlighet gjelder bare én deltaker", async () => {
    const { client } = fakeClient({ courses: [{ id: "open", enrollmentPolicy: "OPEN", archivedAt: null }], passes: [] });
    await expect(findModuleProgress(client, { userIds: ["u1", "u2"], courses: COURSES("open"), knownVisibleCourseIds: ["open"] })).rejects.toThrow(/exactly one participant/);
  });

  it("modulrapporten med kurs valgt: uendret — kurset gir kravet, ikke synligheten", async () => {
    const { client, calls } = fakeClient({ courses: [{ id: "copy", enrollmentPolicy: "RESTRICTED", archivedAt: ARCHIVED }], passes: [{ userId: "u", moduleId: "m", submittedAt: LATER }] });
    const standing = await findModuleStanding(client, { moduleIds: ["m"], userIds: ["u"], courseId: "copy" });
    expect(standing.standing("u", "m")).toBe("PASSED");
    expect(calls.enrollment + calls.assignment).toBe(0);
  });
});
