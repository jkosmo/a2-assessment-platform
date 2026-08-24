import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT (#978): «er dette forsøket bestått» avgjøres i /static/outcome.js.
//
// ⚠️ Spørsmålet ble besvart åtte steder etter TRE regelsett. Bare ett av dem så
// `submissionStatus`, så samme deltaker kunne få to svar i samme økt: rød «Ikke bestått» på
// /profile og /participant/completed, nøytral i resultatbanneret — for den samme innleveringen.
//
// ⚠️ Vakta krever IKKE at alle bruker samme funksjon. Kartleggingen viste at «bestått?» er fem
// spørsmål med ulike riktige svar, og outcome.js har derfor fem navngitte inngangner. Det vakta
// krever er at avgjørelsen tas DER, ikke skrives på nytt på stedet.
//
// Det er #958-formen anvendt på klienten: kalleren må si hvilket spørsmål den stiller.
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC = fileURLToPath(new URL("../public", import.meta.url));
const HOME = "static/outcome.js";

// En rå sammenligning mot beslutningsverdien. Fanger `=== true`, `=== false`, `!== true` osv.
// ⚠️ Fanger med vilje IKKE `passFailTotal:` — det er en SKRIVING (skjemafeltene i review.js
// sender verdien til serveren), ikke en utledning av et utfall.
//
// ⚠️ Matcher ETHVERT navn som inneholder «passFail», ikke bare `passFailTotal`. Første utkast var
// bundet til feltnavnet, og QA-porten fant at `flowState.resultPassFail === true` i participant.js
// dermed slapp unna: verdien var kopiert rått fra `passFailTotal`, men under et alias. Vakta var
// grønn mens nøyaktig regresjonen den skulle hindre sto i fila.
const RAW_COMPARISON = /\b\w*[Pp]assFail\w*\s*[!=]==\s*(?:true|false)\b/g;

function collectJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...collectJs(full));
      continue;
    }
    if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

function analyse() {
  const offenders = [];
  const importers = [];
  let comparisonsAtHome = 0;

  for (const file of collectJs(PUBLIC)) {
    const rel = relative(PUBLIC, file).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");

    // Kommentarer skal kunne beskrive regelen uten å telle som brudd.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

    const hits = [...code.matchAll(RAW_COMPARISON)].length;
    if (rel === HOME) {
      comparisonsAtHome = hits;
      continue;
    }
    if (hits > 0) offenders.push(`${rel} (${hits})`);
    if (/from\s+["'][^"']*\/outcome\.js["']/.test(source)) importers.push(rel);
  }

  return { offenders, importers, comparisonsAtHome };
}

describe("#978 utfallet avgjøres ett sted", () => {
  const { offenders, importers, comparisonsAtHome } = analyse();

  it("måler faktisk noe", () => {
    // ⚠️ KONTROLLASSERTION. Slutter regexen å matche, blir vakta grønn av tomhet og ser ut som
    // dekning. Regelen SKAL finnes i outcome.js — den bor der.
    expect(comparisonsAtHome, "outcome.js har ingen sammenligninger — regexen måler ingenting")
      .toBeGreaterThanOrEqual(4);

    // Og konverteringen skal faktisk ha skjedd: fem bundler henter avgjørelsen derfra.
    expect(importers.length, `bare disse importerer outcome.js: ${importers.join(", ")}`)
      .toBeGreaterThanOrEqual(5);
  });

  it("ingen bundle utleder utfallet på egen hånd", () => {
    expect(
      offenders,
      "Disse sammenligner `passFailTotal` direkte i stedet for å spørre /static/outcome.js.\n"
        + "Velg spørsmålet som passer — deriveOutcome, isAppealableFail, hasPassingDecision,\n"
        + "isSettledPass eller rawPassFailState — og les begrunnelsene der før du legger til en sjette.",
    ).toEqual([]);
  });
});
