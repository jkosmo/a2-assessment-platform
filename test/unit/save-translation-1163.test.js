import { describe, expect, it } from "vitest";
import { changedFieldTranslations } from "../../public/static/admin-content-localized-copy.js";
import { sectionGapFill } from "../../public/static/admin-content-sections-state.js";

// #1163 skive 2 (prinsipp 3 og 4, doc/DECISIONS.md «felles prinsipper»): de to rene reglene bak oversettingen ved lagring og
// «Fyll inn det som mangler». Nettverket og skjemaet prøves i e2e (test/e2e/section-save-translation-1163.spec.ts).

const LOCALES = ["nb", "nn", "en-GB"];
const kart = (nb, nn, en) => ({ nb, nn, "en-GB": en });

describe("changedFieldTranslations: bare endrede felt, fra språket som ble endret", () => {
  it("et felt som er endret på ett språk, oversettes fra det til de to andre", () => {
    const plan = changedFieldTranslations(
      { title: { current: kart("Ny", "Gammal", "Old"), saved: kart("Gammel", "Gammal", "Old") } },
      { editLocale: "nb", locales: LOCALES },
    );
    expect(plan).toEqual({ title: { sourceLocale: "nb", targetLocales: ["nn", "en-GB"] } });
  });

  it("KONTROLL: et felt ingen har rørt, oversettes ikke — heller ikke når det mangler et språk", () => {
    const plan = changedFieldTranslations(
      {
        title: { current: kart("Tittel", "", "Title"), saved: kart("Tittel", "", "Title") },
        bodyMarkdown: { current: kart("Ny tekst", "Tekst", "Text"), saved: kart("Tekst", "Tekst", "Text") },
      },
      { editLocale: "nb", locales: LOCALES },
    );
    expect(Object.keys(plan)).toEqual(["bodyMarkdown"]);
  });

  it("kilden er språket som ble endret, også når forfatteren står på et annet språk nå", () => {
    const plan = changedFieldTranslations(
      { bodyMarkdown: { current: kart("Tekst", "Tekst", "Changed"), saved: kart("Tekst", "Tekst", "Text") } },
      { editLocale: "nb", locales: LOCALES },
    );
    expect(plan.bodyMarkdown).toEqual({ sourceLocale: "en-GB", targetLocales: ["nb", "nn"] });
  });

  it("to språk endret i samme lagring: kilden er språket forfatteren står i, og det andre språket forfatteren skrev, overskrives ikke", () => {
    const plan = changedFieldTranslations(
      { bodyMarkdown: { current: kart("Ny", "Gammal", "Fixed"), saved: kart("Gammel", "Gammal", "Old") } },
      { editLocale: "en-GB", locales: LOCALES },
    );
    expect(plan.bodyMarkdown).toEqual({ sourceLocale: "en-GB", targetLocales: ["nn"] });
  });

  it("et tømt språk oversettes ikke fra; alle tre endret gir ingenting å oversette", () => {
    expect(changedFieldTranslations({ title: { current: kart("", "Tittel", "Title"), saved: kart("Tittel", "Tittel", "Title") } }, { editLocale: "nb", locales: LOCALES })).toEqual({});
    expect(changedFieldTranslations({ title: { current: kart("A", "B", "C"), saved: kart("a", "b", "c") } }, { editLocale: "nb", locales: LOCALES })).toEqual({});
  });

  it("en ny seksjon (ingenting lagret): det forfatteren skrev, oversettes til språkene som er tomme", () => {
    const plan = changedFieldTranslations(
      { title: { current: kart("Ny", "", ""), saved: kart("", "", "") }, bodyMarkdown: { current: kart("Tekst", "", ""), saved: undefined } },
      { editLocale: "nb", locales: LOCALES },
    );
    expect(plan).toEqual({ title: { sourceLocale: "nb", targetLocales: ["nn", "en-GB"] }, bodyMarkdown: { sourceLocale: "nb", targetLocales: ["nn", "en-GB"] } });
  });

  it("mellomrom i enden er ikke en endring", () => {
    expect(changedFieldTranslations({ title: { current: kart("Tittel \n", "T", "T"), saved: kart("Tittel", "T", "T") } }, { editLocale: "nb", locales: LOCALES })).toEqual({});
  });
});

describe("sectionGapFill: «Fyll inn det som mangler» fyller bare hullene porten fant", () => {
  const issues = [{ field: "bodyMarkdown", missingLocales: ["en-GB", "nn"] }];

  it("kilden er det første foretrukne språket som har tekst i feltene porten klaget på; målene er språkene som mangler", () => {
    const values = { title: kart("T", "", ""), bodyMarkdown: kart("Tekst", "", "") };
    expect(sectionGapFill(issues, values, ["en-GB", "nb"])).toEqual({ sourceLocale: "nb", fields: ["bodyMarkdown"], targetLocales: ["nn", "en-GB"] });
  });

  it("bare feltene porten klaget på kreves i kilden: en seksjon som mangler tittelen på nynorsk, trenger ikke tekst i kilden", () => {
    const values = { title: kart("", "", "Title"), bodyMarkdown: kart("", "Tekst", "") };
    expect(sectionGapFill([{ field: "title", missingLocales: ["nb", "nn"] }], values, ["nb"])).toEqual({ sourceLocale: "en-GB", fields: ["title"], targetLocales: ["nb", "nn"] });
  });

  it("KONTROLL: ingen kilde har alt som mangler → null; ingen port-hull → null", () => {
    const values = { title: kart("T", "", ""), bodyMarkdown: kart("", "Tekst", "") };
    expect(sectionGapFill([...issues, { field: "title", missingLocales: ["nn", "en-GB"] }], values, ["nb"])).toBeNull();
    expect(sectionGapFill([], values, ["nb"])).toBeNull();
    expect(sectionGapFill([{ code: "other_issue" }], values, ["nb"])).toBeNull();
  });
});
