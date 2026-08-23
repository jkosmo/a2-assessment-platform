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
    {
      clientRef: "intro",
      type: "section",
      // #749 (Layer A): the section carries an inline SVG figure referenced from the markdown.
      payload: {
        title: "Introduksjon",
        bodyMarkdown: "## Intro\n\nPersonvern og GDPR.\n\n![Flyt](asset:cmr8source001)",
        assets: [
          {
            sourceId: "cmr8source001",
            filename: "flyt.svg",
            mimeType: "image/svg+xml",
            sizeBytes: 49,
            contentBase64: Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg"><text>Hei</text></svg>',
              "utf8",
            ).toString("base64"),
            sourceLocale: "nb",
            localizedVariants: [
              {
                locale: "en-GB",
                contentBase64: Buffer.from(
                  '<svg xmlns="http://www.w3.org/2000/svg"><text>Hi</text></svg>',
                  "utf8",
                ).toString("base64"),
              },
            ],
          },
        ],
      },
    },
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

  it("#749: the inline section asset survives the re-wrap and passes the real schema", () => {
    const envelope = buildFallbackEnvelope(pkg, { exportedAt: "2026-07-10T21:05:15.364Z" });
    const introItem = envelope.course.course.items.find((i: { type: string }) => i.type === "SECTION");
    const asset = introItem.section.assets[0];
    expect(asset.sourceId).toBe("cmr8source001");
    expect(asset.mimeType).toBe("image/svg+xml");
    expect(asset.localizedVariants).toHaveLength(1);
    // The markdown still references the SOURCE id (import remaps it) — do NOT pre-remap.
    expect(introItem.section.bodyMarkdown).toContain("asset:cmr8source001");
    // Both the real schema and the bundled validator accept the assets[] array.
    expect(exportEnvelopeSchema.safeParse(envelope).success).toBe(true);
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

  // ───────────────────────────────────────────────────────────────────────────
  // #992: `scope: "section"` — validatoren meldte GYLDIG det importen avviser.
  //
  // Rule 7 i skillet lover «valider mot samme skjema som importen». For seksjoner holdt løftet
  // ikke: tittelsjekken var `!gyldig && tittel == null`, som bare kan slå til når tittelen er BÅDE
  // ugyldig OG fraværende — altså aldri for en tom streng. `bodyMarkdown` ble ikke sett på.
  //
  // ⚠️ Hver test her kjører BEGGE: det ekte Zod-skjemaet og den medfølgende validatoren, og krever
  // samme svar. Det er den eneste formen som fanger drift — en test som bare spør validatoren
  // ville vært grønn hele veien gjennom denne feilen.
  // ───────────────────────────────────────────────────────────────────────────

  const sectionEnvelope = (section: Record<string, unknown>) => ({
    exportFormat: "a2-content-export/v1",
    exportedAt: "2026-08-22T10:00:00.000Z",
    scope: "section",
    section: { audit: {}, ...section },
  });

  const bothAgree = (envelope: unknown) => ({
    real: exportEnvelopeSchema.safeParse(envelope).success,
    bundled: validateExportEnvelopeStructure(envelope).valid,
  });

  it("#992: tom tittel avvises av BEGGE", () => {
    const r = bothAgree(sectionEnvelope({ title: "", bodyMarkdown: { nb: "Tekst" } }));
    expect(r.real).toBe(false);
    expect(r.bundled).toBe(false);
  });

  it("#992: tom bodyMarkdown avvises av BEGGE", () => {
    const r = bothAgree(sectionEnvelope({ title: { nb: "T" }, bodyMarkdown: "" }));
    expect(r.real).toBe(false);
    expect(r.bundled).toBe(false);
  });

  it("#992: manglende bodyMarkdown avvises av BEGGE", () => {
    const r = bothAgree(sectionEnvelope({ title: { nb: "T" } }));
    expect(r.real).toBe(false);
    expect(r.bundled).toBe(false);
  });

  it("#992: et tomt lokaliseringsobjekt avvises av BEGGE", () => {
    const r = bothAgree(sectionEnvelope({ title: { nb: "   " }, bodyMarkdown: { nb: "Tekst" } }));
    expect(r.real).toBe(false);
    expect(r.bundled).toBe(false);
  });

  it("#992 KONTROLLCASE: ETT språk er nok — begge godtar", () => {
    // ⚠️ Den viktigste testen her. Seksjoner bruker `localizedTextPatchSchema`, ikke
    // `localizedTextSchema`: innhold skrevet på ett språk og ennå ikke oversatt SKAL kunne
    // uttrykkes (#905). Hadde jeg gjenbrukt modulenes `isNonEmptyLocalized` — som krever alle tre —
    // ville validatoren avvist ekte, gyldige filer. Da hadde jeg byttet en feil mot en verre.
    const r = bothAgree(sectionEnvelope({ title: { nb: "Tittel" }, bodyMarkdown: { nb: "## Tekst" } }));
    expect(r.real).toBe(true);
    expect(r.bundled).toBe(true);
  });

  it("#992 KONTROLLCASE: rene strenger godtas fortsatt av begge", () => {
    const r = bothAgree(sectionEnvelope({ title: "Tittel", bodyMarkdown: "## Tekst" }));
    expect(r.real).toBe(true);
    expect(r.bundled).toBe(true);
  });

  // ⚠️ Andre runde av samme funn. Min første fiks sjekket bare at MINST ETT språk var gyldig, og
  // slapp derfor gjennom en konvolutt der et ANNET språk var søppel. `.partial()` gjør nøklene
  // valgfrie — den gjør dem ikke frivillige å fylle riktig.
  //
  // En halvferdig validering er verre enn ingen: den flytter feilen til etter at forfatteren har
  // sluttet å lete etter den.
  it("#992: et ugyldig NABOSPRÅK avvises av BEGGE", () => {
    const r = bothAgree(sectionEnvelope({ title: { nb: "Tittel", nn: 42 }, bodyMarkdown: { nb: "T" } }));
    expect(r.real).toBe(false);
    expect(r.bundled).toBe(false);
  });

  it("#992: et TOMT nabospråk avvises av BEGGE", () => {
    const r = bothAgree(sectionEnvelope({ title: { nb: "Tittel", "en-GB": "   " }, bodyMarkdown: { nb: "T" } }));
    expect(r.real).toBe(false);
    expect(r.bundled).toBe(false);
  });

  it("#992 KONTROLLCASE: en UKJENT nøkkel er ikke en feil — importen stripper den", () => {
    // `z.object` fjerner ukjente nøkler i stillhet i stedet for å avvise. Validatoren må gjøre det
    // samme, ellers melder den feil på en fil importen tar imot — motsatt retning, samme skade.
    const r = bothAgree(sectionEnvelope({ title: { nb: "Tittel", sv: "Titel" }, bodyMarkdown: { nb: "T" } }));
    expect(r.real).toBe(true);
    expect(r.bundled).toBe(true);
  });
});
