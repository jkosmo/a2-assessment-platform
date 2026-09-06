import { describe, expect, it } from "vitest";
import {
  buildCriteriaEditorHtml,
  buildEditorStateFromCriteriaRecord,
  captureLatestCriteriaState,
  computeCriteriaDiff,
  driftText,
  humaniseCriterionId,
} from "/static/criteria-editor.js";

// ─────────────────────────────────────────────────────────────────────────────
// Steg 1 i `doc/SHELL_EXTRACTION_PLAN.md`: kriterieredigereren ut av
// `admin-content-shell.js` (7 873 linjer).
//
// ⚠️ TESTEN ER SKREVET FØR KODEN BLE FLYTTET, etter disiplinregel 4 i planen: «Ellers er uttrekket
// bare en flytting.» Denne logikken har aldri hatt en enhetstest — den har bare vært nådd gjennom
// e2e, der en feil i diffen ser ut som en feil i lagringen.
//
// ⚠️ Og uttrekket var ikke mulig før `driftText` sluttet å lese `contentLocale` fra modulen. Den
// gjorde `computeCriteriaDiff` uren gjennom et mellomledd, uten at renhetsskanneren så det.
// ─────────────────────────────────────────────────────────────────────────────

const t = (k) => k;
const tf = (k, p) => `${k}:${JSON.stringify(p)}`;

describe("driftText — språket kommer inn, ikke fra modulen", () => {
  it("gir tom streng for null og tar strenger som de er", () => {
    expect(driftText(null, "nb")).toBe("");
    expect(driftText(undefined, "nb")).toBe("");
    expect(driftText("rå tekst", "nb")).toBe("rå tekst");
  });

  it("velger språket som sendes inn", () => {
    const verdi = { nb: "Klarhet", "en-GB": "Clarity" };
    expect(driftText(verdi, "nb")).toBe("Klarhet");
    expect(driftText(verdi, "en-GB")).toBe("Clarity");
  });
});

describe("computeCriteriaDiff", () => {
  const a = { klarhet: { label: { nb: "Klarhet" }, description: { nb: "A" }, maxScore: 4, candidateVisible: true } };

  it("ser lagt til, fjernet og uendret", () => {
    const d = computeCriteriaDiff(a, { ...a, nytt: { label: { nb: "Nytt" } } }, "nb");
    expect(d.added.map((x) => x.id)).toEqual(["nytt"]);
    expect(d.unchanged.map((x) => x.id)).toEqual(["klarhet"]);
    expect(computeCriteriaDiff(a, {}, "nb").removed.map((x) => x.id)).toEqual(["klarhet"]);
  });

  it("⚠️ sammenligner teksten PÅ SKJERMEN, ikke objektet", () => {
    // QA-runde 5 i #896: forslagene er språkobjekter, og String({...}) er «[object Object]» for
    // dem alle. To ulike forslag ble derfor like, og en ren tekstendring ble ført som uendret —
    // som «godta valgte» så hoppet over. Denne påstanden er den feilen, som test.
    const endret = { klarhet: { ...a.klarhet, label: { nb: "Tydelighet" } } };
    const d = computeCriteriaDiff(a, endret, "nb");
    expect(d.changed.map((x) => x.id)).toEqual(["klarhet"]);
    expect(d.changed[0].fields.labelChanged).toBe(true);
    expect(d.unchanged).toEqual([]);
  });

  it("⚠️ ser bare endringen i språket som vises", () => {
    // Endres bare den engelske teksten mens vi ser på bokmål, er det ingen endring PÅ SKJERMEN.
    // Det er en bevisst konsekvens av å sammenligne det brukeren ser, og verdt å låse.
    const bare_en = { klarhet: { ...a.klarhet, label: { nb: "Klarhet", "en-GB": "Clearness" } } };
    expect(computeCriteriaDiff(a, bare_en, "nb").unchanged.map((x) => x.id)).toEqual(["klarhet"]);
    expect(computeCriteriaDiff(a, bare_en, "en-GB").changed.map((x) => x.id)).toEqual(["klarhet"]);
  });

  it("ser endret poeng og synlighet hver for seg", () => {
    const poeng = computeCriteriaDiff(a, { klarhet: { ...a.klarhet, maxScore: 5 } }, "nb");
    expect(poeng.changed[0].fields).toMatchObject({ scoreChanged: true, labelChanged: false });
    const syn = computeCriteriaDiff(a, { klarhet: { ...a.klarhet, candidateVisible: false } }, "nb");
    expect(syn.changed[0].fields).toMatchObject({ visChanged: true, scoreChanged: false });
  });
});

