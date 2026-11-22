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
  MCQ_QUESTION_TYPES as SKILL_MCQ_QUESTION_TYPES,
  // @ts-expect-error — .mjs skill script consumed as a library
} from "../../skills/a2-authoring-api/scripts/export-validate.mjs";
import { MCQ_QUESTION_TYPES } from "../../src/modules/assessment/mcqQuestionTypes.js";

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

// #1077: «velg alle som stemmer» i en importfil. Skillets validator og importens skjema må gi samme
// svar — ellers melder skillet en fil gyldig som importen avviser, eller omvendt.
describe("#1077 — flere riktige svar: skillets validator og det ekte skjemaet er enige", () => {
  const L = (en: string, nb: string) => ({ "en-GB": en, nb, nn: nb });
  const A = L("Purpose", "Formål");
  const B = L("Colour", "Farge");
  const C = L("Legal basis", "Behandlingsgrunnlag");
  const moduleEnvelope = (question: Record<string, unknown>) => ({
    exportFormat: "a2-content-export/v1",
    exportedAt: "2026-10-24T10:00:00.000Z",
    scope: "module",
    module: {
      module: { title: L("Records", "Protokoll"), certificationLevel: "basic" },
      activeVersion: {
        audit: {},
        assessmentMode: "MCQ_ONLY",
        mcqSet: { title: L("Set", "Sett"), questions: [{ stem: L("Which?", "Hvilke?"), options: [A, B, C], rationale: L("Art. 30", "Art. 30"), ...question }] },
      },
    },
  });
  const bothAgree = (question: Record<string, unknown>) => {
    const envelope = moduleEnvelope(question);
    return { real: exportEnvelopeSchema.safeParse(envelope).success, bundled: validateExportEnvelopeStructure(envelope).valid };
  };

  it.each<[string, Record<string, unknown>, boolean]>([
    ["to av tre riktige", { questionType: "multiple", correctAnswers: [A, C] }, true],
    ["alle riktige (produkteier 2026-10-24)", { questionType: "multiple", correctAnswers: [A, B, C] }, true],
    ["med correctAnswer i tillegg, slik eksporten skriver det", { questionType: "multiple", correctAnswers: [A, C], correctAnswer: A }, true],
    ["ingen riktige", { questionType: "multiple", correctAnswers: [] }, false],
    ["et riktig som ikke er et alternativ", { questionType: "multiple", correctAnswers: [A, L("Other", "Annet")] }, false],
    ["et riktig som bare stemmer på ett språk", { questionType: "multiple", correctAnswers: [A, { ...C, nn: "Noko anna" }] }, false],
    ["samme alternativ to ganger", { questionType: "multiple", correctAnswers: [A, A] }, false],
    ["ukjent type", { questionType: "essay", correctAnswer: A }, false],
    // #1077 leveranse 2: «sett i riktig rekkefølge» — alternativene ER rekkefølgen, 3–6, ingen like.
    ["rekkefølge med tre elementer, slik eksporten skriver den", { questionType: "order", correctAnswer: A }, true],
    ["rekkefølge med correctAnswers", { questionType: "order", correctAnswers: [A] }, false],
    ["rekkefølge med to elementer", { questionType: "order", options: [A, B] }, false],
    ["rekkefølge med samme element to ganger", { questionType: "order", options: [A, B, A] }, false],
    // #1077 leveranse 3: «fyll inn» — alternativene ER de godkjente svarene, 1–6; én lukke på hvert språk.
    ["fyll inn med ett godkjent svar, slik eksporten skriver den", { questionType: "fill", stem: L("The deadline is ___ weeks.", "Fristen er ___ uker."), options: [A], correctAnswer: A }, true],
    ["fyll inn uten lukke", { questionType: "fill", options: [A], correctAnswer: A }, false],
    ["fyll inn med lukke bare på bokmål", { questionType: "fill", stem: L("The deadline is three weeks.", "Fristen er ___ uker."), options: [A] }, false],
    ["fyll inn med samme svar to ganger", { questionType: "fill", stem: L("___", "___"), options: [A, A] }, false],
    ["fyll inn med correctAnswers", { questionType: "fill", stem: L("___", "___"), options: [A], correctAnswers: [A] }, false],
    // QA 2.100.0: bare en FRAVÆRENDE type er «single»; importen avviser null.
    ["type null", { questionType: null, correctAnswer: A }, false],
    ["correctAnswers på et vanlig spørsmål", { correctAnswer: A, correctAnswers: [A] }, false],
    ["kontroll: vanlig spørsmål", { correctAnswer: A }, true],
  ])("%s", (_navn, question, expected) => {
    const r = bothAgree(question);
    expect(r.real).toBe(expected);
    expect(r.bundled).toBe(expected);
  });
});

describe("#1077 — skillets liste over spørsmålstyper er plattformens", () => {
  it("MCQ_QUESTION_TYPES er den samme", () => {
    expect([...SKILL_MCQ_QUESTION_TYPES]).toEqual([...MCQ_QUESTION_TYPES]);
  });
});
