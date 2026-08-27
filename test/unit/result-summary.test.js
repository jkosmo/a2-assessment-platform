import { describe, expect, it } from "vitest";
import {
  ROWS,
  buildHeadline,
  planRows,
  readDetailsOpen,
  resolveOutcome,
  writeDetailsOpen,
} from "../../public/static/result-summary.js";
import { translations } from "../../public/i18n/participant-translations.js";

describe("#940 — utfallet, som én verdi", () => {
  // ⚠️ DEN VIKTIGSTE. `passFailTotal` er false for en besvarelse som ligger til manuell vurdering —
  // bestått holdes tilbake med vilje til en sensor har sett på den (decisionService.ts). Leser man
  // det som «ikke bestått», forteller skjermen noen som venter at de strøk.
  it("under vurdering er IKKE ikke-bestått, selv om passFailTotal er false", () => {
    expect(resolveOutcome("UNDER_REVIEW", false)).toBe("review");
    expect(resolveOutcome("UNDER_REVIEW", null)).toBe("review");
  });

  // ⚠️ QA-porten: en AVGJORT status uten vedtak — REJECTED er den ene i enumet — ble tidligere
  // til «Besvarelsen din blir vurdert». Det er en påstand vi ikke har dekning for: ingenting
  // vurderes, og det kommer ikke noe mer. Da skal skjermen si mindre, og la statusen stå åpent.
  it("en avgjort status uten vedtak påstår ikke at noe holder på", () => {
    expect(resolveOutcome("REJECTED", null)).toBe("unknown");
    expect(resolveOutcome("COMPLETED", null)).toBe("unknown");
    expect(buildHeadline("unknown", {}).key).toBe("result.headline.unknown");
    // Statusen er alt vi har, og skal derfor ikke ligge bak et klikk.
    const plan = planRows("unknown", {});
    expect(plan.open).toContain(ROWS.status);
    expect(plan.detail).not.toContain(ROWS.status);
  });

  it("skiller bestått, ikke bestått og ingen avgjørelse ennå", () => {
    expect(resolveOutcome("COMPLETED", true)).toBe("passed");
    expect(resolveOutcome("COMPLETED", false)).toBe("failed");
    expect(resolveOutcome("PROCESSING", null)).toBe("pending");
    expect(resolveOutcome("SUBMITTED", undefined)).toBe("pending");
  });
});

