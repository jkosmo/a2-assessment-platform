import { describe, expect, it } from "vitest";
import {
  DECISION_REASON_KEYS,
  decisionReasonKeyFor,
  fillReasonPlaceholders,
  localizeDecisionReason,
} from "../../public/static/decision-reason.js";
// ⚠️ .ts med vilje. Denne testfila er .js (den prøver en .js-modul), og da resolver ikke vitest
// ".js" videre til TypeScript-kilden slik den gjør fra en .ts-fil. Kilden må navngis som den er.
import { ALL_DECISION_REASON_CODES } from "../../src/modules/assessment/decisionReason.ts";
import { translations } from "../../public/i18n/participant-translations.js";
import {
  resolveAssessmentDecision,
  resolveMcqOnlyDecision,
} from "../../src/modules/assessment/decisionService.ts";
import { buildAiInfluenceOutcome } from "../../src/modules/assessment/aiInfluence.ts";

// Et LLM-svar som består: rubric_total må stemme med summen av rubric_scores, ellers slår
// «poengsummene gikk ikke opp»-grenen inn og vi måler feil kode.
const PASSING_LLM_RESULT = {
  module_id: "unit_module",
  rubric_scores: { c1: 3, c2: 3, c3: 2, c4: 3, c5: 3 },
  rubric_total: 14,
  practical_score_scaled: 49,
  pass_fail_practical: true,
  criterion_rationales: {},
  improvement_advice: [],
  red_flags: [],
  manual_review_recommended: false,
  confidence_note: "High confidence.",
  evidence_sufficiency: "sufficient",
  recommended_outcome: "pass",
  manual_review_reason_code: "none",
};

const LOCALES = ["en-GB", "nb", "nn"];

// En «oversetter» som slår opp i ett bestemt språk, akkurat som `t()` i participant.js — den gir
// nøkkelen tilbake når den mangler.
const translatorFor = (locale) => (key) => translations[locale][key] ?? key;

