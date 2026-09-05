import { describe, expect, it } from "vitest";
import {
  evaluateSecondaryAssessmentTrigger,
  type SecondaryAssessmentPolicy,
} from "../../src/modules/assessment/secondaryAssessmentService.js";
import { getAssessmentRules } from "../../src/config/assessmentRules.js";
import type { LlmStructuredAssessment } from "../../src/modules/assessment/llmAssessmentService.js";

// ─────────────────────────────────────────────────────────────────────────────
// #1023: nærhet til en SONEGRENSE utløser en ny vurdering.
//
// ⚠️ HVORFOR DENNE ERSTATTER KONFIDENSGJETTINGEN. Vi ba modellen fortelle om den var usikker, og
// brukte svaret til å avgjøre om vi skulle gjøre den ene tingen som faktisk måler usikkerhet:
// vurdere en gang til. Målt over 63 ekte vurderinger satte modellen ALDRI `low_confidence`, og
// delstreng-reserven leter etter engelske ord i et notat som nå skrives på deltakerens språk.
//
// Poengsummen er derimot vår egen, og den er den samme uansett språk. Målt på 88 ekte vurderinger
// kommer den i hopp på fem — rubrikken er fem kriterier à 0–4, skalert til 100 — mens grensene er
// skarpe. En kandidat på 55 stryker automatisk; en på 60 går til et menneske. ETT trinn.
//
// Grensene: `totalMin` (bestått) og `totalMin - borderlineBelowMin` (grensetilfelle/stryk).
// ─────────────────────────────────────────────────────────────────────────────

const regler = getAssessmentRules();
const BESTÅTT_GRENSE = regler.thresholds.totalMin;
const STRYK_GRENSE = BESTÅTT_GRENSE - (regler.thresholds.borderlineBelowMin ?? 0);

const resultat = (over: Partial<LlmStructuredAssessment> = {}): LlmStructuredAssessment => ({
  module_id: "m1",
  rubric_scores: {},
  rubric_total: 10,
  practical_score_scaled: 50,
  pass_fail_practical: false,
  criterion_rationales: {},
  improvement_advice: [],
  red_flags: [],
  manual_review_recommended: false,
  confidence_note: "",
  evidence_sufficiency: "sufficient",
  recommended_outcome: "fail",
  manual_review_reason_code: "none",
  ...over,
}) as LlmStructuredAssessment;

/** En policy der ALLE andre utløsere er av, så bare grenseregelen kan fyre. */
function bareGrenser(bånd: { greenYellow: number | null; yellowRed: number | null }): SecondaryAssessmentPolicy {
  return {
    ...regler.secondaryAssessment,
    enabledByDefault: true,
    moduleOverrides: {},
    triggerRules: {
      manualReviewRecommended: false,
      confidenceNotePatterns: [],
      redFlagCodes: [],
      redFlagSeverities: [],
      scoreBoundaryBands: bånd,
    },
  } as SecondaryAssessmentPolicy;
}

const kjør = (totalScore: number | null, bånd: { greenYellow: number | null; yellowRed: number | null }) =>
  evaluateSecondaryAssessmentTrigger({ moduleId: "m1", primaryResult: resultat(), totalScore }, bareGrenser(bånd));

describe("#1023 — poengsum nær en sonegrense utløser en ny vurdering", () => {
  it("terskelverdiene er de vedtaket bruker — kontrollcase", () => {
    // ⚠️ Uten denne kan hele testfila bli grønn på gale tall: leser den 0 og 0, ligger ALT innenfor
    // ethvert bånd, og «regelen fyrer» beviser ingenting.
    expect(BESTÅTT_GRENSE, "totalMin skal være satt").toBeGreaterThan(0);
    expect(STRYK_GRENSE, "stryk-grensen skal ligge under bestått-grensen").toBeLessThan(BESTÅTT_GRENSE);
  });

  it("fyrer når poengsummen ligger på stryk-grensen", () => {
    expect(kjør(STRYK_GRENSE, { greenYellow: null, yellowRed: 5 }).reasons).toContain("score_near_fail_boundary");
  });

  it("fyrer på begge sider av grensen, ikke bare under", () => {
    // Et trinn ned er automatisk stryk, et trinn opp er manuell vurdering. Begge fortjener et blikk til.
    expect(kjør(STRYK_GRENSE - 5, { greenYellow: null, yellowRed: 5 }).reasons).toContain("score_near_fail_boundary");
    expect(kjør(STRYK_GRENSE + 5, { greenYellow: null, yellowRed: 5 }).reasons).toContain("score_near_fail_boundary");
  });

  it("fyrer IKKE når poengsummen er langt fra grensen", () => {
    // Blokkeringens makker. Uten denne ville en regel som alltid fyrer stått som bestått.
    expect(kjør(STRYK_GRENSE - 20, { greenYellow: null, yellowRed: 5 }).reasons).not.toContain("score_near_fail_boundary");
    expect(kjør(100, { greenYellow: null, yellowRed: 5 }).reasons).not.toContain("score_near_fail_boundary");
  });

  it("respekterer båndbredden fra regelfila", () => {
    const like_utenfor = STRYK_GRENSE - 6;
    expect(kjør(like_utenfor, { greenYellow: null, yellowRed: 5 }).reasons).not.toContain("score_near_fail_boundary");
    expect(kjør(like_utenfor, { greenYellow: null, yellowRed: 8 }).reasons).toContain("score_near_fail_boundary");
  });

  it("null slår av grensen helt", () => {
    expect(kjør(STRYK_GRENSE, { greenYellow: null, yellowRed: null }).reasons).not.toContain("score_near_fail_boundary");
    expect(kjør(STRYK_GRENSE, { greenYellow: null, yellowRed: null }).shouldRun).toBe(false);
  });

  it("de to grensene er uavhengige", () => {
    const påBestått = kjør(BESTÅTT_GRENSE, { greenYellow: 3, yellowRed: null });
    expect(påBestått.reasons).toContain("score_near_pass_boundary");
    expect(påBestått.reasons).not.toContain("score_near_fail_boundary");

    const påStryk = kjør(STRYK_GRENSE, { greenYellow: null, yellowRed: 3 });
    expect(påStryk.reasons).toContain("score_near_fail_boundary");
    expect(påStryk.reasons).not.toContain("score_near_pass_boundary");
  });

  it("en manglende poengsum fyrer ikke, og velter ikke de andre utløserne", () => {
    // ⚠️ `null` betyr «kalleren kunne ikke regne den ut». Da skal grenseregelen tie — ikke kaste,
    // og ikke gjette. En feil i poengberegningen skal koste oss en ekstra vurdering, ikke et vedtak.
    for (const verdi of [null, undefined, Number.NaN]) {
      const d = kjør(verdi as number | null, { greenYellow: 5, yellowRed: 5 });
      expect(d.reasons).not.toContain("score_near_fail_boundary");
      expect(d.reasons).not.toContain("score_near_pass_boundary");
    }
  });
});
