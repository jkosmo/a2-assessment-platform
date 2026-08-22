import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT: serverens feilmelding skal ikke vises rått.
//
// `apiFetch` bygger `message` som `"<status>: <hele JSON-kroppen>"` (api-client.js:167). En
// `showToast(..., err.message)` viser derfor dette til brukeren:
//
//     403: {"error":"content_ownership","message":"You can only modify content you own."}
//
// To feil i én: JSON i grensesnittet, og teksten på serverens språk i et konsoll som defaulter
// til en-GB. Regelen er skrevet ned (FEATURE_SURFACE_MAP §24): KODEN er kontrakten, klienten
// rendrer på brukerens språk.
//
// ⚠️ Dette er en RATSJ, ikke en ren forbudsliste. Gjelden finnes allerede (#972), og en vakt som
// er rød fra dag én blir slått av. Baselinen fryser antallet per fil: nye forekomster feiler, og
// FIKSER man noen, feiler den også — med beskjed om å sette tallet ned. Begge retninger er
// poenget. Et tall som bare kan stå stille er ikke en ratsj.
//
// De norske `?? "Kunne ikke arkivere modul."`-fallbackene på disse linjene er forresten DØD KODE:
// `err.message` er alltid satt av apiFetch, så den norske teksten kan aldri vises.
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC = fileURLToPath(new URL("../public", import.meta.url));

// Fil -> antall kjente rå bruk. Arbeidslista for #972; hver linje som forsvinner herfra er en
// flate som har fått lesbar feiltekst.
const BASELINE = {
  // #988: nede fra 3. De to gjenværende var kursflytenes rå `error.message`; de går nå gjennom
  // `participantErrorToast`. Den ene som står igjen er oversetterens EGEN fallback — den viser en
  // allerede oversatt melding (f.eks. «Spørsmål 4 mangler svar»), og skal være der.
  "participant.js": 1,
  "static/admin-content-calibration.js": 1,
  "static/admin-content-classes.js": 9,
  "static/admin-content-courses.js": 8,
  "static/admin-content-library.js": 5,
  "static/admin-content-sections.js": 7,
  "static/admin-content-shell.js": 1,
  "static/discussion-panel.js": 1,
};
// 35 til sammen, per 2026-08-21. Tallet er gjelden i #972.

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : entry.endsWith(".js") ? [full] : [];
  });
}

// Les fra `showToast(` til den balanserte sluttparentesen. En regex over én linje bommer på
// flerlinjede kall — og det er nettopp de lange som pleier å dumpe JSON.
function showToastCalls(src) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf("showToast(", i)) !== -1) {
    let depth = 0;
    let j = i + "showToast".length;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") {
        depth--;
        if (depth === 0) { j++; break; }
      }
    }
    out.push({ text: src.slice(i, j), line: src.slice(0, i).split("\n").length });
    i = j;
  }
  return out;
}

const RAW = /\b(error|err|e)\s*\??\.\s*message\b/;

function scan() {
  const perFile = {};
  const sites = [];
  for (const file of walk(PUBLIC)) {
    const rel = file.slice(PUBLIC.length + 1).replace(/\\/g, "/");
    const src = readFileSync(file, "utf8");
    for (const call of showToastCalls(src)) {
      if (!RAW.test(call.text)) continue;
      perFile[rel] = (perFile[rel] ?? 0) + 1;
      sites.push(`${rel}:${call.line}`);
    }
  }
  return { perFile, sites };
}

describe("servertekst vises ikke rått i en toast", () => {
  it("ingen fil har flere rå bruk enn baselinen", () => {
    const { perFile, sites } = scan();

    // ⚠️ KONTROLLASSERTION. Endres filstruktur eller navnet på showToast, ville vakta ellers blitt
    // grønn ved å måle NULL. Den fella har allerede gitt oss en falsk «47 av 47 er lokalisert».
    expect(sites.length, "fant ingen showToast-kall i det hele tatt — leter vakta riktig sted?")
      .toBeGreaterThan(0);

    const problems = [];
    for (const [file, count] of Object.entries(perFile)) {
      const allowed = BASELINE[file] ?? 0;
      if (count > allowed) {
        problems.push(
          `${file}: ${count} rå bruk, baseline er ${allowed}.`
          + ` Send feilen gjennom describeImportError (eller en tilsvarende oversetter) i stedet.`,
        );
      }
    }
    for (const [file, allowed] of Object.entries(BASELINE)) {
      const count = perFile[file] ?? 0;
      if (count < allowed) {
        problems.push(`${file}: ${count} rå bruk igjen — sett baselinen ned fra ${allowed}. Bra jobba.`);
      }
    }

    expect(problems, `\n${problems.join("\n")}\n\nKjente steder:\n${sites.join("\n")}`).toEqual([]);
  });

  it("baselinen peker bare på filer som finnes", () => {
    const { perFile } = scan();
    // En baseline-oppføring for en fil som er borte ser ut som gjeld noen holder styr på, men
    // dekker ingenting — og skjuler at tallet aldri blir gjort opp.
    const stale = Object.keys(BASELINE).filter((f) => !(f in perFile));
    expect(stale, `Baseline peker på filer uten rå bruk:\n${stale.join("\n")}`).toEqual([]);
  });
});