describe("#950 — vakten mot at kart og server driver fra hverandre", () => {
  // ⚠️ DEN VIKTIGSTE TESTEN I FILA. Hele feilen var at klienten hadde en oppføring for en streng
  // serveren hadde sluttet å sende, og ingen oppføring for flere grunner den faktisk sendte.
  // Ingenting sa fra — oppslaget bommet bare, og deltakeren fikk engelsk. Denne testen gjør at en
  // ny grunn på serveren IKKE kan nå produksjon uten oversettelse.
  it("hver eneste grunnkode serveren kan sende har en nøkkel på klienten", () => {
    const missing = ALL_DECISION_REASON_CODES.filter((code) => !DECISION_REASON_KEYS[code]);
    expect(missing).toEqual([]);
  });

  it("hver nøkkel finnes på alle tre språk", () => {
    const missing = [];
    for (const key of Object.values(DECISION_REASON_KEYS)) {
      for (const locale of LOCALES) {
        if (!translations[locale][key]) missing.push(`${locale}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  // KI-erklæringen har to varianter — med og uten deltakerens egen beskrivelse. Varianten med
  // beskrivelse står ikke i kartet, så den forrige testen dekker den ikke.
  it("varianten med deltakerens egen beskrivelse finnes også på alle tre språk", () => {
    const key = decisionReasonKeyFor("MANUAL_REVIEW_AI_DECLARATION", { description: "noe" });
    expect(key).toBe("result.decisionReasonCode.aiDeclarationDescribed");
    for (const locale of LOCALES) {
      expect(translations[locale][key]).toBeTruthy();
    }
  });

  // Denne sammenligner bare språkfilene MOT HVERANDRE. Den fanger at nn har glemt et tall bokmål
  // har, men ikke at serveren har byttet navn på det. Det gjør testene lenger nede.
  it("plassholderne i oversettelsene har samme navn på alle tre språk", () => {
    const namesIn = (text) => (text.match(/\{(\w+)\}/g) ?? []).sort().join(",");
    for (const key of [...Object.values(DECISION_REASON_KEYS), "result.decisionReasonCode.aiDeclarationDescribed"]) {
      const expected = namesIn(translations["en-GB"][key]);
      for (const locale of LOCALES) {
        expect(`${locale} ${key}: ${namesIn(translations[locale][key])}`).toBe(`${locale} ${key}: ${expected}`);
      }
    }
  });
});

describe("#950 — koden avgjør, ikke teksten", () => {
  // ⚠️ Grunnen med tall i seg var den som ALDRI kunne oversettes av det gamle kartet, og den
  // vanligste veien gjennom systemet: en ren flervalgsmodul. Det var denne produkteier så på stage.
  it("en ren flervalgsmodul får tallene sine inn i en norsk setning", () => {
    const shown = localizeDecisionReason(
      {
        decisionReason: "Automatic pass: MCQ score 100% meets the required minimum of 70%.",
        decisionReasonCode: "MCQ_ONLY_PASS",
        decisionReasonParams: { scorePercent: 100, minPercent: 70 },
      },
      translatorFor("nb"),
    );

    expect(shown).toBe("Bestått: du fikk 100 %, og kravet var 70 %.");
    expect(shown).not.toContain("{");
  });

  it("grenseområdet får begge grensene og poengsummen", () => {
    const shown = localizeDecisionReason(
      {
        decisionReason: "Routed to manual review: total score 64 is in the borderline window [60, 70].",
        decisionReasonCode: "MANUAL_REVIEW_BORDERLINE",
        decisionReasonParams: { totalScore: 64, min: 60, max: 70 },
      },
      translatorFor("nn"),
    );

    expect(shown).toContain("64");
    expect(shown).toContain("60");
    expect(shown).toContain("70");
    expect(shown).not.toContain("{");
  });

  // ⚠️ DEN ANDRE VIKTIGE. Feltet inneholder også fritekst en sensor eller klagebehandler har
  // skrevet selv. Å «oversette» den ville byttet ut et menneskes egne ord med en standardsetning.
  // Fravær av kode ER signalet om at teksten er et menneskes.
  it("en grunn uten kode er et menneskes egne ord, og vises ordrett", () => {
    const written = "Vurdert på nytt etter klage: kandidaten dokumenterte praksisen godt nok.";
    const shown = localizeDecisionReason(
      { decisionReason: written, decisionReasonCode: null, decisionReasonParams: {} },
      translatorFor("nb"),
    );

    expect(shown).toBe(written);
  });

  // En rad lagret før kodene fantes har heller ingen kode. Serverens tekst er da alt vi har, og
  // den er bedre enn ingenting.
  it("en gammel rad uten kode viser den lagrede teksten", () => {
    const shown = localizeDecisionReason(
      { decisionReason: "Automatic pass by threshold rules." },
      translatorFor("nb"),
    );

    expect(shown).toBe("Automatic pass by threshold rules.");
  });

  it("ingen grunn i det hele tatt gir en strek, ikke «undefined»", () => {
    expect(localizeDecisionReason(null, translatorFor("nb"))).toBe("-");
    expect(localizeDecisionReason({}, translatorFor("nb"))).toBe("-");
  });

  // ⚠️ En klient som er eldre enn serveren møter en kode den ikke kjenner. Da er serverens engelske
  // setning det beste vi har — bedre enn å vise koden, og bedre enn å skjule grunnen.
  it("en ukjent kode faller tilbake til serverens tekst, ikke til koden", () => {
    const shown = localizeDecisionReason(
      {
        decisionReason: "Automatic fail for some new reason.",
        decisionReasonCode: "SOMETHING_ADDED_LATER",
        decisionReasonParams: {},
      },
      translatorFor("nb"),
    );

    expect(shown).toBe("Automatic fail for some new reason.");
  });

  // Samme fall når koden er kjent, men språkfila mangler nøkkelen: `t()` gir nøkkelen tilbake, og
  // «result.decisionReasonCode.autoPass» på skjermen er verre enn en engelsk setning.
  it("en manglende oversettelse gir teksten, ikke nøkkelen", () => {
    const shown = localizeDecisionReason(
      {
        decisionReason: "Automatic pass by threshold rules.",
        decisionReasonCode: "AUTO_PASS_THRESHOLDS",
        decisionReasonParams: {},
      },
      (key) => key,
    );

    expect(shown).toBe("Automatic pass by threshold rules.");
  });

  it("KI-erklæringen uten beskrivelse får ingen tomme anførselstegn hengende bakerst", () => {
    const withoutDescription = localizeDecisionReason(
      { decisionReason: "x", decisionReasonCode: "MANUAL_REVIEW_AI_DECLARATION", decisionReasonParams: { description: "" } },
      translatorFor("nb"),
    );
    const withDescription = localizeDecisionReason(
      { decisionReason: "x", decisionReasonCode: "MANUAL_REVIEW_AI_DECLARATION", decisionReasonParams: { description: "Brukte KI til alt" } },
      translatorFor("nb"),
    );

    expect(withoutDescription).not.toContain("«");
    expect(withDescription).toContain("«Brukte KI til alt»");
  });
});

describe("#950 — innsetting av tall", () => {
  it("setter inn hver plassholder, også når den står flere ganger", () => {
    expect(fillReasonPlaceholders("{a} og {a} og {b}", { a: 1, b: "to" })).toBe("1 og 1 og to");
  });

  it("lar en plassholder uten verdi stå, i stedet for å skrive «undefined»", () => {
    expect(fillReasonPlaceholders("{a} og {b}", { a: 1 })).toBe("1 og {b}");
  });
});

// ⚠️ QA-porten 2026-08-27: testen over var grønn uansett hva serveren sendte — den holdt bare
// språkfilene opp mot hverandre. Døper man om `scorePercent` i decisionService, forblir alt grønt
// mens deltakeren ser «du fikk {scorePercent} %» på skjermen. Testene under kjører de EKTE
// serverfunksjonene og krever at setningen kommer ut ferdig utfylt.
describe("#950 — serverens parameternavn mot de ekte setningene", () => {
  const renderAll = (code, params) =>
    LOCALES.map((locale) =>
      localizeDecisionReason(
        { decisionReason: "kildetekst", decisionReasonCode: code, decisionReasonParams: params },
        translatorFor(locale),
      ),
    );

  const expectComplete = (code, params, mustContain) => {
    for (const [i, sentence] of renderAll(code, params).entries()) {
      expect(`${LOCALES[i]}: ${sentence}`).not.toMatch(/\{\w+\}/);
      // ⚠️ Ikke bare «ingen krøllparenteser igjen». En oversettelse som DROPPER plassholderen
      // ville også bestått det — og da mistet deltakeren tallet uten at noe sa fra.
      for (const value of mustContain) {
        expect(`${LOCALES[i]}: ${sentence}`).toContain(String(value));
      }
    }
  };

  it("ren flervalgsmodul: tallene serveren regner ut havner i setningen", () => {
    const passed = resolveMcqOnlyDecision(100, 70);
    expect(passed.decisionReasonCode).toBe("MCQ_ONLY_PASS");
    expectComplete(passed.decisionReasonCode, passed.decisionReasonParams, [100, 70]);

    const failed = resolveMcqOnlyDecision(60, 70);
    expect(failed.decisionReasonCode).toBe("MCQ_ONLY_FAIL");
    expectComplete(failed.decisionReasonCode, failed.decisionReasonParams, [60, 70]);
  });

  it("grenseområdet: begge grensene og poengsummen kommer fra serveren", () => {
    const resolved = resolveAssessmentDecision({
      mcqScaledScore: 30,
      mcqPercentScore: 100,
      llmResult: PASSING_LLM_RESULT,
      rubricMaxTotal: 20,
      rubricCriteriaIds: ["c1", "c2", "c3", "c4", "c5"],
      assessmentPolicy: { passRules: { borderlineWindow: { min: 60, max: 90 } } },
    });

    expect(resolved.decisionReasonCode).toBe("MANUAL_REVIEW_BORDERLINE");
    expectComplete(resolved.decisionReasonCode, resolved.decisionReasonParams, [
      resolved.decisionReasonParams.totalScore,
      60,
      90,
    ]);
  });

  it("innholdslikhet: prosentene kommer fra det ekte signalet", () => {
    const outcome = buildAiInfluenceOutcome({
      declaration: undefined,
      declarationResult: null,
      contentSignal: { similarity: 0.87, threshold: 0.8, exceeded: true, forcesReview: true },
    });

    expect(outcome.decision?.code).toBe("MANUAL_REVIEW_CONTENT_SIMILARITY");
    expectComplete(outcome.decision.code, outcome.decision.params, [87, 80]);
  });

  it("KI-erklæring: deltakerens egen beskrivelse følger med ordrett", () => {
    const outcome = buildAiInfluenceOutcome({
      declaration: "autonomous",
      declarationResult: {
        forcesReview: true,
        reason: "x",
        code: "MANUAL_REVIEW_AI_DECLARATION",
        params: { description: "Jeg brukte en språkmodell til hele utkastet." },
      },
      contentSignal: null,
    });

    expectComplete(outcome.decision.code, outcome.decision.params, [
      "Jeg brukte en språkmodell til hele utkastet.",
    ]);
  });

  // Kodene UTEN tall skal heller ikke ha plassholdere liggende igjen i noen språkfil.
  it("grunner uten tall har ingen plassholdere i det hele tatt", () => {
    const withParams = new Set([
      "MCQ_ONLY_PASS",
      "MCQ_ONLY_FAIL",
      "MANUAL_REVIEW_BORDERLINE",
      "MANUAL_REVIEW_CONTENT_SIMILARITY",
      "MANUAL_REVIEW_AI_DECLARATION",
    ]);

    for (const code of ALL_DECISION_REASON_CODES.filter((c) => !withParams.has(c))) {
      for (const sentence of renderAll(code, {})) {
        expect(`${code}: ${sentence}`).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