describe("#940 — overskriften", () => {
  const MCQ_ONLY = { isMcqOnly: true, isFreetextOnly: false };

  it("en ren flervalgsmodul viser prosenten og kravet", () => {
    const h = buildHeadline("passed", {
      ...MCQ_ONLY,
      scoreComponents: { mcqPercentScore: 100, mcqScaledScore: 30, totalScore: 30 },
      requirement: { mcqMinPercent: 80 },
    });

    expect(h.key).toBe("result.headline.passedPercent");
    expect(h.params).toEqual({ percent: 100 });
    expect(h.subKey).toBe("result.headline.requirementPercent");
    expect(h.subParams).toEqual({ min: 80 });
  });

  // ⚠️ En modul uten eksplisitt grense har INGEN krav-verdi. «Kravet var undefined» ville vært
  // verre enn å utelate linja — og null her betyr «ikke aktuelt», ikke «ingen grense».
  it("uten et krav i reglene faller underlinja bort, den blir ikke tom", () => {
    const h = buildHeadline("passed", {
      ...MCQ_ONLY,
      scoreComponents: { mcqPercentScore: 100 },
      requirement: { mcqMinPercent: null },
    });

    expect(h.key).toBe("result.headline.passedPercent");
    expect(h.subKey).toBeNull();
    expect(h.subParams).toEqual({});
  });

  // ⚠️ Kjernen i saken: for en REN flervalgsmodul er total og flervalgspoeng samme tall. To rader
  // med samme verdi sier ingenting, og var ett av de åtte elementene som skulle bort.
  it("en ren flervalgsmodul gjentar ikke samme tall på underlinja", () => {
    const h = buildHeadline("passed", {
      ...MCQ_ONLY,
      // ⚠️ practicalScaledScore: 0 er det API-et FAKTISK sender for en ren flervalgsmodul. Et
      // fikstur som utelot feltet kunne ikke nå påstanden i det hele tatt — vakten sto utestet, og
      // en mutasjon som fjernet den forble grønn.
      scoreComponents: { mcqPercentScore: null, mcqScaledScore: 30, practicalScaledScore: 0, totalScore: 30 },
      requirement: { totalMin: 21 },
    });

    expect(h.key).toBe("result.headline.passedScore");
    // ⚠️ QA-porten: en påstand om at subKey IKKE er «parts» ville også vært grønn for regresjonen —
    // med et krav til stede blir nøkkelen «partsWithRequirement», ikke «parts». Påstanden må være
    // at det ikke finnes DELPOENG i det hele tatt.
    expect(h.subParams.parts).toBeUndefined();
    expect(h.subKey).toBe("result.headline.requirementScore");
  });

  it("en blandet modul beholder delpoengene — de er ekte informasjon", () => {
    const h = buildHeadline("passed", {
      isMcqOnly: false,
      isFreetextOnly: false,
      scoreComponents: { mcqScaledScore: 28, practicalScaledScore: 48, totalScore: 76 },
      requirement: { totalMin: 70 },
    });

    expect(h.key).toBe("result.headline.passedScore");
    expect(h.params).toEqual({ score: 76 });
    expect(h.subKey).toBe("result.headline.partsWithRequirement");
    expect(h.subParams.min).toBe(70);
    expect(h.subParams.parts).toEqual([
      { labelKey: "result.headline.partMcq", value: 28 },
      { labelKey: "result.headline.partPractical", value: 48 },
    ]);
  });

  it("en fritekstmodul har ingen flervalgsdel å vise", () => {
    const h = buildHeadline("failed", {
      isMcqOnly: false,
      isFreetextOnly: true,
      scoreComponents: { mcqScaledScore: 0, practicalScaledScore: 40, totalScore: 40 },
      requirement: { totalMin: 70 },
    });

    expect(h.key).toBe("result.headline.failedScore");
    expect(h.subKey).toBe("result.headline.requirementScore");
    expect(h.subParams).toEqual({ min: 70 });
  });

  it("under vurdering sier hva som skjer, ikke hvor mange poeng du fikk", () => {
    const h = buildHeadline("review", {
      scoreComponents: { totalScore: 21 },
      requirement: { totalMin: 21 },
    });

    expect(h.key).toBe("result.headline.review");
    expect(h.subKey).toBe("result.headline.reviewSub");
  });

  it("uten poengsum i det hele tatt vises utfallet alene", () => {
    const h = buildHeadline("passed", { scoreComponents: {}, requirement: {} });
    expect(h.key).toBe("result.headline.passed");
    expect(h.subKey).toBeNull();
  });

  // Råscoren kan være 66.6666…; #546 avgjorde at deltakeren skal se to desimaler.
  it("runder av slik resten av flaten gjør", () => {
    const h = buildHeadline("failed", {
      isMcqOnly: true,
      scoreComponents: { mcqPercentScore: 66.66666 },
      requirement: { mcqMinPercent: 70 },
    });
    expect(h.params).toEqual({ percent: 66.67 });
  });
});

