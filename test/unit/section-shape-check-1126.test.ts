import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CALLOUT_MAX, LIST_MAX_ITEMS, callouts, calloutsAllowed, checkFrameCount, isRevisionTitle, longLists, proseWordCount, selfDescription, summaryHeadings } from "../../skills/a2-authoring-api/scripts/section-shape-check.mjs";

// #1126: seksjoner som lærer bort, ikke kataloger. Målt på de 106 seksjonene i 15 kurs på stage før
// grensene ble satt: 16 seksjoner med «Formål» + «Nøkkelpoeng» + «Kort oppsummering», 44 med mer enn
// én boks, 17 lister på 9–13 punkter, 23 seksjoner som beskriver seg selv («Denne seksjonen viser …»).

describe("#1126 oppsummeringer", () => {
  it("de tre fra stage, på alle tre språk", () => {
    expect(summaryHeadings("## Formål\n\nA.\n\n## Nøkkelpoeng\n\n- B\n\n## Kort oppsummering\n\nC.")).toEqual(["Formål", "Nøkkelpoeng", "Kort oppsummering"]);
    expect(summaryHeadings("## Føremål\n\n## Samandrag\n\n## Hovudpoeng")).toEqual(["Føremål", "Samandrag", "Hovudpoeng"]);
    expect(summaryHeadings("## Purpose\n\n## Key points\n\n## Brief summary\n\n## The key points from this section")).toEqual(["Purpose", "Key points", "Brief summary", "The key points from this section"]);
  });

  it("hele overskriften, uten ikon, nummer, fet skrift og kolon", () => {
    expect(summaryHeadings("### ![](icon:list-collapse) **Det viktigste fra denne seksjonen:**\n\n## 8. Oppsummering")).toEqual(["Det viktigste fra denne seksjonen", "Oppsummering"]);
  });

  it("en overskrift som bare begynner med ordet er et emne, ikke en oppsummering", () => {
    expect(summaryHeadings("## Formål og målgruppe\n\n## Sammendrag og utforsking av et dokument\n\n## 8. Oppsummering: hva tilsynet ser etter\n\n## Purpose and audience")).toEqual([]);
  });

  it("ikke i kode, og ikke en linje som bare ser ut som en overskrift", () => {
    expect(summaryHeadings("```markdown\n## Formål\n## Oppsummering\n```\n\nFormål\n\n#Oppsummering")).toEqual([]);
  });
});

describe("#1126 bokser", () => {
  it("én boks per sitat som åpner med fet skrift — et sitat over flere linjer er én", () => {
    expect(callouts("> **Husk:** A.\n> Mer.\n\n> **Tips**: B.\n\n> **Hva må vi fullføre?**")).toEqual(["Husk", "Tips", "Hva må vi fullføre?"]);
    // Slik på stage: fire fete linjer i ett sitat er én boks.
    expect(callouts("> **Behov:** A.\n> **Leveranse:** B.\n> **Effekt:** C.\n> **Nytte:** D.")).toEqual(["Behov"]);
  });

  it("et sitat uten fet etikett, eller i kode, er ingen boks", () => {
    expect(callouts("> Et vanlig sitat.\n\n```\n> **Husk:** i kode\n```")).toEqual([]);
  });

  it("utkastet rett over en «finn feilene» er øvelsen — også med blanke linjer imellom; et sitat med tekst før rammen er en boks", () => {
    expect(callouts("> **Utkast fra KI:**\n> - Feil frist.\n\n:::skriv Finn feilene i utkastet.\nSvar.\n:::")).toEqual([]);
    expect(callouts("> **Draft:**\n> - x\n\n\n:::write Find the errors.\nAnswer.\n:::")).toEqual([]);
    expect(callouts("> **Husk:** A.\n\nTekst.\n\n:::skriv Skriv et vedtak.\nSvar.\n:::")).toEqual(["Husk"]);
  });

  it("den daterte boksen for produktdetaljer er sin egen slags, på alle tre språk — men ikke «Gjelder» alene", () => {
    expect(callouts("> **Gjelder per oktober 2026:** Pris.\n\n> **Gjeld no:** Pris.\n\n> **Gjelder nå (oktober 2026):** x\n\n> **Current as of October 2026:** Price.\n\n> **As of October 2026:** x")).toEqual([]);
    expect(callouts("> **Gjelder alle:** x\n\n> **Asof:** y\n\n> **Gjelder nåtid:** z")).toEqual(["Gjelder alle", "Asof", "Gjelder nåtid"]);
  });

  it("grensen er én", () => {
    expect(CALLOUT_MAX).toBe(1);
  });

  // Produkteier 2026-10-26: grensen følger lengden — én per 400 ord, aldri under én.
  it("én boks per 400 ord: én i en kort seksjon, to fra 800 ord, tre fra 1200", () => {
    expect(calloutsAllowed(150)).toBe(1);
    expect(calloutsAllowed(799)).toBe(1);
    expect(calloutsAllowed(800)).toBe(2);
    expect(calloutsAllowed(1340)).toBe(3);
  });

  it("ordene telles i teksten, ikke i kode", () => {
    expect(proseWordCount("En to tre.\n\n```\nfire fem seks sju\n```\n\nåtte")).toBe(4);
  });
});

