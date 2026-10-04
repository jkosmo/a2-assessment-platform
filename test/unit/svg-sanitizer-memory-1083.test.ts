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

    // Alle veiene skal være målt — en vei som forsvinner fra målingen, er ikke lenger voktet.
    // Lesbarhetskontrollen måles to ganger: på en figur som leses, og på en som ikke gjør det.
    // Feilveien er den reparasjonen av gamle figurer går, og den ble først ikke målt.
    expect(Object.keys(holdtIgjenKbPerKall).sort()).toEqual(
      ["applySvgTextTranslations", "extractSvgTexts", "isSvgReadableAsImage", "isSvgReadableAsImageUleselig", "sanitizeSvg"],
    );
    // Frisk kode ligger under 20 kB per kall (støy); lekkasjen lå på rundt 1500. Grensa står midt
    // imellom med god margin til begge sider, så den verken blafrer eller slipper en reell lekkasje.
    // Lesbarhetskontrollen bygger ikke noe tre og ligger på 0–2 kB. En lekkasje i feilveien dens
    // ble målt til 45 kB per figur, så den har en egen, strammere grense.
    const grenser: Record<string, number> = { isSvgReadableAsImage: 20, isSvgReadableAsImageUleselig: 20 };
    for (const [vei, kb] of Object.entries(holdtIgjenKbPerKall)) {
      expect(kb, `${vei} holder igjen ${kb} kB per kall`).toBeLessThan(grenser[vei] ?? 200);
    }
  }, 120_000);

  // Lesbarhetskontrollen leste først figuren inn i et nytt dokument mens det rensede treet ennå
  // levde. Det doblet minnetoppen: en tett figur på 1 MB tok ned prosessen ved 512 MB heap, der
  // koden før #1083 lagret den. Kontrollen skal lese gjennom teksten uten å bygge noe.
  //
  // Målt på virkningen: 4 MB tett figur med 256 MB heap. Uten tre trengs lite utover selve teksten;
  // med tre trengs rundt 1 GB. Avstanden er så stor at testen verken blafrer eller slipper feilen.
  it("lesbarhetskontrollen bygger ikke et dokument av figuren", () => {
    const kjøring = spawnSync(
      process.execPath,
      ["--max-old-space-size=256", "--import", "tsx", "test/support/checkLargeSvgReadable.mts", "4"],
      { encoding: "utf8" },
    );
    expect(kjøring.status, kjøring.stderr.slice(0, 600)).toBe(0);
    const svar = JSON.parse(kjøring.stdout.trim().split("\n").at(-1) ?? "{}") as { figurBytes: number; lesbar: boolean };
    expect(svar.figurBytes).toBeGreaterThan(4 * 1024 * 1024);
    expect(svar.lesbar).toBe(true);
  }, 120_000);
});
