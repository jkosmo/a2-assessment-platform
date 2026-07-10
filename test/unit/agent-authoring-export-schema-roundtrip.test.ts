// AA-6 (#762): the DETERMINISTIC GUARANTEE for Issue 2. Feeds the skill's fallback-export
// generator output through the REAL exportEnvelopeSchema / importBodySchema from
// src/modules/adminContent/adminContentSchemas.ts — the exact schema A2's import applies. This
// is what keeps the bundled validator (export-validate.mjs) faithful: if the real schema ever
// diverges, this test fails. Includes the bad-datetime cases that caused the original incident.

import { describe, expect, it } from "vitest";
import {
  exportEnvelopeSchema,
  importBodySchema,
} from "../../src/modules/adminContent/adminContentSchemas.js";
import {
  buildFallbackEnvelope,
  normalizeEnvelopeDates,
  validateExportEnvelopeStructure,
  isStrictDatetime,
  // @ts-expect-error — .mjs skill script consumed as a library
} from "../../skills/a2-authoring-api/scripts/export-validate.mjs";

// A complete authoring package covering all three assessment modes + mixed course order.
const pkg = {
  packageFormat: "a2-authoring-package/v1",
  locale: "nb",
  objects: [
    { clientRef: "intro", type: "section", payload: { title: "Introduksjon", bodyMarkdown: "## Intro\n\nPersonvern og GDPR." } },
    {
      clientRef: "modul-fritekst",
      type: "module",
      payload: {
        module: { title: "Behandlingsgrunnlag", description: "Fritekst", certificationLevel: "basic" },
        activeVersion: {
          assessmentMode: "FREETEXT_ONLY",
          taskText: "Beskriv hvilket behandlingsgrunnlag som gjelder.",
          assessorExpectedContent: "Identifiserer art. 6(1)(b).",
          rubric: { criteria: { identifisering: "0-4" }, scalingRule: { practical_weight: 100, max_total: 4 } },
          promptTemplate: { systemPrompt: "Du er sensor.", userPromptTemplate: "Vurder besvarelsen." },
        },
      },
    },
    {
      clientRef: "modul-mcq",
      type: "module",
      payload: {
        module: { title: "Prinsipper", certificationLevel: "basic" },
        activeVersion: {
          assessmentMode: "MCQ_ONLY",
          mcqSet: {
            title: "Kontroll",
            questions: [
              { stem: "Hvilket prinsipp krever minst mulig data?", options: ["Dataminimering", "Formålsbegrensning"], correctAnswer: "Dataminimering", rationale: "Art. 5(1)(c)." },
            ],
          },
          assessmentPolicy: { passRules: { mcqMinPercent: 70 } },
        },
      },
    },
    {
      clientRef: "kurs",
      type: "course",
      payload: {
        course: { title: "Personvern", description: "Grunnkurs", certificationLevel: "basic" },
        items: [
          { type: "SECTION", ref: "intro" },
          { type: "MODULE", ref: "modul-fritekst" },
          { type: "MODULE", ref: "modul-mcq" },
        ],
      },
    },
  ],
};

describe("#762 fallback export vs the REAL src schema", () => {
  it("9. generator output passes the real exportEnvelopeSchema AND importBodySchema", () => {
    const envelope = buildFallbackEnvelope(pkg, { exportedAt: "2026-07-10T21:05:15.364Z" });

    const envResult = exportEnvelopeSchema.safeParse(envelope);
    expect(envResult.success).toBe(true);

    // ...and inside the import body wrapper the platform actually receives.
    const importResult = importBodySchema.safeParse({ payload: envelope, mode: "createNew", autoPublish: false });
    expect(importResult.success).toBe(true);

    // The bundled validator agrees with the real schema on this good input.
    expect(validateExportEnvelopeStructure(envelope).valid).toBe(true);
  });

  it("the real schema REJECTS the offset+microseconds exportedAt (the original incident)", () => {
    const envelope = buildFallbackEnvelope(pkg);
    envelope.exportedAt = "2026-07-10T21:01:25.216841+00:00";
    expect(exportEnvelopeSchema.safeParse(envelope).success).toBe(false);
    // The bundled strict check flags the very same field — faithful to the real schema.
    expect(isStrictDatetime(envelope.exportedAt)).toBe(false);
    expect(validateExportEnvelopeStructure(envelope).valid).toBe(false);
  });

  it("normalising the bad datetime makes it pass the real schema again", () => {
    const envelope = buildFallbackEnvelope(pkg);
    envelope.exportedAt = "2026-07-10T21:01:25.216841+00:00";
    const fixed = normalizeEnvelopeDates(envelope);
    expect(exportEnvelopeSchema.safeParse(fixed).success).toBe(true);
    expect(fixed.exportedAt).toBe("2026-07-10T21:01:25.216Z");
  });

  it("the real schema REJECTS a bad audit.publishedAt too (offset), and normalising fixes it", () => {
    const envelope = buildFallbackEnvelope(pkg);
    envelope.course.course.audit = { publishedAt: "2026-07-10T21:01:25.216841+00:00" };
    expect(exportEnvelopeSchema.safeParse(envelope).success).toBe(false);
    const fixed = normalizeEnvelopeDates(envelope);
    expect(exportEnvelopeSchema.safeParse(fixed).success).toBe(true);
  });

  it("empty audits keep the import draft-only (no publish history)", () => {
    const envelope = buildFallbackEnvelope(pkg);
    // Every module activeVersion + the course carry an empty audit {} → no publishedAt.
    for (const item of envelope.course.course.items) {
      if (item.type === "MODULE") expect(item.module.activeVersion.audit).toEqual({});
    }
    expect(envelope.course.course.audit).toEqual({});
    expect(exportEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });
});
