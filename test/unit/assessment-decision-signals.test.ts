import { describe, expect, it } from "vitest";
import { deriveConfidenceLevel } from "../../src/modules/assessment/assessmentDecisionSignals.js";

// ── #1019: forbeholdet som en verdi ─────────────────────────────────────────────────────────────
//
// ⚠️ Klienten gjettet tidligere på delstrenger i språkmodellens engelske frittekst. Bommet den, sto
// engelsk i et norsk skjermbilde — og notatet er GENERERT, så det kan formuleres om når som helst
// uten at noe i repoet endres. Testene her holder på at nivået kommer fra de STRUKTURERTE feltene,
// som prompten allerede ber om.
describe("#1019 — konfidensnivået utledes av strukturerte felt, ikke av prosa", () => {
  it("språkmodellens eksplisitte lavkonfidens-kode gir lavt nivå", () => {
    expect(deriveConfidenceLevel({ manual_review_reason_code: "low_confidence" })).toBe("low");
  });

  it("utilstrekkelig grunnlag er også lavt — vurderingen bygger på delvis dokumentasjon", () => {
    expect(deriveConfidenceLevel({ evidence_sufficiency: "insufficient" })).toBe("low");
  });

  // ⚠️ Samme tilstand, to felt. Modellen kan melde utilstrekkelig grunnlag enten som
  // `evidence_sufficiency` eller som `manual_review_reason_code`. Svarer vi ulikt på de to, avhenger
  // det deltakeren ser av hvilket felt modellen tilfeldigvis fylte ut.
  it("utilstrekkelig grunnlag gir lavt nivå uansett hvilket felt det står i", () => {
    expect(deriveConfidenceLevel({ evidence_sufficiency: "insufficient" })).toBe("low");
    expect(deriveConfidenceLevel({ manual_review_reason_code: "insufficient_evidence" })).toBe("low");
  });

  it("usikkert grunnlag er middels", () => {
    expect(deriveConfidenceLevel({ evidence_sufficiency: "uncertain" })).toBe("medium");
  });

  // ⚠️ «Høy konfidens» er IKKE et forbehold. En rad som forteller deltakeren at alt er som det skal,
  // bruker plass uten å si noe — samme regel som #940 innførte for de tomme radene.
  it("tilstrekkelig grunnlag gir INGEN rad", () => {
    expect(deriveConfidenceLevel({ evidence_sufficiency: "sufficient" })).toBeNull();
  });

  // Feltene er valgfrie i skjemaet. Et svar uten dem skal gi taushet, ikke en gjetning.
  it("uten strukturerte felt sies ingenting", () => {
    expect(deriveConfidenceLevel({})).toBeNull();
  });

  // Blokkeringens makker: den eksplisitte koden skal vinne over et tilstrekkelig grunnlag, ellers
  // ville en modell som sier «lav konfidens, men nok dokumentasjon» blitt stum.
  it("den eksplisitte koden vinner over grunnlagsvurderingen", () => {
    expect(deriveConfidenceLevel({
      manual_review_reason_code: "low_confidence",
      evidence_sufficiency: "sufficient",
    })).toBe("low");
  });
});