describe("#940 — hva som står åpent", () => {
  // ⚠️ DEN ANDRE VIKTIGE. Én utforming kan ikke tjene begge utfallene: bestod du, er begrunnelsen
  // en detalj; strøk du, er den svaret. Testen holder på at de to faktisk skiller lag.
  it("begrunnelsen er åpen når du IKKE bestod, og skjult når du bestod", () => {
    const failed = planRows("failed", { hasDecisionReason: true });
    const passed = planRows("passed", { hasDecisionReason: true });

    expect(failed.open).toContain(ROWS.decisionReason);
    expect(passed.open).not.toContain(ROWS.decisionReason);
    expect(passed.detail).toContain(ROWS.decisionReason);
  });

  it("den som venter på en sensor får vite hvorfor, uten å klikke", () => {
    const review = planRows("review", { hasDecisionReason: true });
    expect(review.open).toContain(ROWS.decisionReason);
  });

  it("begrunnelsen står bare ETT sted, aldri begge", () => {
    for (const outcome of ["passed", "failed", "review", "pending"]) {
      const { open, detail } = planRows(outcome, { hasDecisionReason: true });
      const both = open.filter((row) => detail.includes(row));
      expect(`${outcome}: ${both.join(",")}`).toBe(`${outcome}: `);
    }
  });

  // «KONFIDENSNOTAT –» var en rad som brukte plass på å si at den var tom.
  it("et tomt konfidensnotat vises ikke i det hele tatt", () => {
    expect(planRows("passed", { hasConfidence: false }).detail).not.toContain(ROWS.confidence);
    expect(planRows("passed", { hasConfidence: true }).detail).toContain(ROWS.confidence);
  });

  it("poengsummen er en detalj når utfallet er avgjort, og synlig mens du venter", () => {
    expect(planRows("passed", {}).detail).not.toContain(ROWS.totalScore);
    expect(planRows("review", {}).detail).toContain(ROWS.totalScore);
  });

  // ⚠️ Funnet ved å SE på den ekte siden i runde 6: vente-tilstanden viste «TOTAL POENGSUM 64» og
  // «MCQ-POENG 64» rett under hverandre. Overskrifta slo dem sammen; detaljradene gjorde det ikke.
  // Ingen måling fanget det — to like tall er ikke et avvik i seg selv.
  it("en modultype med bare én poengkilde gjentar ikke tallet som delrad", () => {
    const mcqOnly = planRows("review", { isMcqOnly: true }).detail;
    expect(mcqOnly).toContain(ROWS.totalScore);
    expect(mcqOnly).not.toContain(ROWS.mcqScore);
    expect(mcqOnly).not.toContain(ROWS.practicalScore);

    const freetextOnly = planRows("review", { isFreetextOnly: true }).detail;
    expect(freetextOnly).toContain(ROWS.totalScore);
    expect(freetextOnly).not.toContain(ROWS.mcqScore);
    expect(freetextOnly).not.toContain(ROWS.practicalScore);

    // Blokkeringens makker: en BLANDET modul har to ekte kilder, og skal beholde begge.
    const mixed = planRows("review", {}).detail;
    expect(mixed).toContain(ROWS.mcqScore);
    expect(mixed).toContain(ROWS.practicalScore);
  });

  // Forsøks-ID-en er FLYTTET, ikke fjernet — den trengs når noe skal ettergås (#939).
  it("forsøks-ID-en finnes fortsatt, bak detaljene", () => {
    for (const outcome of ["passed", "failed", "review", "pending"]) {
      expect(planRows(outcome, {}).detail).toContain(ROWS.submissionId);
      expect(planRows(outcome, {}).open).not.toContain(ROWS.submissionId);
    }
  });
});

describe("#940 — å huske at detaljene var åpne", () => {
  function fakeStorage() {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, v),
    };
  }

  it("husker valget mellom to resultater", () => {
    const storage = fakeStorage();
    expect(readDetailsOpen(storage)).toBe(false);
    writeDetailsOpen(storage, true);
    expect(readDetailsOpen(storage)).toBe(true);
    writeDetailsOpen(storage, false);
    expect(readDetailsOpen(storage)).toBe(false);
  });

  // ⚠️ En nettleser i privat modus kaster på SELVE oppslaget. En resultatskjerm skal ikke bli blank
  // fordi vi ikke fikk huske en utfelling.
  it("en nettleser som nekter å lagre gir lukkede detaljer, ikke et krasj", () => {
    const throwing = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
    };

    expect(readDetailsOpen(throwing)).toBe(false);
    expect(() => writeDetailsOpen(throwing, true)).not.toThrow();
    expect(readDetailsOpen(undefined)).toBe(false);
  });
});

