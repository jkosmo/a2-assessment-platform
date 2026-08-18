// #916: the envelope's third scope, and the section translation gate's field set. No DB — the
// envelope refines and the gate are pure functions, and both are the kind of rule that is cheap to
// get subtly wrong (a scope that accepts a payload it does not name, a gate that reads a flattened
// value and therefore never sees the gap it exists to find).

import { describe, expect, it } from "vitest";
import { exportEnvelopeSchema } from "../../src/modules/adminContent/adminContentSchemas.js";
import { validateSectionTranslationCompleteness } from "../../src/modules/adminContent/contentValidationService.js";
import { evaluateSectionTranslationGate } from "../../src/modules/course/sectionCommands.js";

const base = {
  exportFormat: "a2-content-export/v1" as const,
  exportedAt: new Date().toISOString(),
};
const section = { title: { nb: "Intro" }, bodyMarkdown: { nb: "# Hei" } };
const L = (value: string) => JSON.stringify({ "en-GB": value, nb: value, nn: value });

describe("#916 exportEnvelopeSchema scope 'section'", () => {
  it("accepts a section envelope", () => {
    const result = exportEnvelopeSchema.safeParse({ ...base, scope: "section", section });
    expect(result.success).toBe(true);
  });

  it("rejects scope 'section' with no section payload", () => {
    expect(exportEnvelopeSchema.safeParse({ ...base, scope: "section" }).success).toBe(false);
  });

  it("rejects a section payload under a different scope", () => {
    // The mismatch matters: without it a course importer could be handed a file that names itself a
    // course and carries only a section, and would create an empty course.
    expect(
      exportEnvelopeSchema.safeParse({
        ...base,
        scope: "course",
        course: { course: { title: "K", certificationLevel: null, audit: {}, items: [{ type: "SECTION", sortOrder: 0, section }] } },
        section,
      }).success,
    ).toBe(false);
  });

  it("still accepts the two older scopes unchanged", () => {
    expect(
      exportEnvelopeSchema.safeParse({
        ...base,
        scope: "course",
        course: { course: { title: "K", certificationLevel: null, audit: {}, items: [{ type: "SECTION", sortOrder: 0, section }] } },
      }).success,
    ).toBe(true);
  });
});

describe("#916 section translation gate", () => {
  it("passes when both participant-visible fields carry all three locales", () => {
    expect(validateSectionTranslationCompleteness({ title: L("Tittel"), bodyMarkdown: L("# Innhold") })).toEqual([]);
  });

  it("names each missing field with the locales it lacks", () => {
    const issues = validateSectionTranslationCompleteness({
      title: JSON.stringify({ nb: "Tittel", "en-GB": "Title" }),
      bodyMarkdown: JSON.stringify({ nb: "# Innhold" }),
    });
    expect(issues.map((i) => i.field)).toEqual(["title", "bodyMarkdown"]);
    expect(issues.every((i) => i.severity === "blocking")).toBe(true);
    expect(issues[0].missingLocales).toEqual(["nn"]);
    expect(issues[1].missingLocales).toEqual(["en-GB", "nn"]);
  });

  it("treats a legacy bare string as one unlabelled language, not as complete", () => {
    // This is the whole reason the gate can exist (#905): before, an untranslated field was stored
    // as three identical copies and was indistinguishable from a real translation.
    const issues = validateSectionTranslationCompleteness({ title: "Bare norsk", bodyMarkdown: L("# Innhold") });
    expect(issues.map((i) => i.field)).toEqual(["title"]);
    expect(issues[0].missingLocales).toEqual(["en-GB", "nn"]);
  });

  it("does not gate an empty body — a section with no content is stopped earlier, by a clearer rule", () => {
    expect(validateSectionTranslationCompleteness({ title: L("Tittel"), bodyMarkdown: "" })).toEqual([]);
    expect(validateSectionTranslationCompleteness({ title: L("Tittel"), bodyMarkdown: null })).toEqual([]);
  });

  it("evaluateSectionTranslationGate reports ok + the issues in one verdict", () => {
    expect(evaluateSectionTranslationGate({ title: L("T"), bodyMarkdown: L("B") })).toEqual({ ok: true, issues: [] });
    const blocked = evaluateSectionTranslationGate({ title: JSON.stringify({ nn: "T" }), bodyMarkdown: L("B") });
    expect(blocked.ok).toBe(false);
    expect(blocked.issues).toHaveLength(1);
    expect(blocked.issues[0].field).toBe("title");
  });
});
