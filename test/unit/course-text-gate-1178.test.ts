import { describe, expect, it } from "vitest";
import { assertCourseTextComplete, courseTextGateIssues } from "../../src/modules/course/courseTextGate.js";

// #1178 skive 2: porten for kursets navn og beskrivelse. Samme regel som modulens og seksjonens (`missingLocalesFor`).
const alle = (text: string) => JSON.stringify({ nb: text, nn: `${text} nn`, "en-GB": `${text} en` });

describe("#1178 — kursets navn og beskrivelse på alle tre språk", () => {
  it("komplett navn og beskrivelse: ingen funn (kontroll)", () => {
    expect(courseTextGateIssues({ title: alle("Kurs"), description: alle("Om kurset") })).toEqual([]);
    expect(() => assertCourseTextComplete({ title: alle("Kurs"), description: alle("Om kurset") })).not.toThrow();
  });

  it("navnet mangler nynorsk: funn med feltet og språket", () => {
    const issues = courseTextGateIssues({ title: JSON.stringify({ nb: "Kurs", "en-GB": "Course" }), description: null });
    expect(issues.map(({ field, missingLocales }) => ({ field, missingLocales }))).toEqual([{ field: "title", missingLocales: ["nn"] }]);
  });

  it("en tom beskrivelse er komplett; en beskrivelse på ett språk er det ikke", () => {
    expect(courseTextGateIssues({ title: alle("Kurs"), description: null })).toEqual([]);
    expect(courseTextGateIssues({ title: alle("Kurs"), description: "" })).toEqual([]);
    // Et språkkart med bare blanke verdier er også tomt.
    expect(courseTextGateIssues({ title: alle("Kurs"), description: JSON.stringify({ nb: " ", nn: "" }) })).toEqual([]);
    expect(courseTextGateIssues({ title: alle("Kurs"), description: "{}" })).toEqual([]);
    const issues = courseTextGateIssues({ title: alle("Kurs"), description: JSON.stringify({ nb: "Om kurset" }) });
    expect(issues.map(({ field, missingLocales }) => ({ field, missingLocales }))).toEqual([{ field: "description", missingLocales: ["en-GB", "nn"] }]);
  });

  it("en ren streng (fra før språkkartene) leses som bokmål", () => {
    const issues = courseTextGateIssues({ title: "Gammelt kurs", description: null });
    expect(issues[0]?.missingLocales).toEqual(["en-GB", "nn"]);
  });

  it("avvisningen er 422 course_translation_incomplete med feltene klienten fyller inn", () => {
    let caught: unknown;
    try {
      assertCourseTextComplete({ title: JSON.stringify({ nb: "Kurs" }), description: null });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "course_translation_incomplete",
      httpStatus: 422,
      details: { issues: [{ code: "translation_incomplete", field: "title", missingLocales: ["en-GB", "nn"] }] },
    });
  });
});
