import { describe, expect, it } from "vitest";
import { buildPreviewHtml } from "../../public/static/admin-content-preview.js";

// #1124: «Forhåndsvisning» viser det deltakeren får — og deltakeren får nå kriteriene. Regelen er
// serverens (`isCandidateVisible` i participantCriteria.ts): et manglende `candidateVisible` er
// SYNLIG, bare et eksplisitt skjul (eller en skadet verdi) holder tilbake. Før denne saken sa
// forhåndsvisningen «skjult» om alle kriterier skillet skrev, fordi skillet aldri skriver flagget.
//
// #896 S1 står fast: fasiten (assessorExpectedContent) vises aldri i deltakervisningen.

const t = (k) => k;
const tf = (k) => k;

const CRITERIA = {
  utenFlagg: { label: "Uten flagg", description: "0 = a; 4 = b" },
  synlig: { label: "Synlig", description: "0 = a; 4 = b", candidateVisible: true },
  skjult: { label: "Skjult kriterium", description: "røper svaret", candidateVisible: false },
  skadet: { label: "Skadet flagg", candidateVisible: null },
  streng: "0–4: et kriterium som bare er en streng",
};

function labels(html) {
  const el = document.createElement("div");
  el.innerHTML = html;
  return [...el.querySelectorAll(".preview-criterion-title")].map((n) => n.textContent);
}

function render(audience) {
  return buildPreviewHtml(
    { title: "Modul", taskText: "Oppgave", assessorExpectedContent: "FASIT-1124", criteria: CRITERIA, audience },
    { locale: "nb", t, tf },
  );
}

describe("#1124 forhåndsvisningen følger deltakerens synlighetsregel", () => {
  it("deltakervisningen: manglende flagg og strenger vises; false og skadede verdier holdes tilbake", () => {
    const html = render("participant");
    expect(labels(html)).toEqual(["Uten flagg", "Synlig", "Streng"]);
    expect(html).not.toContain("røper svaret");
    expect(html).not.toContain("FASIT-1124");
  });

  it("forfattervisningen viser alt, og «synlig for kandidat» står også på kriteriet uten flagg", () => {
    const el = document.createElement("div");
    el.innerHTML = render("author");
    const marked = [...el.querySelectorAll(".preview-criterion")]
      .filter((li) => li.querySelector(".preview-criterion-visible"))
      .map((li) => li.querySelector(".preview-criterion-title").textContent);
    expect(marked).toEqual(["Uten flagg", "Synlig", "Streng"]);
    expect(el.innerHTML).toContain("FASIT-1124");
  });
});
