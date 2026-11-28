import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// #1195: ankebehandlerens tabell hadde 90 nøkler på en-GB og 26 på nb og nn i minst to måneder uten at noe ble rødt, fordi bare
// 3 av 12 oversettelsestabeller hadde en paritetstest. Denne finner tabellene selv (dekningsvakt, ikke en liste), og sjekker den
// SAMMENSATTE tabellen — det sida faktisk bruker — slik at en nøkkel som arves fra en annen tabell, teller.

const MAPPE = fileURLToPath(new URL("../../public/i18n", import.meta.url));
const tabeller = readdirSync(MAPPE).filter((f) => f.endsWith("-translations.js")).sort();

describe("#1195 — alle oversettelsestabeller har de samme nøklene på alle språk", () => {
  it("kontroll: finner alle tabellene, også de som manglet test", () => {
    expect(tabeller.length).toBeGreaterThanOrEqual(12);
    expect(tabeller).toContain("appeal-handler-translations.js");
    expect(tabeller).toContain("review-translations.js");
  });

  for (const fil of tabeller) {
    it(`${fil}: nb og nn har hver nøkkel en-GB har`, async () => {
      const m = await import(pathToFileURL(join(MAPPE, fil)).href);
      const t = m.translations as Record<string, Record<string, string>>;
      const en = Object.keys(t["en-GB"] ?? {});
      expect(en.length).toBeGreaterThan(0);
      for (const locale of ["nb", "nn"]) {
        const mangler = en.filter((k) => !(k in (t[locale] ?? {})));
        expect(mangler, `${fil} ${locale} mangler`).toEqual([]);
      }
    });
  }
});
