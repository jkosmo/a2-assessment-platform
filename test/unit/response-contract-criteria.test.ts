import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getAssessmentRules } from "../../src/config/assessmentRules.js";
import { buildRequiredResponseContract } from "../../src/modules/assessment/llmAssessmentService.js";

// ─────────────────────────────────────────────────────────────────────────────
// VAKT (#1023): hver verdi modellen kan velge mellom, må ha et kriterium for NÅR den gjelder.
//
// ⚠️ HVA SOM VAR GALT. Responskontrakten listet `manual_review_reason_code` og
// `evidence_sufficiency` som rene lister over tillatte verdier:
//
//     - manual_review_reason_code: one of none, red_flag, borderline, low_confidence, …
//
// mens `red_flags` rett over fikk kriterier per kode. Målt over 48 ekte vurderinger på stage satte
// modellen ALDRI `low_confidence` og aldri `uncertain`. Den fikk aldri vite hva den skulle se etter.
//
// ⚠️ HVORFOR EN VAKT OG IKKE BARE EN OPPRYDDING. Neste verdi som legges til i en enum blir stille
// ubrukelig på nøyaktig samme måte — den står i lista, ingen tester feiler, og feltet dør i det
// stille. Det tok 48 målte vurderinger å oppdage det denne gangen.
//
// Verdiene leses fra KONTRAKTTEKSTEN, ikke fra en liste her: en liste måtte vedlikeholdes, og en
// glemt oppdatering ville gjort vakta stille.
// ─────────────────────────────────────────────────────────────────────────────

const kilde = readFileSync(
  fileURLToPath(new URL("../../src/modules/assessment/llmAssessmentService.ts", import.meta.url)),
  "utf8",
);

/** Verdiene slik de faktisk står i kontrakten modellen får. */
function verdierFraKontrakten(felt: string): string[] {
  const m = new RegExp(`- ${felt}: one of ([^\n]+)`).exec(kilde);
  if (!m) return [];
  return m[1].split(",").map((v) => v.trim()).filter(Boolean);
}

const FELT = [
  { kontrakt: "manual_review_reason_code", regel: "manualReviewReasonDescriptions" },
  { kontrakt: "evidence_sufficiency", regel: "evidenceSufficiencyDescriptions" },
] as const;

describe("#1023 — hver verdi i responskontrakten har et bruksKRITERIUM", () => {
  it("finner verdiene i kontrakten — kontrollcase", () => {
    // ⚠️ Uten denne er hele vakta grønn hvis regexet slutter å treffe eller kontrakten skrives om.
    // «Null verdier å sjekke» og «alle verdier er i orden» ser identiske ut nedenfra.
    for (const { kontrakt } of FELT) {
      expect(verdierFraKontrakten(kontrakt).length, `${kontrakt} skal ha verdier i kontrakten`)
        .toBeGreaterThanOrEqual(3);
    }
  });

  it("hver verdi har et kriterium i regelfila", () => {
    const rules = getAssessmentRules().llmDecisionReliability;
    const mangler: string[] = [];
    for (const { kontrakt, regel } of FELT) {
      const beskrivelser = rules[regel] ?? {};
      for (const verdi of verdierFraKontrakten(kontrakt)) {
        const tekst = beskrivelser[verdi];
        if (typeof tekst !== "string" || tekst.trim().length === 0) mangler.push(`${kontrakt}.${verdi}`);
      }
    }
    expect(
      mangler.join("\n"),
      "En verdi uten kriterium blir stille ubrukelig: den står i lista, ingenting feiler,\n" +
        "og modellen velger den aldri. Legg kriteriet i config/assessment-rules.json.",
    ).toBe("");
  });

  it("low_confidence sier eksplisitt at det IKKE er det samme som en svak besvarelse", () => {
    // ⚠️ Nettopp den forvekslingen kostet oss #1019: et første utkast lot
    // `evidence_sufficiency: insufficient` bety «lav konfidens». Ekte data viste det motsatte —
    // modellen er som regel SIKKER på at en tom besvarelse stryker. Kriteriet må derfor skille
    // «min egen usikkerhet» fra «for lite å vurdere», ellers gjentar vi feilen i prompten.
    const rules = getAssessmentRules().llmDecisionReliability;
    const tekst = (rules.manualReviewReasonDescriptions ?? {})["low_confidence"] ?? "";
    expect(tekst.toLowerCase(), "kriteriet skal peke på insufficient_evidence som det andre valget")
      .toContain("insufficient_evidence");
  });
  it("kriteriene står FAKTISK i teksten modellen får", () => {
    // ⚠️ De tre testene over sjekker at kriteriene finnes i regelfila. Det er ikke det samme som at
    // de når fram. Mutasjonstesting avslørte hullet: jeg slo av gjengivelsen i kontrakten, og alle
    // testene forble grønne. Kriteriene ville da ligget pent i konfigurasjonen mens modellen fikk
    // den samme nakne verdilista som før — nøyaktig feilen saken handler om, ett lag lenger ned.
    const kontrakt = buildRequiredResponseContract(["task_comprehension", "quality_and_depth"]);
    const rules = getAssessmentRules().llmDecisionReliability;
    for (const felt of ["manualReviewReasonDescriptions", "evidenceSufficiencyDescriptions"] as const) {
      const beskrivelser = rules[felt] ?? {};
      for (const [kode, tekst] of Object.entries(beskrivelser)) {
        expect(kontrakt, `${kode} skal navngis i kontrakten`).toContain(`- ${kode} — `);
        // Selve setningen, ikke bare koden: en kode uten sin tekst hjelper ikke modellen.
        expect(kontrakt, `${kode} skal bære sitt kriterium`).toContain(tekst.slice(0, 40));
      }
    }
  });
});