// ── Vakten mot at en overskrift når produksjon uten oversettelse ────────────────────────────────
//
// ⚠️ `t()` gir NØKKELEN tilbake når den mangler, og «result.headline.passedPercent» på skjermen ser
// ut som en feilmelding for deltakeren. Nøyaktig den feilen rammet inspeksjonsskriptet to ganger i
// denne saken — begge gangene fordi ingenting krevde at nøkkelen fantes.
//
// #950 fikk en slik vakt for begrunnelsene. Overskriftene hadde ingen.
describe("#940 — hver overskrift finnes på alle tre språk", () => {
  const LOCALES = ["en-GB", "nb", "nn"];

  // Alle kombinasjonene `buildHeadline` kan svare med. Utvides den, hører den nye hjemme her.
  const CASES = [
    ["passed", { isMcqOnly: true, scoreComponents: { mcqPercentScore: 100 }, requirement: { mcqMinPercent: 80 } }],
    ["passed", { isMcqOnly: true, scoreComponents: { mcqPercentScore: 100 }, requirement: {} }],
    ["failed", { isMcqOnly: true, scoreComponents: { mcqPercentScore: 60 }, requirement: { mcqMinPercent: 80 } }],
    ["passed", { scoreComponents: { totalScore: 76, mcqScaledScore: 28, practicalScaledScore: 48 }, requirement: { totalMin: 70 } }],
    ["passed", { scoreComponents: { totalScore: 76, mcqScaledScore: 28, practicalScaledScore: 48 }, requirement: {} }],
    ["failed", { scoreComponents: { totalScore: 40 }, requirement: { totalMin: 70 } }],
    ["failed", { scoreComponents: { totalScore: 40 }, requirement: {} }],
    ["passed", { scoreComponents: {}, requirement: {} }],
    ["failed", { scoreComponents: {}, requirement: {} }],
    ["review", {}],
    ["pending", {}],
    ["unknown", {}],
  ];

  it("ingen overskrift eller underlinje mangler i noen språkfil", () => {
    const missing = [];
    for (const [outcome, data] of CASES) {
      const h = buildHeadline(outcome, data);
      for (const key of [h.key, h.subKey].filter(Boolean)) {
        for (const locale of LOCALES) {
          if (!translations[locale][key]) missing.push(`${locale}: ${key} (${outcome})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  // ⚠️ Blokkeringens makker. Uten denne ville testen over vært grønn for en `buildHeadline` som
  // sluttet å returnere nøkler i det hele tatt.
  it("de tolv tilfellene gir minst åtte FORSKJELLIGE overskrifter", () => {
    const keys = new Set(CASES.map(([outcome, data]) => buildHeadline(outcome, data).key));
    expect(keys.size).toBeGreaterThanOrEqual(8);
  });

  it("plassholderne i hver overskrift fylles av parametrene den selv sender", () => {
    const leftovers = [];
    for (const [outcome, data] of CASES) {
      const h = buildHeadline(outcome, data);
      for (const [key, params] of [[h.key, h.params], [h.subKey, h.subParams]]) {
        if (!key) continue;
        for (const locale of LOCALES) {
          let text = translations[locale][key];
          for (const [name, value] of Object.entries(params ?? {})) {
            text = text.split(`{${name}}`).join(String(value));
          }
          if (/\{\w+\}/.test(text)) leftovers.push(`${locale}: ${key} → ${text}`);
        }
      }
    }
    expect(leftovers).toEqual([]);
  });
});