describe("#1127 repetisjonskurs", () => {
  it.each([
    ["Repetisjon kurs 1 – Møtearbeid", true],
    ["Grunnleggende generativ KI: Repetisjon Modul 2 – Tilbudsarbeid", true],
    ["Repetisjonskurs i referat", true],
    ["Revision: meeting minutes", true],
    ["Møtearbeid med KI", false],
    ["Konkurranserepetisjon", false],
  ])("«%s» → %s", (title, expected) => {
    expect(isRevisionTitle(title)).toBe(expected);
  });

  it("et språkkart: ett språk med «Repetisjon» er nok", () => {
    expect(isRevisionTitle({ nb: "Repetisjon: referat", "en-GB": "Minutes, again" })).toBe(true);
    expect(isRevisionTitle(null)).toBe(false);
  });

  it("«sjekk deg selv» telles, også på engelsk, men ikke i kode", () => {
    expect(checkFrameCount(":::sjekk A?\n- [x] a\n:::\n\n:::check B?\n- [x] b\n:::\n\n```\n:::sjekk C?\n```")).toBe(2);
  });
});

describe("#1126 lange lister", () => {
  const liste = (n: number, merke = "-") => Array.from({ length: n }, (_, i) => `${merke === "1." ? `${i + 1}.` : merke} punkt ${i + 1}`).join("\n");

  it("ni punkter er en lang liste; åtte er ikke", () => {
    expect(LIST_MAX_ITEMS).toBe(8);
    expect(longLists(liste(9))).toEqual([{ items: 9, first: "punkt 1" }]);
    expect(longLists(liste(8))).toEqual([]);
  });

  it("nummerert og punktliste med * og + telles likt", () => {
    expect(longLists(liste(10, "1."))).toEqual([{ items: 10, first: "punkt 1" }]);
    expect(longLists(liste(9, "*"))).toHaveLength(1);
    expect(longLists(liste(9, "+"))).toHaveLength(1);
  });

  it("et avsnitt, eller et skifte fra nummer til punkt, avslutter lista", () => {
    expect(longLists(`${liste(5)}\n\nTekst.\n\n${liste(5)}`)).toEqual([]);
    expect(longLists(`${liste(5, "1.")}\n${liste(5)}`)).toEqual([]);
  });

  it("blanke linjer og innrykk under et punkt holder lista sammen", () => {
    expect(longLists(Array.from({ length: 9 }, (_, i) => `- punkt ${i + 1}\n  forklaring`).join("\n\n"))).toEqual([{ items: 9, first: "punkt 1" }]);
  });

  it("ikke i en ramme (par, alternativer) og ikke i kode", () => {
    const par = Array.from({ length: 9 }, (_, i) => `- B${i} = F${i}`).join("\n");
    expect(longLists(`:::par Koble\n${par}\n:::\n\n\`\`\`\n${liste(12)}\n\`\`\``)).toEqual([]);
    // Etter rammen telles det igjen.
    expect(longLists(`:::par Koble\n${par}\n:::\n\n${liste(9)}`)).toHaveLength(1);
  });
});

// Før/etter-eksempelet i skillet er det kontrollene måler: «før» har alt de finner, «etter» ingenting.
describe("#1126 før/etter-eksempelet i section-content.md", () => {
  const ref = readFileSync("skills/a2-authoring-api/references/section-content.md", "utf8").replaceAll("\r\n", "\n");
  const blokk = (merke: string) => new RegExp(`\\*\\*${merke}\\*\\*[\\s\\S]*?\`\`\`markdown\\n([\\s\\S]*?)\\n\`\`\`\\n`).exec(ref)![1]!;

  it("«før»: tre oppsummeringer, tre bokser og en seksjon som beskriver seg selv", () => {
    const før = blokk("Before");
    expect(summaryHeadings(før)).toEqual(["Formål", "Nøkkelpoeng", "Kort oppsummering"]);
    expect(callouts(før)).toEqual(["Hovedpoenget", "Husk", "Tips"]);
    expect(selfDescription(før)).toMatch(/^Denne seksjonen viser hvordan Copilot/);
  });

  it("«etter»: ingen funn — den daterte boksen teller ikke", () => {
    const etter = blokk("After");
    expect(etter).toContain("Gjelder per");
    expect(summaryHeadings(etter)).toEqual([]);
    expect(callouts(etter)).toEqual(["Viktig"]);
    expect(longLists(etter)).toEqual([]);
    expect(selfDescription(etter)).toBeNull();
  });
});

describe("#1126 seksjonen som beskriver seg selv", () => {
  it.each([
    ["Denne seksjonen viser hvordan Git gir prosjektet en historikk.", "Denne seksjonen viser hvordan Git gir prosjektet en historikk"],
    ["Denne seksjonen går gjennom hva standarden krever.", "Denne seksjonen går gjennom hva standarden krever"],
    ["Denne seksjonen svarer på spørsmål som ofte kommer opp.", "Denne seksjonen svarer på spørsmål som ofte kommer opp"],
    ["Denne seksjonen konsentrerer seg om de fire første leddene.", "Denne seksjonen konsentrerer seg om de fire første leddene"],
    ["Denne seksjonen forklarar korleis ein agent hentar kunnskap.", "Denne seksjonen forklarar korleis ein agent hentar kunnskap"],
    ["Denne seksjonen samanliknar LLM-agentar med deterministiske.", "Denne seksjonen samanliknar LLM-agentar med deterministiske"],
    ["This section covers the model and the process.", "This section covers the model and the process"],
    ["This section explains why code execution matters.", "This section explains why code execution matters"],
  ])("«%s»", (tekst, ventet) => {
    expect(selfDescription(`Tekst før.\n\n${tekst}\n\nMer.`)).toBe(ventet);
  });

  it("der seksjonen ikke er den som snakker, eller ordet bare begynner likt, er det ikke funn", () => {
    expect(selfDescription("I denne seksjonen ser du tre kilder. Etter denne seksjonen skal du kunne velge. Tallene i denne seksjonen er hentet fra rapporten.")).toBeNull();
    expect(selfDescription("Denne seksjonen viserbok er et påfunn. This section showsomething.")).toBeNull();
    expect(selfDescription("```\nDenne seksjonen viser alt.\n```")).toBeNull();
  });
});
