import { describe, expect, it } from "vitest";
import { exportEnvelopeSchema } from "../../src/modules/adminContent/adminContentSchemas.js";
import {
  synthesizeSectionEnvelope,
  synthesizeModuleEnvelope,
  synthesizeStandaloneEnvelopes,
  synthesizeEnvelope,
} from "../../skills/a2-authoring-api/scripts/synthesize-envelopes.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// #987: skillets emittere måles mot SERVERENS ekte skjema, ikke mot skillets egen validator.
//
// ⚠️ Dette er hele poenget med testen. Skillet har sin egen `export-validate.mjs` som skal speile
// importens skjema — to beskrivelser av samme kontrakt, som kan drifte fra hverandre uten at noen
// ser det. Nettopp den driften er årsaken til #987: `scope: "section"` kom med #916, og skillet
// fikk aldri vite om det.
//
// En test som bare kjørte skillets egen validator ville vært grønn hele veien mens produkteier fikk
// filer importen avviste. Derfor importeres `exportEnvelopeSchema` fra src/ her — den ENE kontrakten
// som faktisk avgjør om en fil kan importeres.
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_PAYLOAD = {
  title: { "en-GB": "Classical LLM", nb: "Klassisk LLM", nn: "Klassisk LLM" },
  bodyMarkdown: { "en-GB": "# Classical LLM", nb: "# Klassisk LLM", nn: "# Klassisk LLM" },
  assets: [
    {
      sourceId: "klassisk-llm-flyt",
      filename: "diagram.svg",
      mimeType: "image/svg+xml",
      sizeBytes: 2352,
      contentBase64: "PHN2Zz48L3N2Zz4=",
      sourceLocale: "nb",
      localizedVariants: [
        { locale: "nn", contentBase64: "PHN2Zz48L3N2Zz4=" },
        { locale: "en-GB", contentBase64: "PHN2Zz48L3N2Zz4=" },
      ],
    },
  ],
};

// ⚠️ Alle tre språk, med vilje. MODUL-tittelen valideres med `localizedTextSchema`: enten en REN
// STRENG (= ett språk, ikke oversatt) eller ALLE tre. Et delvis objekt som `{ nb: "Modul" }` er
// ugyldig — det er nettopp mellomtilstanden #892 finnes for å hindre.
//
// SEKSJONER er mildere (`localizedTextPatchSchema`) og godtar delvis utfylling. Asymmetrien er ekte
// og lett å snuble i: en emitter testet med bare seksjoner ville sett riktig ut helt til noen
// eksporterte en modul. Første utkast av denne testen gjorde nøyaktig det.
const MODULE_PAYLOAD = {
  module: { title: { "en-GB": "Module", nb: "Modul", nn: "Modul" } },
  activeVersion: {
    taskText: { "en-GB": "Task", nb: "Oppgave", nn: "Oppgåve" },
    audit: { publishedAt: "2026-01-01T00:00:00.000Z" },
  },
};

describe("#987: skillets emittere produserer konvolutter importen godtar", () => {
  it("en seksjon blir en gyldig scope:section-konvolutt", () => {
    const envelope = synthesizeSectionEnvelope(SECTION_PAYLOAD);
    const parsed = exportEnvelopeSchema.safeParse(envelope);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
    expect(envelope.scope).toBe("section");
  });

  it("innholdet bæres uendret over — særlig figurene", () => {
    const { section } = synthesizeSectionEnvelope(SECTION_PAYLOAD);

    // Alle tre språk overlever. En emitter som mistet ett ville gitt en fil som importerer fint og
    // er stille feil — verre enn en som avvises.
    expect(Object.keys(section.title)).toEqual(["en-GB", "nb", "nn"]);
    expect(Object.keys(section.bodyMarkdown)).toEqual(["en-GB", "nb", "nn"]);

    // ⚠️ `localizedVariants` er den delen som er lettest å miste: den er valgfri i skjemaet, så en
    // emitter som droppet den ville bestått en ren skjemavalidering. Da ville SVG-en importert med
    // bare kildespråket, og en nn-deltaker fått norsk bokmål i figuren.
    expect(section.assets?.[0].localizedVariants).toHaveLength(2);
    expect(section.assets?.[0].sourceId).toBe("klassisk-llm-flyt");
  });

  it("audit tømmes — en plan har ingen publiseringshistorikk å bære over", () => {
    const { section } = synthesizeSectionEnvelope(SECTION_PAYLOAD);
    expect(section.audit).toEqual({});

    // Modulen har en publishedAt i kilden. Den skal IKKE følge med: `audit.publishedAt` er det
    // importen bruker til å avgjøre auto-publisering, så å bære den over kunne gjort innhold synlig
    // for deltakere uten at noen trykket publiser.
    const { module } = synthesizeModuleEnvelope(MODULE_PAYLOAD);
    expect(module?.activeVersion.audit).toEqual({});
  });

  it("en modul blir en gyldig scope:module-konvolutt", () => {
    const parsed = exportEnvelopeSchema.safeParse(synthesizeModuleEnvelope(MODULE_PAYLOAD));
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
  });

  it("en hel plan gir én konvolutt per isolert seksjon og modul", () => {
    const pkg = {
      packageFormat: "a2-authoring-package/v1",
      objects: [
        { clientRef: "sek-1", type: "section", payload: SECTION_PAYLOAD },
        { clientRef: "mod-1", type: "module", payload: MODULE_PAYLOAD },
        { clientRef: "kurs-1", type: "course", payload: { course: {} } },
      ],
    };
    const out = synthesizeStandaloneEnvelopes(pkg);

    // Kurs hoppes over: en kurskonvolutt har kryssreferanser til de andre objektene og kan ikke
    // bygges fra ett objekt alene. Filveien for hele kurs er dokumentert og urørt av #987.
    expect(out.map((o) => o.clientRef)).toEqual(["sek-1", "mod-1"]);
    for (const o of out) {
      expect(exportEnvelopeSchema.safeParse(o.envelope).success, `${o.clientRef} validerte ikke`).toBe(true);
    }
  });

  it("ukjent objekttype navngis i feilen, ikke bare avvises", () => {
    // En agent som treffer denne skal vite HVA som manglet. «Noe gikk galt» sender den tilbake til
    // å gjette — og forrige gang den gjettet, leverte den planen sin som importfil.
    expect(() => synthesizeEnvelope({ type: "quiz", payload: {} })).toThrow(/quiz/);
    expect(() => synthesizeEnvelope({ type: "course", payload: {} })).toThrow(/SKILL\.md/);
  });

  it("manglende felter avvises før de blir en ugyldig fil", () => {
    // ⚠️ Castet er nødvendig fordi typene fanger dette på kompileringstid — men runtime-vakta er
    // IKKE overflødig av den grunn: emitterne kjøres også direkte som .mjs av en agent, uten
    // typesjekk i det hele tatt. Det er nettopp den kalleren som sist leverte feil format.
    const utenBody = { title: { nb: "T" } } as unknown as Parameters<typeof synthesizeSectionEnvelope>[0];
    const utenVersjon = { module: {} } as unknown as Parameters<typeof synthesizeModuleEnvelope>[0];
    expect(() => synthesizeSectionEnvelope(utenBody)).toThrow(/bodyMarkdown/);
    expect(() => synthesizeModuleEnvelope(utenVersjon)).toThrow(/activeVersion/);
  });
});
