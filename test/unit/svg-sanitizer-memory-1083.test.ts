import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// #1083: SVG-rensingen holdt igjen rundt 1,5 MB for HVER figur den renset, til appen ble startet på
// nytt. Årsaken var ett `querySelector` på et tre som tilhører et jsdom-vindu som lever like lenge
// som prosessen. Appen går på én liten instans, og en kursimport med figurer ville fylt den.
//
// ⚠️ Ingen av de andre testene kunne sett dette: resultatet var riktig hver gang. Det eneste som
// skiller en lekkasje fra frisk kode, er minnet — så det er minnet som måles her, i en egen prosess
// med `--expose-gc`. Testen vokter ikke en skrivemåte («ikke bruk querySelector»); den vokter
// virkningen, uansett hvilket kall som gir den.
describe("SVG-rensingen holder ikke igjen minne (#1083)", () => {
  it("ingen av veiene gjennom svgSanitizer vokser per kall", () => {
    const kjøring = spawnSync(
      process.execPath,
      ["--expose-gc", "--import", "tsx", "test/support/measureSvgSanitizerMemory.mts", "40"],
      { encoding: "utf8" },
    );
    expect(kjøring.status, kjøring.stderr).toBe(0);
    const { holdtIgjenKbPerKall } = JSON.parse(kjøring.stdout.trim().split("\n").at(-1) ?? "{}") as {
      holdtIgjenKbPerKall: Record<string, number>;
    };

    // Alle fire veiene skal være målt — en vei som forsvinner fra målingen, er ikke lenger voktet.
    expect(Object.keys(holdtIgjenKbPerKall).sort()).toEqual(
      ["applySvgTextTranslations", "extractSvgTexts", "isSvgReadableAsImage", "sanitizeSvg"],
    );
    // Frisk kode ligger under 10 kB per kall (støy); lekkasjen lå på rundt 1500. Grensa står midt
    // imellom med god margin til begge sider, så den verken blafrer eller slipper en reell lekkasje.
    for (const [vei, kb] of Object.entries(holdtIgjenKbPerKall)) {
      expect(kb, `${vei} holder igjen ${kb} kB per kall`).toBeLessThan(200);
    }
  }, 120_000);
});
