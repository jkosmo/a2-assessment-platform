import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT: bokmål som har sneket seg inn i nynorsk-tabellene.
//
// Vi har funnet TO slike på to dager — `notAnEnvelope` (#937) og `noCourses` (#986), begge i
// `LABELS.nn` i admin-content-sections.js. Ingen av dem ble fanget av noe.
//
// ⚠️ Nøkkelparitetstesten kan per definisjon ikke fange dette: nøkkelen FINNES i alle tre språk.
// Den sjekker at kartet har samme nøkler, ikke at verdiene er på riktig språk. En hardkodet liste
// over «steder som må sjekkes» ville hatt samme problem som #938 — den kan ikke oppdage stedet
// ingen tenkte på. Derfor finner testen tabellene selv.
//
// Markørene er valgt for PRESISJON, ikke dekning: hvert ord er utvetydig bokmål med en annen
// nynorsk-form. Et falskt positivt her er verre enn et falskt negativt, fordi det lærer folk å
// ignorere testen.
// ─────────────────────────────────────────────────────────────────────────────

const BOKMAL = [
  [/\bikke\b/i, "ikkje"],
  [/\bnoe\b/i, "noko"],
  [/\bnoen\b/i, "nokon/nokre"],
  [/\bmangler\b/i, "manglar"],
  [/\binnhold(et)?\b/i, "innhald(et)"],
  [/\bhvilken\b/i, "kva"],
  [/\bhvilke\b/i, "kva for"],
  [/\bhvordan\b/i, "korleis"],
  [/\bhva\b/i, "kva"],
  // ⚠️ «språk/språket» sto her først og ga to falske positive på ekte nynorsk («Omset frå dette
  // språket»). Ordet er identisk i begge målformer. Beholdt som advarsel: en markør må ha en ANNEN
  // nynorsk-form, ellers lærer testen folk å ignorere seg selv.
];

function offend(text) {
  for (const [re, hint] of BOKMAL) {
    const m = re.exec(text);
    if (m) return { word: m[0], hint };
  }
  return null;
}

function abs(rel) {
  return fileURLToPath(new URL(`../${rel}`, import.meta.url));
}

// Finner hver `nn: {`-blokk i hver .js-fil i katalogen og plukker ut strengverdiene.
// Blokka slutter på første linje med samme innrykk som `nn:` og en avsluttende `}`.
function scanNnBlocks(dir) {
  const found = [];
  let scanned = 0;

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(`${dir}/${file}`, "utf8");
    const open = /^(\s*)"?nn"?:\s*\{/m.exec(src);
    if (!open) continue;
    const indent = open[1];
    const rest = src.slice(open.index + open[0].length);
    const close = new RegExp(`^${indent}\\}`, "m").exec(rest);
    if (!close) continue;
    scanned++;

    const block = rest.slice(0, close.index);
    // Nøkkel (bar eller sitert) : "verdi" — verdien kan stå på neste linje.
    const re = /(?:"([^"]+)"|(\w+))\s*:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(block)) !== null) {
      const key = m[1] ?? m[2];
      const lineStart = block.lastIndexOf("\n", m.index) + 1;
      if (block.slice(lineStart, m.index).trimStart().startsWith("//")) continue;
      const value = m[3].replace(/\\"/g, '"');
      const hit = offend(value);
      if (hit) found.push(`${file} → ${key}: «${hit.word}» (nynorsk: ${hit.hint}) — "${value}"`);
    }
  }

  return { found, scanned };
}

describe("nynorsk-tabellene inneholder ikke bokmål", () => {
  it("public/i18n/*.js — hver nn-verdi er nynorsk", () => {
    // ⚠️ Disse kan IKKE importeres: flere av dem importerer hverandre via nettleser-absolutte stier
    // (`/static/i18n/…`) som vitest ikke løser. Tekstskanning er ikke elegant, men den virker for
    // alle filene — og en test som bare dekker halvparten er verre enn ingen.
    const { found, scanned } = scanNnBlocks(abs("public/i18n"));
    expect(scanned).toBeGreaterThan(0);
    expect(found, `Bokmål i nn-tabell:\n${found.join("\n")}`).toEqual([]);
  });

  it("LABELS.nn i public/static/*.js — hver verdi er nynorsk", () => {
    // Disse tabellene er hardkodet inne i moduler som importerer DOM-avhengigheter, så de kan ikke
    // importeres i en unit-test. Vi leser dem som tekst og klipper ut nn-blokka.
    const dir = abs("public/static");
    const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
    const found = [];
    let scanned = 0;

    for (const file of files) {
      const src = readFileSync(`${dir}/${file}`, "utf8");
      const start = src.search(/^\s{2}nn:\s*\{/m);
      if (start === -1) continue;
      // Blokka slutter på den første linja med nøyaktig to mellomrom og "}," — samme innrykk som "nn:".
      const rest = src.slice(start);
      const end = rest.search(/^\s{2}\},/m);
      if (end === -1) continue;
      scanned++;

      const block = rest.slice(0, end);
      // Fang strengverdier: nøkkel: "tekst". Hopper over kommentarlinjer.
      const re = /(\w+):\s*"((?:[^"\\]|\\.)*)"/g;
      let m;
      while ((m = re.exec(block)) !== null) {
        const [, key, raw] = m;
        const lineStart = block.lastIndexOf("\n", m.index) + 1;
        if (block.slice(lineStart, m.index).trimStart().startsWith("//")) continue;
        const value = raw.replace(/\\"/g, '"');
        const hit = offend(value);
        if (hit) found.push(`${file} → ${key}: «${hit.word}» (nynorsk: ${hit.hint}) — "${value}"`);
      }
    }

    // ⚠️ Kontrollcase: fant testen i det hele tatt noen tabeller? Uten dette ville en endring i
    // filstruktur gjort testen grønn ved å måle ingenting — nøyaktig fella som ga oss en falsk
    // «47 av 47 er lokalisert» tidligere i uka.
    expect(scanned).toBeGreaterThan(0);
    expect(found, `Bokmål i LABELS.nn:\n${found.join("\n")}`).toEqual([]);
  });
});
