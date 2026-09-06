import { describe, expect, it } from "vitest";
import { buildDriftDiffModalHtml } from "/static/criteria-editor.js";

// ─────────────────────────────────────────────────────────────────────────────
// Steg 2 i `doc/SHELL_EXTRACTION_PLAN.md`: driftsdiffen.
//
// Den bygger HTML og rører ingen tilstand, så den kan prøves i en DOM-test på sekunder i stedet
// for en e2e-test på minutter. Testen er skrevet FØR flyttingen (disiplinregel 4).
//
// ⚠️ Uttrekket krevde at `t` og `tf` sendes inn. Funksjonen leste dem fra modulen og var uren
// gjennom oversetterne, uten at renhetsskanneren så det — den leser bare funksjonens egen tekst.
// ─────────────────────────────────────────────────────────────────────────────

const t = (k) => k;
const tf = (k, p) => `${k}:${JSON.stringify(p)}`;
const tom = { added: [], removed: [], changed: [] };

/** Parser HTML-en, så påstandene handler om struktur og ikke om tegnrekkefølge. */
function parse(html) {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
}

describe("buildDriftDiffModalHtml", () => {
  it("sier fra når ingenting er endret", () => {
    const d = parse(buildDriftDiffModalHtml(tom, "nb", t, tf));
    expect(d.querySelector(".drift-diff-empty")).not.toBeNull();
    expect(d.querySelectorAll(".drift-diff-row")).toHaveLength(0);
  });

  it("gir én rad per endring, med avkrysning på hver", () => {
    const diff = {
      added: [{ id: "nytt", next: { label: { nb: "Nytt" } } }],
      removed: [{ id: "vekk", prev: { label: { nb: "Vekk" } } }],
      changed: [{ id: "endret", prev: { label: { nb: "Før" } }, next: { label: { nb: "Etter" } }, fields: { labelChanged: true } }],
    };
    const d = parse(buildDriftDiffModalHtml(diff, "nb", t, tf));
    expect(d.querySelectorAll(".drift-diff-row")).toHaveLength(3);
    expect(d.querySelectorAll("[data-diff-checkbox]")).toHaveLength(3);

    // ⚠️ Alle er avkrysset i utgangspunktet. «Godta valgte» virker på det som er huket av, så en
    // rad som kom uten kryss ville stille blitt utelatt fra det forfatteren tror hen godtar.
    for (const boks of d.querySelectorAll("[data-diff-checkbox]")) {
      expect(boks.hasAttribute("checked")).toBe(true);
    }
    expect([...d.querySelectorAll("[data-criterion-id]")].map((e) => e.dataset.criterionId).sort())
      .toEqual(["endret", "nytt", "vekk"]);
  });

  it("viser teksten i språket som sendes inn", () => {
    const diff = { ...tom, added: [{ id: "k", next: { label: { nb: "Klarhet", "en-GB": "Clarity" } } }] };
    expect(parse(buildDriftDiffModalHtml(diff, "nb", t, tf)).textContent).toContain("Klarhet");
    expect(parse(buildDriftDiffModalHtml(diff, "en-GB", t, tf)).textContent).toContain("Clarity");
  });

  it("faller tilbake på id-en når etiketten mangler", () => {
    const diff = { ...tom, added: [{ id: "uten_etikett", next: {} }] };
    expect(parse(buildDriftDiffModalHtml(diff, "nb", t, tf)).textContent).toContain("uten_etikett");
  });

  it("viser bare feltene som faktisk er endret", () => {
    const diff = {
      ...tom,
      changed: [{
        id: "k",
        prev: { label: { nb: "Før" }, maxScore: 3, candidateVisible: false },
        next: { label: { nb: "Etter" }, maxScore: 5, candidateVisible: true },
        fields: { labelChanged: true, descChanged: false, scoreChanged: true, visChanged: true },
      }],
    };
    const tekst = parse(buildDriftDiffModalHtml(diff, "nb", t, tf)).textContent ?? "";
    expect(tekst).toContain("shell.drift.diff.label");
    expect(tekst).toContain("shell.drift.diff.maxScore");
    expect(tekst).toContain("shell.drift.diff.candidateVisible");
    // Beskrivelsen er uendret, og skal ikke stå der som en tom rad.
    expect(tekst).not.toContain("shell.drift.diff.description");
  });

  it("teller endringene i sammendraget", () => {
    const diff = {
      added: [{ id: "a", next: {} }, { id: "b", next: {} }],
      removed: [{ id: "c", prev: {} }],
      changed: [],
    };
    const tekst = parse(buildDriftDiffModalHtml(diff, "nb", t, tf)).textContent ?? "";
    expect(tekst).toContain('"added":2');
    expect(tekst).toContain('"removed":1');
    expect(tekst).toContain('"changed":0');
  });

  it("⚠️ rømmer HTML i det forfatteren har skrevet", () => {
    // Kriterienavn er forfatterens tekst og havner rett i markup. Uten rømming er dette en
    // injeksjon i en modal som vises til den som forvalter innholdet.
    const diff = { ...tom, added: [{ id: "k", next: { label: { nb: "<img src=x onerror=alert(1)>" } } }] };
    const html = buildDriftDiffModalHtml(diff, "nb", t, tf);
    expect(html).not.toContain("<img src=x");
    expect(parse(html).querySelectorAll("img")).toHaveLength(0);
  });

  it("⚠️ rømmer også id-en, som havner i et dataattributt", () => {
    const diff = { ...tom, added: [{ id: '" onclick="alert(1)', next: { label: { nb: "X" } } }] };
    const d = parse(buildDriftDiffModalHtml(diff, "nb", t, tf));
    const boks = d.querySelector("[data-diff-checkbox]");
    expect(boks?.getAttribute("onclick")).toBeNull();
  });
});
