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


  // ⚠️ DEN VIKTIGSTE, OG DEN BLE FUNNET AV EKTE DATA — ikke av resonnement.
  //
  // Et første utkast lot «utilstrekkelig grunnlag» bety «lav konfidens». Ti ekte vurderinger på
  // stage viste at det er feil, og ofte det motsatte: der grunnlaget var utilstrekkelig, skrev
  // modellen selv «Det er høy sikkerhet i vurderingen på grunn av svarets svært begrensede
  // innhold». Leverer noen noe tomt, er modellen nettopp SIKKER på at det stryker.
  //
  // De to feltene svarer på ulike spørsmål: «var det nok i besvarelsen?» og «hvor sikker er
  // dommen?». Å si «lav sikkerhet, du kan klage» til en som leverte tomt, er usant.
  it("utilstrekkelig grunnlag er IKKE lav konfidens — det er et utsagn om besvarelsen", () => {
    expect(deriveConfidenceLevel({ evidence_sufficiency: "insufficient" })).toBeNull();
    expect(deriveConfidenceLevel({ manual_review_reason_code: "insufficient_evidence" })).toBeNull();
  });

  // Blokkeringens makker: ekte usikkerhet skal fortsatt gi et nivå, ellers ville testen over vært
  // grønn for en funksjon som alltid svarer null.
  it("men ekte usikkerhet gir det fortsatt", () => {
    expect(deriveConfidenceLevel({ manual_review_reason_code: "low_confidence" })).toBe("low");
    expect(deriveConfidenceLevel({ evidence_sufficiency: "uncertain" })).toBe("medium");
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
