import { describe, expect, it } from "vitest";
import { renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";

// #1079: innholdsblokker i seksjonstekst. Produkteier laget samme kurs fra en presentasjon i to
// produkter; kortene og «Husk»-stripene forsvant i begge, fordi plattformen ikke hadde noe å legge
// dem i. Fire blokker ble besluttet 2026-10-05 (uthevet boks, prompt-boks, kort, ikon), og
// prøvesiden godkjent samme kveld.
//
// Blokkene er vanlig markdown som tegnes annerledes — ikke et eget format. Disse testene holder
// tre ting: at hver form kjennes igjen, at det som IKKE er en blokk står som før, og at plattformens
// rensing fortsatt gjelder for alt som står inni en blokk.

const F = "```";
const html = (markdown: string, locale = "nb") => renderSectionMarkdown(markdown, locale);

describe("uthevet boks — et sitat som åpner med fet merkelapp (#1079)", () => {
  it("får klassen og merkelappen sin, og teksten står som skrevet", () => {
    const ut = html("> **Husk:** Du står ansvarlig.\n> KI lager bare utkastet.");
    expect(ut).toContain('<blockquote class="content-callout">');
    expect(ut).toContain('<strong class="content-callout-label">Husk:</strong> Du står ansvarlig.');
    expect(ut).toContain("KI lager bare utkastet.");
  });

  it.each(["Viktig:", "Viktig!", "NB:", "NB", "Advarsel:", "Important:", "Warning"])("merkelappen «%s» gir varselfarge", (merke) => {
    expect(html(`> **${merke}** Ikke del passord.`)).toContain('<blockquote class="content-callout content-callout--warning">');
  });

  it.each(["Husk:", "Tips:", "Gode vaner:", "Best praksis:", "Viktigst av alt:"])("merkelappen «%s» gir den nøytrale boksen", (merke) => {
    const ut = html(`> **${merke}** Tekst.`);
    expect(ut).toContain('<blockquote class="content-callout">');
    expect(ut).not.toContain("content-callout--warning");
  });

  it("en stripe med flere punkter er én boks med lista inni", () => {
    const ut = html("> **Gode vaner:**\n> - Lagre kildene\n> - Start ny samtale");
    expect(ut.match(/content-callout"/g)).toHaveLength(1);
    expect(ut).toMatch(/<blockquote class="content-callout">[\s\S]*<ul>[\s\S]*<li>Lagre kildene<\/li>[\s\S]*<\/ul>\s*<\/blockquote>/);
  });

  it.each<[string, string]>([
    ["et vanlig sitat", "> Et vanlig sitat."],
    ["fet skrift midt i første setning", "> Dette er **viktig** å vite."],
    ["fet skrift først i andre avsnitt", "> Først vanlig.\n>\n> **Husk:** senere."],
    ["en liste først", "> - **Husk:** punkt"],
  ])("%s er ikke en uthevet boks", (_navn, markdown) => {
    const ut = html(markdown);
    expect(ut).toContain("<blockquote>");
    expect(ut).not.toContain("content-callout");
  });

  // QA-porten (2.84.0): rendereren tegnet sitatet og svarte så «ikke mitt», og marked tegnet det en
  // gang til — for hvert nivå i et nøstet sitat. 22 nivåer tok sekunder; 30 ville tatt minutter.
  it("et dypt nøstet sitat tegnes én gang per nivå, ikke dobbelt", () => {
    const dypt = `${">".repeat(26)} innerst`;
    const start = performance.now();
    const ut = html(dypt);
    expect(performance.now() - start).toBeLessThan(500);
    expect(ut.match(/<blockquote>/g)).toHaveLength(26);
    expect(ut).toContain("innerst");
  });

  it("bare den første fete teksten er merkelappen", () => {
    const ut = html("> **Husk:** bruk **alltid** kildene.");
    expect(ut.match(/content-callout-label/g)).toHaveLength(1);
    expect(ut).toContain("<strong>alltid</strong>");
  });
});

describe("prompt-boks — en kodeblokk merket «prompt» (#1079)", () => {
  const prompt = `${F}prompt\nDu skal skrive <et> referat & mer.\n\n  [lim inn notatene]\n${F}`;

  it("teksten står ordrett, med linjeskift og innrykk, og tegn som < og & er ufarlige", () => {
    const ut = html(prompt);
    expect(ut).toContain('<pre class="content-prompt-text">Du skal skrive &lt;et&gt; referat &amp; mer.\n\n  [lim inn notatene]</pre>');
    expect(ut).toContain('<div class="content-prompt">');
  });

  it.each<[string, string, string]>([
    ["nb", "Kopier", "Kopiert"],
    ["nn", "Kopier", "Kopiert"],
    ["en-GB", "Copy", "Copied"],
  ])("knappen står på leserens språk (%s)", (språk, kopier, kopiert) => {
    const ut = html(prompt, språk);
    expect(ut).toMatch(/<button [^>]*class="content-prompt-copy"[^>]*>/);
    expect(ut).toMatch(/<button [^>]*type="button"[^>]*>/);
    expect(ut).toContain(`data-copied-label="${kopiert}">${kopier}</button>`);
  });

  it("uten oppgitt språk, eller med et ukjent, står knappen på bokmål", () => {
    expect(renderSectionMarkdown(prompt)).toContain(">Kopier</button>");
    expect(renderSectionMarkdown(prompt, "constructor")).toContain(">Kopier</button>");
  });

  it("«Prompt», « prompt » og «PROMPT» er samme merke; en annen kodeblokk står som før", () => {
    for (const merke of ["Prompt", "PROMPT", " prompt "]) expect(html(`${F}${merke}\ntekst\n${F}`), merke).toContain("content-prompt-text");
    const kode = html(`${F}js\nconst a = 1;\n${F}`);
    expect(kode).toContain('<pre><code class="language-js">const a = 1;');
    expect(kode).not.toContain("content-prompt");
    expect(html(`${F}\nuten merke\n${F}`)).not.toContain("content-prompt");
  });

  it("en prompt kan ikke bryte seg ut av boksen", () => {
    const ut = html(`${F}prompt\n</pre></div><script>alert(1)</script><img src=x onerror=alert(2)>\n${F}`);
    expect(ut).not.toContain("<script");
    expect(ut).not.toMatch(/<img/);
    expect(ut).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("tabell — hver celle bærer navnet på kolonnen sin (#1079)", () => {
  const tabell = "| Del | Hva **KI** gjør |\n|---|:--:|\n| Vedtak | Skriver *utkast* |\n| Til stede | Lister opp |";

  it("cellene har kolonnenavnet som ren tekst, og innholdet beholder formateringen", () => {
    const ut = html(tabell);
    expect(ut).toContain('<table class="content-table">');
    expect(ut).toContain("<th>Del</th>");
    expect(ut).toContain("<strong>KI</strong> gjør</th>");
    expect(ut).toContain('<td data-label="Del"><span>Vedtak</span></td>');
    expect(ut).toMatch(/<td[^>]* data-label="Hva KI gjør"[^>]*><span>Skriver <em>utkast<\/em><\/span><\/td>/);
    expect(ut.match(/<tr>/g)).toHaveLength(3);
  });

  it("justeringen forfatteren har satt, er med", () => {
    expect(html(tabell)).toMatch(/<th align="center">Hva/);
    expect(html(tabell)).toMatch(/<td align="center" data-label="Hva KI gjør"><span>Lister opp<\/span><\/td>/);
  });

  it("et kolonnenavn med anførselstegn eller tegn som < kan ikke bryte seg ut av attributtet", () => {
    const ut = html('| A "x" <b>y</b> & z | B |\n|---|---|\n| 1 | 2 |');
    expect(ut).toContain('data-label="A &quot;x&quot; y &amp; z"');
    expect(ut).not.toContain('data-label="A "x"');
  });

  // QA-porten (2.84.0): cellen er flex på telefon, så hvert ord og hver fete bit i cellen ble sitt eget
  // element — «ut k a st». Innholdet står derfor samlet i én span.
  it("innholdet i hver celle står samlet i ett element", () => {
    const ut = html(["| A |", "|---|", "| Skriv **et** godt *utkast* med [lenke](https://a.no) |"].join("\n"));
    expect(ut).toMatch(/<td data-label="A"><span>Skriv <strong>et<\/strong> godt <em>utkast<\/em> med <a [^>]*>lenke<\/a><\/span><\/td>/);
  });

  // Produkteier på stage (2.85.0): med smal spalte ble ikonene i en stegtabell så små at de ikke vistes.
  // Et bilde først i cellen er et ikon og får klassen kortene bruker; shared.css gir den fast størrelse.
  it("et bilde først i en celle er et ikon", () => {
    const ut = html("| | Steg |\n|---|---|\n| ![](asset:ikon-x) | **Forstå** |");
    expect(ut).toMatch(/<td data-label=""><span><img class="content-icon" [^>]*ikon-x/);
    expect(ut).toContain('<td data-label="Steg"><span><strong>Forstå</strong></span></td>');
  });

  // QA-porten: et skjermbilde på 480 × 270 i en navngitt kolonne ble 24 × 24. Bare kolonner uten navn gir ikon.
  it("et bilde først i en celle i en navngitt kolonne er et bilde, ikke et ikon", () => {
    const ut = html("| Verktøy | Slik ser det ut |\n|---|---|\n| Lerret | ![](asset:bilde) |");
    expect(ut).toMatch(/<td data-label="Slik ser det ut"><span><img src="[^"]*bilde/);
    expect(ut).not.toContain("content-icon");
  });

  // QA-porten (runde 2): en tabell der ingen kolonne har navn, er den vanlige måten å sette bilder ved
  // siden av hverandre på — ikke en stegtabell. Bildene forblir bilder.
  it("en tabell uten noen navngitt kolonne gjør ikke bildene til ikoner", () => {
    const ut = html("| | |\n|---|---|\n| ![](asset:a) | ![](asset:b) |");
    expect(ut).toContain('<td data-label=""><span><img src=');
    expect(ut).not.toContain("content-icon");
  });

  it("et bilde inne i teksten i en celle er et bilde, ikke et ikon", () => {
    const ut = html("| A |\n|---|\n| Se ![](asset:b) her |");
    expect(ut).toContain("<span>Se <img ");
    expect(ut).not.toContain("content-icon");
  });

  it("en tabell uten rader er fortsatt en tabell", () => {
    const ut = html("| A | B |\n|---|---|");
    expect(ut).toContain('<table class="content-table"><thead><tr><th>A</th><th>B</th></tr></thead></table>');
  });
});

describe("kort — en ramme rundt underoverskrifter (#1079)", () => {
  const kort = [
    "Tre kilder er vanlige.",
    "",
    ":::kort",
    "### ![](asset:ikon-sak) Sakliste",
    "",
    "**Bruk når** møtet fulgte en plan.",
    "",
    "- Gir rekkefølgen",
    "",
    "### Egne notater",
    "",
    "> **Husk:** rydd først.",
    "",
    ":::",
    "",
    "Etter kortene.",
  ].join("\n");

  it("hver underoverskrift blir et kort med tittel og innhold", () => {
    const ut = html(kort);
    expect(ut.match(/<section class="content-card">/g)).toHaveLength(2);
    expect(ut).toMatch(/<div class="content-cards"><section class="content-card"><h3 class="content-card-title">/);
    expect(ut).toContain('Sakliste</h3><div class="content-card-body"><p><strong>Bruk når</strong> møtet fulgte en plan.</p>');
    expect(ut).toContain('<h3 class="content-card-title">Egne notater</h3>');
    expect(ut).not.toContain(":::");
  });

  it("teksten før og etter ramma står utenfor kortene", () => {
    const ut = html(kort);
    expect(ut.indexOf("<p>Tre kilder er vanlige.</p>")).toBeLessThan(ut.indexOf("content-cards"));
    expect(ut.indexOf("<p>Etter kortene.</p>")).toBeGreaterThan(ut.lastIndexOf("</section>"));
  });

  it("et bilde først i kortoverskriften er ikonet; et bilde ellers er et vanlig bilde", () => {
    const ut = html(kort);
    expect(ut).toContain('<img class="content-icon" src="/api/content-assets/ikon-sak?locale=nb" alt=""> Sakliste');
    const iTeksten = html(":::kort\n### Tittel ![](asset:b)\n\n![figur](asset:c)\n:::");
    expect(iTeksten).not.toContain("content-icon");
    expect(iTeksten.match(/<img /g)).toHaveLength(2);
  });

  it("en uthevet boks og en prompt-boks kan stå inni et kort", () => {
    const ut = html(`:::kort\n### A\n\n> **Tips:** ett.\n\n### B\n\n${F}prompt\nSkriv.\n${F}\n:::`);
    expect(ut).toMatch(/<div class="content-card-body"><blockquote class="content-callout">/);
    expect(ut).toMatch(/<div class="content-card-body"><div class="content-prompt">/);
  });

  it.each([":::cards", ":::Kort", "::: kort", ":::KORT  "])("«%s» åpner også en ramme", (åpning) => {
    expect(html(`${åpning}\n### A\n- en\n### B\n- to\n:::`).match(/content-card"/g)).toHaveLength(2);
  });

  it("ramma kan stå tett inntil teksten rundt, uten blanke linjer", () => {
    const ut = html("Tre kilder:\n:::kort\n### A\n- en\n### B\n- to\n:::\nSlutt.");
    expect(ut).toContain("<p>Tre kilder:</p>");
    expect(ut.match(/content-card"/g)).toHaveLength(2);
    expect(ut).toContain("<p>Slutt.</p>");
    expect(ut).not.toContain(":::");
  });

  it("tekst mellom åpningen og første overskrift står foran kortene, ikke i et kort", () => {
    const ut = html(":::kort\nInnledning.\n\n### A\n- en\n:::");
    expect(ut).toMatch(/<p>Innledning\.<\/p>\s*<div class="content-cards">/);
  });

  it("en ramme som aldri lukkes, er ikke en ramme: teksten står som skrevet og ingenting forsvinner", () => {
    const ut = html(":::kort\n### A\n- en\n\nMer tekst.");
    expect(ut).not.toContain("content-cards");
    expect(ut).toContain("<h3>A</h3>");
    expect(ut).toContain("Mer tekst.");
  });

  it("en ramme uten en eneste overskrift har ingen kort", () => {
    const ut = html(":::kort\nBare tekst.\n:::");
    expect(ut).toContain("<p>Bare tekst.</p>");
    expect(ut).not.toContain("content-card");
  });

  it("underoverskrifter UTEN ramme er overskrifter som før", () => {
    const ut = html("### A\n- en\n### B\n- to");
    expect(ut).toContain("<h3>A</h3>");
    expect(ut).not.toContain("content-card");
  });

  it("overskriftsnivået følger teksten, men et kort er aldri en hovedoverskrift", () => {
    expect(html(":::kort\n#### A\n- en\n:::")).toContain('<h4 class="content-card-title">A</h4>');
    expect(html(":::kort\n# A\n- en\n:::")).toContain('<h3 class="content-card-title">A</h3>');
  });

  it("to rammer i samme seksjon gir to rekker med kort", () => {
    const ut = html(":::kort\n### A\n- en\n:::\n\nMellom.\n\n:::kort\n### B\n- to\n:::");
    expect(ut.match(/<div class="content-cards">/g)).toHaveLength(2);
    expect(ut).toContain("<p>Mellom.</p>");
  });
});

describe("rensingen gjelder også inni blokkene (#1079)", () => {
  it.each<[string, string]>([
    ["kortoverskrift", ":::kort\n### <img src=x onerror=alert(1)> T\n- en\n:::"],
    ["kortinnhold", ':::kort\n### T\n\n<script>alert(1)</script><a href="javascript:alert(2)">lenke</a>\n:::'],
    ["uthevet boks", '> **Husk:** <span onclick="alert(1)">klikk</span><script>alert(2)</script>'],
    ["tabellcelle", "| A |\n|---|\n| <img src=x onerror=alert(1)> |"],
  ])("skript og hendelser fjernes i %s", (_navn, markdown) => {
    const ut = html(markdown);
    expect(ut).not.toMatch(/<script|onerror|onclick|javascript:/i);
  });

  it("en merkelapp kan ikke smugle inn en klasse eller et attributt", () => {
    const ut = html('> **Husk" onmouseover="alert(1):** tekst');
    // Teksten kan gjerne inneholde ordene — de står som tekst i merkelappen, ikke som et attributt.
    expect(ut).not.toMatch(/<[^>]*onmouseover/);
    expect(ut).toContain("content-callout-label");
  });
});

describe("det som ikke er en blokk, står som før (#1079)", () => {
  it("avsnitt, lister, overskrifter og bilder tegnes uendret", () => {
    const ut = html("## Del\n\nEt avsnitt med **fet** tekst.\n\n1. en\n2. to\n\n![Figur](asset:fig-1)");
    expect(ut).toContain("<h2>Del</h2>");
    expect(ut).toContain("<p>Et avsnitt med <strong>fet</strong> tekst.</p>");
    expect(ut).toMatch(/<ol>\s*<li>en<\/li>\s*<li>to<\/li>\s*<\/ol>/);
    expect(ut).toContain('<img src="/api/content-assets/fig-1?locale=nb" alt="Figur">');
  });

  it("tre kolon i løpende tekst er bare tekst", () => {
    expect(html("Skriv ::: for å skille.")).toContain("<p>Skriv ::: for å skille.</p>");
    expect(html(":::\n\nIkke en ramme.")).toContain("Ikke en ramme.");
  });

  it("tom tekst gir tom streng", () => {
    expect(renderSectionMarkdown("", "nb")).toBe("");
  });
});
