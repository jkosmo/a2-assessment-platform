import { describe, expect, it } from "vitest";
import { rowActionsHtml, ROW_ACTIONS_MAX } from "../../public/static/row-actions.js";

// #1046 D5: knapperaden i listene brekker aldri til to linjer. Målt på galleribildene (1280 px) er
// det plass til fire korte knapper; er det flere, vises tre pluss «Mer» med resten i menyen.
//
// Regelen bor ETT sted (row-actions.js) og brukes av alle fire listesidene. Testen måler regelen,
// ikke sidene — sidene måles av e2e-testene som ser på radene.
describe("#1046 D5 — maks fire i raden", () => {
  const knapp = (navn) => `<button class="row-action-btn">${navn}</button>`;

  it("fire eller færre vises som de er, uten «Mer»", () => {
    const html = rowActionsHtml([knapp("Åpne"), knapp("Arkiver"), knapp("Slett")]);
    expect(html).toBe(knapp("Åpne") + knapp("Arkiver") + knapp("Slett"));
    expect(html).not.toContain("row-more");
    expect(rowActionsHtml([knapp("A"), knapp("B"), knapp("C"), knapp("D")])).not.toContain("row-more");
  });

  it("fem eller flere: de tre første i raden, resten under «Mer», i samme rekkefølge", () => {
    const html = rowActionsHtml([knapp("Åpne"), knapp("Dupliser"), knapp("Eksporter"), knapp("Avpubliser"), knapp("Arkiver")]);
    const [iRaden, iMenyen] = html.split('<div class="row-more-menu">');
    expect(iRaden).toContain(knapp("Åpne") + knapp("Dupliser") + knapp("Eksporter"));
    expect(iRaden).not.toContain("Avpubliser");
    expect(iRaden).toContain('<details class="row-more"><summary class="row-action-btn"');
    expect(iRaden).toContain(">Mer</summary>");
    expect(iMenyen).toContain(knapp("Avpubliser") + knapp("Arkiver"));
  });

  it("tomme oppføringer teller ikke — en rad med skjulte handlinger får ikke «Mer» for ingenting", () => {
    const html = rowActionsHtml([knapp("Åpne"), "", null, undefined, false, knapp("Eksporter"), "   ", knapp("Arkiver")]);
    expect(html).not.toContain("row-more");
    expect(html).toBe(knapp("Åpne") + knapp("Eksporter") + knapp("Arkiver"));
  });

  it("«Mer» kan oversettes, og grensen er fire", () => {
    expect(ROW_ACTIONS_MAX).toBe(4);
    const html = rowActionsHtml([knapp("A"), knapp("B"), knapp("C"), knapp("D"), knapp("E")], { moreLabel: "Meir" });
    expect(html).toContain(">Meir</summary>");
    expect(html).toContain('aria-label="Meir handlinger"');
  });
});