describe("buildEditorStateFromCriteriaRecord", () => {
  it("gir tom liste for tomt eller ugyldig", () => {
    expect(buildEditorStateFromCriteriaRecord(null, "nb")).toEqual([]);
    expect(buildEditorStateFromCriteriaRecord("noe", "nb")).toEqual([]);
  });

  it("⚠️ bærer HELE den lagrede verdien, ikke bare språket som redigeres", () => {
    // #902: redigereren viser ETT språk, men verdien kan holde tre. Uten `storedLabel` ville
    // lagringen skrevet tilbake en bar streng og slettet de to språkene som aldri ble vist.
    const [rad] = buildEditorStateFromCriteriaRecord(
      { klarhet: { label: { nb: "Klarhet", "en-GB": "Clarity" }, description: { nb: "Om språk" }, maxScore: 4 } },
      "nb",
    );
    expect(rad.label).toBe("Klarhet");
    expect(rad.storedLabel).toEqual({ nb: "Klarhet", "en-GB": "Clarity" });
    expect(rad.locale).toBe("nb");
  });

  it("utleder poeng fra vekt for gamle kriterier uten maxScore", () => {
    const [rad] = buildEditorStateFromCriteriaRecord({ k: { weight: 0.7 } }, "nb");
    expect(rad.maxScore).toBe(7);
  });

  it("faller tilbake på et lesbart navn når etiketten mangler", () => {
    const [rad] = buildEditorStateFromCriteriaRecord({ quality_and_depth: {} }, "nb");
    expect(rad.label).toBe("Quality And Depth");
  });

  it("holder poengene innenfor 1–10", () => {
    expect(buildEditorStateFromCriteriaRecord({ k: { maxScore: 99 } }, "nb")[0].maxScore).toBe(10);
    expect(buildEditorStateFromCriteriaRecord({ k: { maxScore: -5 } }, "nb")[0].maxScore).toBe(5);
  });
});

describe("captureLatestCriteriaState — leser DOM-en den får inn", () => {
  const lagKort = (label, desc, vekt, synlig) => {
    const d = document.createElement("div");
    d.className = "vk-card";
    const l = document.createElement("input");
    l.className = "vk-label";
    l.value = label;
    const b = document.createElement("textarea");
    b.className = "vk-description";
    b.value = desc;
    const v = document.createElement("input");
    v.className = "vk-weight";
    v.value = vekt;
    const s = document.createElement("input");
    s.type = "checkbox";
    s.className = "vk-visible";
    s.checked = synlig;
    d.append(l, b, v, s);
    return d;
  };

  it("leser verdiene fra kortene", () => {
    const c = document.createElement("div");
    c.append(lagKort("Klarhet", "Om språk", "4", true));
    const [rad] = captureLatestCriteriaState(c, [{ id: "klarhet" }]);
    expect(rad).toMatchObject({
      id: "klarhet",
      label: "Klarhet",
      description: "Om språk",
      maxScore: 4,
      candidateVisible: true,
    });
  });

  it("⚠️ tar med de lagrede språkene fra reservetilstanden", () => {
    // #902 igjen, den andre halvparten: DOM-en holder ett språk. Bygges raden fra kortene alene,
    // forsvinner de to andre på vei til lagringen — som er nøyaktig slik bar-streng-skrivingen
    // overlevde den første fiksen.
    const c = document.createElement("div");
    c.append(lagKort("Klarhet", "", "4", false));
    const lagret = [{ id: "k", storedLabel: { nb: "Klarhet", nn: "Klårleik" }, storedDescription: null, locale: "nb" }];
    const [rad] = captureLatestCriteriaState(c, lagret);
    expect(rad.storedLabel).toEqual({ nb: "Klarhet", nn: "Klårleik" });
    expect(rad.locale).toBe("nb");
  });

  it("gir reservetilstanden tilbake når beholderen mangler, og tom liste når den er tom", () => {
    expect(captureLatestCriteriaState(null, [{ id: "a" }])).toEqual([{ id: "a" }]);
    expect(captureLatestCriteriaState(document.createElement("div"), [{ id: "a" }])).toEqual([]);
  });
});

describe("buildCriteriaEditorHtml", () => {
  it("bygger ett kort per kriterium og bruker oversetterne den får", () => {
    const html = buildCriteriaEditorHtml(
      [{ id: "k", label: "Klarhet", description: "Om språk", maxScore: 4, candidateVisible: true }],
      t,
      tf,
    );
    expect(html).toContain("vk-card");
    expect(html).toContain("shell.criteria.labelLabel");
    expect(html).toContain("Klarhet");
  });

  it("⚠️ rømmer HTML i det forfatteren har skrevet", () => {
    const ondsinnet = [{ id: "k", label: "<img src=x onerror=alert(1)>", description: "", maxScore: 1 }];
    const html = buildCriteriaEditorHtml(ondsinnet, t, tf);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("humaniseCriterionId", () => {
  it("gjør id-er om til lesbare navn", () => {
    expect(humaniseCriterionId("quality_and_depth")).toBe("Quality And Depth");
    expect(humaniseCriterionId("task-comprehension")).toBe("Task Comprehension");
  });
});
