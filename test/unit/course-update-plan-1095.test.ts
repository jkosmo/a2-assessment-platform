import { describe, expect, it } from "vitest";
import { planCourseUpdate } from "../../src/modules/adminContent/courseUpdatePlan.js";

// #1095: en importfil med identiteter oppdaterer kurset den hører til. Planen er ren: hvert
// element blir ny versjon (kjent id), opprettes (ingen id), eller er en feil (ukjent id); det kurset
// har som fila ikke nevner, tas ut.

const seksjon = (sectionId?: string) => ({ type: "SECTION" as const, origin: sectionId ? { sectionId } : undefined });
const modul = (moduleId?: string) => ({ type: "MODULE" as const, origin: moduleId ? { moduleId } : undefined });

describe("planCourseUpdate (#1095)", () => {
  const kurset = { sectionIds: ["s1", "s2"], moduleIds: ["m1"] };

  it("kjent id blir ny versjon, ingen id blir opprettet, det fila ikke nevner tas ut", () => {
    const plan = planCourseUpdate([seksjon("s1"), seksjon(), modul("m1")], kurset);
    expect(plan.entries).toEqual([
      { index: 0, type: "SECTION", action: "update", targetId: "s1" },
      { index: 1, type: "SECTION", action: "create" },
      { index: 2, type: "MODULE", action: "update", targetId: "m1" },
    ]);
    expect(plan.removed).toEqual({ sectionIds: ["s2"], moduleIds: [] });
    expect(plan.problems).toEqual([]);
  });

  it("en id kurset ikke har, er en feil — fila hører ikke til dette kurset", () => {
    const plan = planCourseUpdate([seksjon("fremmed"), modul("m1")], kurset);
    expect(plan.problems).toEqual(["item 1 (section) points at fremmed, which this course does not have"]);
    expect(plan.entries).toEqual([{ index: 1, type: "MODULE", action: "update", targetId: "m1" }]);
  });

  it("samme id to ganger i fila er en feil, og teller bare én gang", () => {
    const plan = planCourseUpdate([seksjon("s1"), seksjon("s1")], kurset);
    expect(plan.problems).toEqual(["item 2 (section) points at s1 a second time"]);
    expect(plan.removed.sectionIds).toEqual(["s2"]);
  });

  it("en seksjons-id brukt som modul-id kjennes ikke igjen: typene holdes fra hverandre", () => {
    const plan = planCourseUpdate([modul("s1")], kurset);
    expect(plan.problems).toHaveLength(1);
    expect(plan.removed).toEqual({ sectionIds: ["s1", "s2"], moduleIds: ["m1"] });
  });

  it("en fil uten identiteter oppretter alt og tar ut alt — kontrollcase mot en tom plan", () => {
    const plan = planCourseUpdate([seksjon(), modul()], kurset);
    expect(plan.entries.map((e) => e.action)).toEqual(["create", "create"]);
    expect(plan.removed).toEqual({ sectionIds: ["s1", "s2"], moduleIds: ["m1"] });
    expect(planCourseUpdate([], { sectionIds: [], moduleIds: [] })).toEqual({ entries: [], removed: { sectionIds: [], moduleIds: [] }, problems: [] });
  });
});
