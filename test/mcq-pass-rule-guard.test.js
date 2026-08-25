import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT (#949): MCQ-grensen bestemmes i `modules/assessment/mcqPassRule.ts`.
//
// ⚠️ Hva den vokter mot. `mcqService` regnet ut det LAGREDE feltet `passFailMcq` med
// `percentScore >= 50`, mens `decisionService` fattet vedtaket etter modulens policy. En kandidat
// med 60 % fikk «ikke bestått, under 70 %» side om side med raden «MCQ bestått: Ja» — i
// ankebehandlerens skjermbilde, som er der saken faktisk avgjøres.
//
// ⚠️ Hvor 50-tallet kom fra er selve lærdommen: linja ble stående igjen av
// `refactor: forenkle vurderingsmodell til én terskel (#257)`. Commiten som forenklet til ÉN
// terskel er den som etterlot den andre. Vakta finnes fordi den neste oppryddingen kan gjøre det
// samme.
//
// ⚠️ Merk hva den IKKE krever. `passFailMcq` er fortsatt en LAGRET avledet verdi — selve
// feilklassen. Å utlede den ved lesing i stedet krever at policyen tres gjennom tre tjenester, og
// er skilt ut som egen sak sammen med å droppe kolonnen. Til da er dette det som holder de to
// stavemåtene i takt.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const HOME = "modules/assessment/mcqPassRule.ts";

/**
 * En terskelsammenligning mot en MCQ-prosent. Fanger `percentScore >= 50`,
 * `mcqPercentScore >= 70` og liknende — altså at noen avgjør «bestått» på stedet.
 */
const INLINE_THRESHOLD = /\b\w*[Pp]ercent(?:Score)?\w*\s*[<>]=?\s*\d+/g;

/** Et hardkodet tall der grensen skal komme fra policyen. */
const HARDCODED_DEFAULT = /mcqMinPercent\s*\?\?\s*\d+/g;

/** Filer som med vilje står utenfor. Hver MÅ ha en grunn. */
const EXCEPTIONS = {
  // Beholder sin egen `?? DEFAULT_MCQ_ONLY_MIN_PERCENT` som siste skanse hvis regelen
  // returnerer null for en modus den ikke kjenner. Konstanten kommer fra mcqPassRule.
  "modules/assessment/decisionService.ts":
    "kaller resolveMcqMinPercent og faller tilbake på den delte konstanten, ikke på et eget tall",
};

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full));
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function analyse() {
  const offenders = [];
  let hitsAtHome = 0;

  for (const file of collect(SRC)) {
    const rel = relative(SRC, file).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

    const hits =
      [...code.matchAll(INLINE_THRESHOLD)].length + [...code.matchAll(HARDCODED_DEFAULT)].length;

    if (rel === HOME) {
      hitsAtHome = hits;
      continue;
    }
    if (hits > 0 && !(rel in EXCEPTIONS)) offenders.push(`${rel} (${hits})`);
  }

  return { offenders, hitsAtHome, scanned: collect(SRC).length };
}

describe("#949 MCQ-grensen bestemmes ett sted", () => {
  const { offenders, hitsAtHome, scanned } = analyse();

  it("detektoren virker — den fanger den gamle linja", () => {
    // ⚠️ KONTROLLASSERTION, og den måtte omformuleres: første utkast krevde at HJEMMEfila selv
    // inneholdt en treff. Den gjør den ikke, og skal ikke — `mcqPassRule` sammenligner mot en
    // VARIABEL (`percentScore >= minPercent`), som er hele poenget. Regexen leter etter
    // sammenligning mot et TALL.
    //
    // Riktig kontroll er derfor å vise at detektoren fanger den faktiske linja saken handlet om.
    const oldLine = "  const passFailMcq = percentScore >= 50;";
    expect([...oldLine.matchAll(INLINE_THRESHOLD)].length, "regexen fanger ikke den gamle linja")
      .toBeGreaterThanOrEqual(1);
    const oldDefault = "input.assessmentPolicy?.passRules?.mcqMinPercent ?? 70";
    expect([...oldDefault.matchAll(HARDCODED_DEFAULT)].length, "regexen fanger ikke et hardkodet standardtall")
      .toBeGreaterThanOrEqual(1);

    // Og regelen skal faktisk bo i hjemmefila.
    const home = readFileSync(join(SRC, HOME), "utf8");
    expect(home).toMatch(/DEFAULT_MCQ_ONLY_MIN_PERCENT\s*=\s*70/);
    expect(scanned, "ingen filer skannet").toBeGreaterThan(50);
    expect(hitsAtHome).toBeGreaterThanOrEqual(0);
  });

  it("hvert unntak gjelder en fil som finnes", () => {
    const missing = Object.keys(EXCEPTIONS).filter(
      (rel) => !collect(SRC).some((f) => relative(SRC, f).replace(/\\/g, "/") === rel),
    );
    expect(missing, "Unntak som peker på filer som ikke finnes — fjern dem.").toEqual([]);
  });

  it("ingen tjeneste avgjør MCQ-grensen på egen hånd", () => {
    expect(
      offenders,
      "Disse sammenligner en MCQ-prosent mot et tall i stedet for å spørre mcqPassRule.\n"
        + "Bruk resolveMcqMinPercent(assessmentMode, policy) og deriveMcqPassFail(score, grense).\n"
        + "⚠️ Husk at grensen er ULIK per modustype — se begrunnelsen i mcqPassRule.ts.",
    ).toEqual([]);
  });
});
