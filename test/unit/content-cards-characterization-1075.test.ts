import { describe, expect, it } from "vitest";
import { renderSectionBlocks } from "../../src/modules/course/contentBlocks.js";
import { renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";

// Karakteriseringstest for `:::kort` (#1079), skrevet FØR regelen «en overskrift begynner et nytt
// element» ble flyttet til én felles hjelper for kort, steg (#1075) og repetisjonskort (#1078).
// `:::kort` er i bruk i prod: HTML-en skal være tegn for tegn den samme etter flyttingen. Strengene er
// utskriften fra koden slik den var på 2.95.0, ikke skrevet for hånd.

const NL = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

describe(":::kort tegnes som på 2.95.0 (karakterisering før #1075/#1078)", () => {
  it("kort med ikon, liste og uthevet boks, med tekst før og etter", () => {
    const md = ["Tre kilder er vanlige.","",":::kort","### ![](asset:ikon-sak) Sakliste","","**Bruk når** møtet fulgte en plan.","","- Gir rekkefølgen","","### Egne notater","","> **Husk:** rydd først.","",":::","","Etter kortene."].join(NL);
    expect(renderSectionBlocks(md, "nb")).toBe("<p>Tre kilder er vanlige.</p>\n<div class=\"content-cards\"><section class=\"content-card\"><h3 class=\"content-card-title\"><img class=\"content-icon\" src=\"asset:ikon-sak\" alt=\"\"> Sakliste</h3><div class=\"content-card-body\"><p><strong>Bruk når</strong> møtet fulgte en plan.</p>\n<ul>\n<li>Gir rekkefølgen</li>\n</ul>\n</div></section><section class=\"content-card\"><h3 class=\"content-card-title\">Egne notater</h3><div class=\"content-card-body\"><blockquote class=\"content-callout\"><p><strong class=\"content-callout-label\">Husk:</strong> rydd først.</p>\n</blockquote>\n</div></section></div>\n<p>Etter kortene.</p>\n");
    expect(renderSectionMarkdown(md, "nb")).toBe("<p>Tre kilder er vanlige.</p>\n<div class=\"content-cards\"><section class=\"content-card\"><h3 class=\"content-card-title\"><img class=\"content-icon\" src=\"/api/content-assets/ikon-sak?locale=nb\" alt=\"\"> Sakliste</h3><div class=\"content-card-body\"><p><strong>Bruk når</strong> møtet fulgte en plan.</p>\n<ul>\n<li>Gir rekkefølgen</li>\n</ul>\n</div></section><section class=\"content-card\"><h3 class=\"content-card-title\">Egne notater</h3><div class=\"content-card-body\"><blockquote class=\"content-callout\"><p><strong class=\"content-callout-label\">Husk:</strong> rydd først.</p>\n</blockquote>\n</div></section></div>\n<p>Etter kortene.</p>\n");
  });

  it("innledning før første overskrift, og overskrifter på ulike nivåer", () => {
    const md = [":::kort","Innledning.","","### A","- en","#### B","tekst","# C","mer",":::"].join(NL);
    expect(renderSectionBlocks(md, "nb")).toBe("<p>Innledning.</p>\n<div class=\"content-cards\"><section class=\"content-card\"><h3 class=\"content-card-title\">A</h3><div class=\"content-card-body\"><ul>\n<li>en</li>\n</ul>\n</div></section><section class=\"content-card\"><h4 class=\"content-card-title\">B</h4><div class=\"content-card-body\"><p>tekst</p>\n</div></section><section class=\"content-card\"><h3 class=\"content-card-title\">C</h3><div class=\"content-card-body\"><p>mer</p>\n</div></section></div>\n");
    expect(renderSectionMarkdown(md, "nb")).toBe("<p>Innledning.</p>\n<div class=\"content-cards\"><section class=\"content-card\"><h3 class=\"content-card-title\">A</h3><div class=\"content-card-body\"><ul>\n<li>en</li>\n</ul>\n</div></section><section class=\"content-card\"><h4 class=\"content-card-title\">B</h4><div class=\"content-card-body\"><p>tekst</p>\n</div></section><section class=\"content-card\"><h3 class=\"content-card-title\">C</h3><div class=\"content-card-body\"><p>mer</p>\n</div></section></div>\n");
  });

  it("en ramme uten overskrift er vanlig tekst", () => {
    const md = [":::kort","Bare tekst.",":::"].join(NL);
    expect(renderSectionBlocks(md, "nb")).toBe("<p>Bare tekst.</p>\n");
    expect(renderSectionMarkdown(md, "nb")).toBe("<p>Bare tekst.</p>\n");
  });

  it(":::cards tett inntil teksten rundt", () => {
    const md = ["Tre kilder:",":::cards","### A","- en","### B","- to",":::","Slutt."].join(NL);
    expect(renderSectionBlocks(md, "nb")).toBe("<p>Tre kilder:</p>\n<div class=\"content-cards\"><section class=\"content-card\"><h3 class=\"content-card-title\">A</h3><div class=\"content-card-body\"><ul>\n<li>en</li>\n</ul>\n</div></section><section class=\"content-card\"><h3 class=\"content-card-title\">B</h3><div class=\"content-card-body\"><ul>\n<li>to</li>\n</ul>\n</div></section></div>\n<p>Slutt.</p>\n");
    expect(renderSectionMarkdown(md, "nb")).toBe("<p>Tre kilder:</p>\n<div class=\"content-cards\"><section class=\"content-card\"><h3 class=\"content-card-title\">A</h3><div class=\"content-card-body\"><ul>\n<li>en</li>\n</ul>\n</div></section><section class=\"content-card\"><h3 class=\"content-card-title\">B</h3><div class=\"content-card-body\"><ul>\n<li>to</li>\n</ul>\n</div></section></div>\n<p>Slutt.</p>\n");
  });

  it("Windows-linjeskift (CRLF)", () => {
    const md = [":::kort","### A","","en","","### B","","to",":::"].join(CRLF);
    expect(renderSectionBlocks(md, "nb")).toBe("<div class=\"content-cards\"><section class=\"content-card\"><h3 class=\"content-card-title\">A</h3><div class=\"content-card-body\"><p>en</p>\n</div></section><section class=\"content-card\"><h3 class=\"content-card-title\">B</h3><div class=\"content-card-body\"><p>to</p>\n</div></section></div>\n");
    expect(renderSectionMarkdown(md, "nb")).toBe("<div class=\"content-cards\"><section class=\"content-card\"><h3 class=\"content-card-title\">A</h3><div class=\"content-card-body\"><p>en</p>\n</div></section><section class=\"content-card\"><h3 class=\"content-card-title\">B</h3><div class=\"content-card-body\"><p>to</p>\n</div></section></div>\n");
  });

  it("bibliotekikon først i kortoverskriften", () => {
    const md = [":::kort","### ![](icon:lightbulb) Idé","","Tekst.",":::"].join(NL);
    expect(renderSectionBlocks(md, "nb")).toBe("<div class=\"content-cards\"><section class=\"content-card\"><h3 class=\"content-card-title\"><img class=\"content-icon\" src=\"icon:lightbulb\" alt=\"\"> Idé</h3><div class=\"content-card-body\"><p>Tekst.</p>\n</div></section></div>\n");
    expect(renderSectionMarkdown(md, "nb")).toBe("<div class=\"content-cards\"><section class=\"content-card\"><h3 class=\"content-card-title\"><img class=\"content-icon\" src=\"/static/icons/lightbulb.svg\" alt=\"\"> Idé</h3><div class=\"content-card-body\"><p>Tekst.</p>\n</div></section></div>\n");
  });
});
