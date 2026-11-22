import { describe, expect, it, vi } from "vitest";
import { enforceAgentTokenScope } from "../../src/auth/agentTokenScope.js";
import { publishModuleVersionedBodySchema, publishPendingVersionedBodySchema } from "../../src/modules/adminContent/adminContentSchemas.js";
import { countChangedItems, resolveCourseVersionKind } from "../../src/modules/course/courseVersioning.js";
import { findModuleProgress, passCountsForCourse } from "../../src/modules/course/moduleCredit.js";
import { isModulePassPerCourseOn, MODULE_PASS_SWITCH_KEY } from "../../src/modules/course/modulePassSwitch.js";

// #934 skive 5a-3: det som kan måles uten database. Regelen gjennom rutene står i test/m2-module-pass-per-course-934-5a3.test.ts.

/** En klient der vi ser hva som faktisk leses. */
function fakeClient(options: { switchValue?: string; statuses?: Array<{ userId: string; moduleId: string; status: string }>; passes?: unknown[]; requirements?: unknown[] }) {
  const calls = { platformConfig: 0, certificationStatus: 0, modulePass: 0, courseModuleRequirement: 0 };
  const client = {
    platformConfig: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        calls.platformConfig += 1;
        expect(where.key).toBe(MODULE_PASS_SWITCH_KEY);
        return options.switchValue === undefined ? null : { value: options.switchValue };
      },
    },
    certificationStatus: {
      findMany: async () => {
        calls.certificationStatus += 1;
        return options.statuses ?? [];
      },
    },
    modulePass: {
      findMany: async () => {
        calls.modulePass += 1;
        return options.passes ?? [];
      },
    },
    courseModuleRequirement: {
      findMany: async () => {
        calls.courseModuleRequirement += 1;
        return options.requirements ?? [];
      },
    },
  };
  return { client: client as never, calls };
}

const COURSES = [{ courseId: "c", moduleIds: ["m"] }];

describe("#934 5a-3: bryteren", () => {
  it("bare verdien `on` er på. Bare skriptet som slår den på, leser den", async () => {
    expect(await isModulePassPerCourseOn(fakeClient({}).client)).toBe(false);
    expect(await isModulePassPerCourseOn(fakeClient({ switchValue: "off" }).client)).toBe(false);
    expect(await isModulePassPerCourseOn(fakeClient({ switchValue: "true" }).client)).toBe(false);
    expect(await isModulePassPerCourseOn(fakeClient({ switchValue: "on" }).client)).toBe(true);
  });
});

// 2026-11-08: den gamle regelen (bryteren av, `CertificationStatus`) er fjernet. `findModuleProgress` leser verken bryteren eller
// modulstatusen, uansett hva raden sier. Det er det tellingen av kall under måler.
describe("#934 5a-3: findModuleProgress", () => {
  it("leser bare beståtte og krav, aldri bryteren eller modulstatus, også når raden sier av. Samme modul kan stå ulikt i to kurs", async () => {
    const pass = (userId: string, versionMajor: number | null, invalidatedAt: Date | null = null) => ({ userId, moduleId: "m", invalidatedAt, moduleVersion: { versionMajor } });
    for (const switchValue of [undefined, "off", "on"]) {
      const { client, calls } = fakeClient({
        switchValue,
        statuses: [{ userId: "u", moduleId: "m", status: "ACTIVE" }, { userId: "y", moduleId: "m", status: "ACTIVE" }],
        requirements: [{ courseId: "a", moduleId: "m", minModuleMajor: 2 }, { courseId: "b", moduleId: "m", minModuleMajor: 1 }],
        passes: [pass("u", 1), pass("v", 2), pass("w", 2, new Date()), pass("x", null)],
      });
      const progress = await findModuleProgress(client, { courses: [{ courseId: "a", moduleIds: ["m"] }, { courseId: "b", moduleIds: ["m"] }] });
      expect([progress.standing("u", "a", "m"), progress.standing("u", "b", "m")]).toEqual(["REVISED", "PASSED"]);
      expect([progress.standing("v", "a", "m"), progress.standing("v", "b", "m")]).toEqual(["PASSED", "PASSED"]);
      // Ugyldiggjort (#997), og en versjon uten nummer: teller aldri.
      expect([progress.standing("w", "b", "m"), progress.standing("x", "b", "m")]).toEqual(["REVISED", "REVISED"]);
      // Bare modulstatus, uten ModulePass: teller ikke (den gamle regelen).
      expect(progress.standing("y", "b", "m")).toBeNull();
      expect(calls).toEqual({ platformConfig: 0, certificationStatus: 0, modulePass: 1, courseModuleRequirement: 1 });
    }
  });

  it("en bestått som teller, vinner, uansett rekkefølge på innleveringene", async () => {
    const pass = (versionMajor: number) => ({ userId: "u", moduleId: "m", invalidatedAt: null, moduleVersion: { versionMajor } });
    for (const passes of [[pass(2), pass(1)], [pass(1), pass(2)]]) {
      const { client } = fakeClient({ requirements: [{ courseId: "c", moduleId: "m", minModuleMajor: 2 }], passes });
      const progress = await findModuleProgress(client, { courses: COURSES });
      expect(progress.standing("u", "c", "m")).toBe("PASSED");
      expect([...progress.passedModuleIds("u", "c")]).toEqual(["m"]);
    }
  });

  it("mangler kravet, teller ingenting. Andre moduler i kurset enn dem leseren spør om, er ikke med", async () => {
    const pass = (moduleId: string) => ({ userId: "u", moduleId, invalidatedAt: null, moduleVersion: { versionMajor: 9 } });
    const { client } = fakeClient({ requirements: [], passes: [pass("m"), pass("annen")] });
    const progress = await findModuleProgress(client, { courses: COURSES });
    expect(progress.standing("u", "c", "m")).toBe("REVISED");
    expect(progress.standing("u", "c", "annen")).toBeNull();
    expect(progress.passedModuleIds("u", "c").size).toBe(0);
  });

  it("ingen moduler eller ingen deltakere: ingen spørringer", async () => {
    const empty = fakeClient({});
    const none = await findModuleProgress(empty.client, { courses: [{ courseId: "c", moduleIds: [] }] });
    expect(none.standing("u", "c", "m")).toBeNull();
    const noUsers = fakeClient({});
    const nobody = await findModuleProgress(noUsers.client, { userIds: [], courses: COURSES });
    expect(nobody.passedModuleIds("u", "c").size).toBe(0);
    for (const calls of [empty.calls, noUsers.calls]) expect(calls).toEqual({ platformConfig: 0, certificationStatus: 0, modulePass: 0, courseModuleRequirement: 0 });
  });

  it("regelen selv: lik hovedversjon teller, lavere gjør det ikke", () => {
    expect(passCountsForCourse({ invalidatedAt: null, versionMajor: 2 }, 2)).toBe(true);
    expect(passCountsForCourse({ invalidatedAt: null, versionMajor: 3 }, 2)).toBe(true);
    expect(passCountsForCourse({ invalidatedAt: null, versionMajor: 1 }, 2)).toBe(false);
  });
});

