import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT (#994): en testfil skal ikke laste `src/`-grafen inne i en testkropp.
//
// ⚠️ HVA DEN VOKTER MOT. Seks unit-filer og én integrasjonsfil feilet tilfeldig med
// «Test timed out in 20000ms», alltid på den FØRSTE testen i fila. Målingen:
//
//     kald graf   →  51 903 ms      varm graf  →  1 395 ms
//
// Samme fil, samme maskin, ingen last. Prisma er mocket i alle seks, så databasen — som saken
// gjettet på — var aldri inne i bildet. Kostnaden er å LESE modulgrafen fra disk, og repoet
// ligger i OneDrive.
//
// ⚠️ Det gjør `testTimeout` til en måler av lesehastighet i stedet for av hengende logikk, og
// verre: vitest kan ikke STOPPE en utløpt test. Den fortsetter å kjøre, og kallene den rekker å
// gjøre lander i NESTE tests spionteller. Det er nøyaktig slik TC-POL-RED-002 kom til å påstå
// «expected 1, got 2» — et symptom som ser ut som en logikkfeil i policyen, og som kostet en time
// på feil spor.
//
// Kuren har samme form som #958: gi kostnaden ett navngitt sted (`warmModuleGraph`), så ingen
// test KAN belastes for den. Vakta her nekter en ny fil som går utenom.
//
// Merk hva vakta IKKE gjør: den nekter ikke `await import(...)` i en testkropp. Den er ofte
// nødvendig, fordi mock-fabrikkene lukker over `const x = vi.fn()` og en statisk import ville
// kjørt fabrikken før variabelen fantes. Vakta krever bare at fila varmer opp først.
// ─────────────────────────────────────────────────────────────────────────────

const TEST_ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * Filer som med vilje IKKE varmer opp. Hver MÅ ha en grunn — et unntak uten begrunnelse er bare
 * en vakt som er slått av.
 */
const EXCEPTIONS = {
  "authenticate-middleware.test.ts":
    "bruker `vi.doMock`, som ikke heises: mocken virker bare på importer gjort ETTER kallet, så " +
    "en oppvarming ville gitt første test den umockede modulen",
};

// e2e kjører i Playwright, ikke i vitest, og har ingen `testTimeout` av denne typen.
const SKIP_DIRS = new Set(["e2e", "node_modules", "fixtures", "support"]);

function collectTestFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      found.push(...collectTestFiles(full));
      continue;
    }
    if (/\.test\.(ts|js)$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Enhver dynamisk import av en produksjonsmodul. `typeof import(...)` er en typeposisjon og
 * koster ingenting ved kjøring, så den holdes utenfor.
 *
 * ⚠️ Første utkast av denne vakta krevde `await` og telte bare treff ETTER første `it(`.
 * QA-porten avviste den, med to konkrete moteksempler i repoet:
 *
 *   `test/unit/content-validation-service.test.ts:425`  →  `return import(...).then(...)`
 *   `test/unit/course-items-accessor.test.ts:152`       →  `await import(...)` i en hjelpefunksjon
 *                                                          DEKLARERT over første `it(`
 *
 * Den siste er den lærerike. Posisjonen i fila sier ingenting om når koden KJØRER: en hjelper
 * deklarert øverst og kalt fra en test belastes testens budsjett like fullt. Vakta så grønn ut
 * mens nøyaktig regresjonen den skulle hindre lå i fila.
 */
const SRC_DYNAMIC_IMPORT = /(?<!typeof\s{0,20})\bimport\s*\(\s*["']([^"']*\/src\/[^"']*)["']/g;

/** Spesifikatorene som faktisk varmes opp — de som står inne i et `warmModuleGraph(...)`-kall. */
function warmedSpecifiers(source) {
  const warmed = new Set();
  for (const call of source.matchAll(/warmModuleGraph\s*\(/g)) {
    // Les fram til parentesen lukkes, så et flerlinjes kall med flere importer tas med.
    let depth = 0;
    let i = call.index + call[0].length - 1;
    for (; i < source.length; i += 1) {
      if (source[i] === "(") depth += 1;
      else if (source[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = source.slice(call.index, i);
    for (const m of body.matchAll(SRC_DYNAMIC_IMPORT)) warmed.add(m[1]);
  }
  return warmed;
}

function analyse(file) {
  const source = readFileSync(file, "utf8");
  const warmed = warmedSpecifiers(source);

  // ⚠️ Per SPESIFIKATOR, ikke en fil-bred boolean. En fil kan varme opp én modul og laste en
  // annen kaldt inne i en test — `course-items-accessor.test.ts` gjorde nøyaktig det.
  const cold = new Set();
  for (const m of source.matchAll(SRC_DYNAMIC_IMPORT)) {
    if (!warmed.has(m[1])) cold.add(m[1]);
  }
  if (cold.size === 0 && warmed.size === 0) return null;

  return {
    file: relative(TEST_ROOT, file).replace(/\\/g, "/"),
    imports: warmed.size + cold.size,
    cold: [...cold],
    warmed: cold.size === 0,
  };
}

describe("#994 modulgrafen lastes utenfor testenes tidsbudsjett", () => {
  const analysed = collectTestFiles(TEST_ROOT).map(analyse).filter(Boolean);

  it("måler faktisk noe", () => {
    // ⚠️ KONTROLLASSERTION. Uten den ville vakta vært grønn hvis regexen sluttet å matche —
    // og en vakt som måler null er verre enn ingen vakt, fordi den ser ut som dekning.
    //
    // ⚠️ Tallet er også selve funnet. Håndlista mi var på SEKS filer — de som faktisk hadde
    // feilet. Vakta fant 37. De seks var bare de med dypest modulgraf, altså de som traff 20 s
    // først; mønsteret lå i hele repoet. En liste over «alle stedene som må gjøre X» kan ikke
    // finne stedet ingen tenkte på.
    expect(analysed.length).toBeGreaterThanOrEqual(30);
    expect(analysed.some((entry) => entry.imports > 1)).toBe(true);
  });

  it("hvert unntak gjelder en fil som faktisk finnes og faktisk lar være å varme opp", () => {
    // ⚠️ Et unntak som ikke lenger trengs er en løgn om hvorfor koden ser ut som den gjør.
    const stale = Object.keys(EXCEPTIONS).filter(
      (name) => !analysed.some((entry) => entry.file === name && !entry.warmed),
    );
    expect(stale, "Unntak som ikke lenger gjelder — fjern dem.").toEqual([]);
  });

  it("hver fil som laster src/ i en testkropp varmer opp grafen først", () => {
    const missing = analysed.filter((entry) => !entry.warmed && !(entry.file in EXCEPTIONS));

    expect(
      missing.map((entry) => `${entry.file} → ${entry.cold.join(", ")}`),
      "Disse filene laster produksjonskode inne i en testkropp uten å varme opp grafen først.\n" +
        "Legg til `warmModuleGraph(() => import(\"…\"))` på modulnivå i fila — se\n" +
        "test/support/moduleGraphWarmup.ts for hvorfor.",
    ).toEqual([]);
  });
});