describe("#934 5a-3: resultatet per kurs", () => {
  it("hovedversjon bare når svaret er hoved og noen har kursbevis (svar d)", () => {
    expect(resolveCourseVersionKind("major", 1)).toBe("major");
    expect(resolveCourseVersionKind("major", 0)).toBe("minor");
    expect(resolveCourseVersionKind("minor", 5)).toBe("minor");
    expect(resolveCourseVersionKind(undefined, 5)).toBe("minor");
  });

  it("e-posten teller moduler med hevet krav, og en modul som også er ny i kurset, én gang", () => {
    expect(countChangedItems({}, {}, ["m1"], ["m1"])).toBe(0);
    expect(countChangedItems({}, {}, ["m1"], ["m1"], ["m1"])).toBe(1);
    expect(countChangedItems({}, {}, [], ["m1"], ["m1"])).toBe(1);
    expect(countChangedItems({ s: "a" }, { s: "b" }, ["m1"], ["m1", "m2"], ["m1"])).toBe(3);
  });
});

describe("#934 5a-3: skjemaene", () => {
  it("modulen: et felt serveren ikke kjenner, avvises, så valget ikke forsvinner stille", () => {
    expect(publishModuleVersionedBodySchema.safeParse({ moduleVersion: "minor" }).success).toBe(true);
    expect(publishModuleVersionedBodySchema.safeParse({ moduleVersion: "minor", supersedesEarlierPasses: true }).success).toBe(false);
    expect(publishModuleVersionedBodySchema.safeParse({}).success).toBe(false);
    expect(publishModuleVersionedBodySchema.safeParse({ moduleVersion: "minor", courseVersions: { c: "kanskje" } }).success).toBe(false);
  });

  it("modulen: hoved krever settet dialogen viste, og mindre kan ikke si hoved for et kurs", () => {
    expect(publishModuleVersionedBodySchema.safeParse({ moduleVersion: "major" }).success).toBe(false);
    expect(publishModuleVersionedBodySchema.safeParse({ moduleVersion: "major", expectedCourseIds: [] }).success).toBe(true);
    expect(publishModuleVersionedBodySchema.safeParse({ moduleVersion: "minor", courseVersions: { c: "major" } }).success).toBe(false);
    expect(publishModuleVersionedBodySchema.safeParse({ moduleVersion: "minor", courseVersions: { c: "minor" } }).success).toBe(true);
  });

  it("kurset: versjonene og settet kreves, og antallet mottakere er et heltall per kurs", () => {
    expect(publishPendingVersionedBodySchema.safeParse({ versionIds: [], expectedCourseIds: [] }).success).toBe(true);
    expect(publishPendingVersionedBodySchema.safeParse({ versionIds: [] }).success).toBe(false);
    expect(publishPendingVersionedBodySchema.safeParse({ expectedCourseIds: [] }).success).toBe(false);
    expect(publishPendingVersionedBodySchema.safeParse({ versionIds: [], expectedCourseIds: [], confirmEmailRecipients: { c: 1.5 } }).success).toBe(false);
    expect(publishPendingVersionedBodySchema.safeParse({ versionIds: [], expectedCourseIds: [], supersedesEarlierPasses: true }).success).toBe(false);
  });
});

describe("#934 5a-3: agent-tokenet kan ikke publisere", () => {
  it.each([
    ["GET", "/api/admin/content/modules/m/module-versions/v/publish-preview-versioned"],
    ["POST", "/api/admin/content/modules/m/module-versions/v/publish-versioned"],
    ["POST", "/api/admin/content/courses/c/publish-pending-versioned"],
  ])("%s %s: 403", (method, originalUrl) => {
    const next = vi.fn();
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    enforceAgentTokenScope({ method, originalUrl, context: { agentToken: { id: "t" } } } as never, { status } as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});
