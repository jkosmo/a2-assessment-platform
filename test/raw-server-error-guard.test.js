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
//
// ⚠️ TO SKANNINGER, TO BASELINER (utvidet under #972). Den opprinnelige vakta så bare
// `showToast(...)`. Da #972 ble ryddet viste det seg at nøyaktig de samme feilene sto i
// tomtilstander, feilbannere og chat-loggen — `innerHTML`, `textContent`, `log()`, `setError()` —
// og de er like synlige for brukeren som en toast. Den brede skanningen under teller derfor HVER
// linje som rører `err.message` utenfor de delte oversetterne, uansett hvor den havner.
//
// ⚠️ Tallene i de to skanningene er IKKE sammenlignbare med hverandre, og den brede er ikke
// sammenlignbar med noe fra før 2026-08-23 — den finnes ikke lenger tilbake enn det.
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC = fileURLToPath(new URL("../public", import.meta.url));

// Fil -> antall kjente rå bruk i en toast. Arbeidslista for #972; hver linje som forsvinner herfra
// er en flate som har fått lesbar feiltekst.
const TOAST_BASELINE = {
  // #988: nede fra 3. Den ene som står igjen er oversetterens EGEN fallback — den viser en
  // allerede oversatt melding (f.eks. «Spørsmål 4 mangler svar»), og skal være der.
  "participant.js": 1,
};
// 1 til sammen, per 2026-08-23. Var 33 fordelt på 8 filer før #972 ble ryddet; de sju
// forfatterkonsoll-filene (admin-content-*, discussion-panel) er nå på null og skal bli der.

// De delte oversetterne MÅ røre `error.message` — det er jobben deres. Vendorkode er ikke vår.
const EXEMPT = [
  "static/api-error.js", // #972: den ene felles oversetteren
  "static/import-error.js", // #937: importens egen ordlyd, delegerer resten til api-error.js
  "static/vendor/",
];

// Fil -> antall linjer som fortsatt rører `err.message` utenfor de delte oversetterne, uansett
// hvilken flate teksten havner på.
const RENDER_BASELINE = {
  // #1046: nede fra 2 til NULL. Flaten fikk aldri den delte oversetteren i #972/#983 — den var
  // et eldre lag. `String(err?.message ?? err)` viste serverens språk i et grensesnitt som
  // defaulter til brukerens.
  // #1042 tok den fra 3 til 2; #1046 tok den til NULL ved å gi flaten den delte oversetteren.
  // #983 er LØST for denne fila, og tallet er nede fra 18.
  //
  // ⚠️ Roten var at deltakerkonsollet hadde SIN EGEN feiloversetter, som bare kjente to nøkler og
  // aldri slo opp `errors.api.<kode>`. Den delte tabellen fantes hele tiden — konsollet spurte den
  // bare aldri, og var den eneste skjermen som ikke gjorde det.
  //
  // De fleste som står igjen er `log(error.message)`. `log()` oversetter selv, gjennom den samme
  // funksjonen som nå er koblet til den delte tabellen.
  //
  // ⚠️ Men ikke alle: 3738 (innerHTML) og 4248 (textContent) går IKKE gjennom `log()`. Min første
  // formulering her påsto at alle femten var trygge. Det var feil. De to er eksisterende gjeld.
  // #1046: nede fra 15 til 13. De to som forsvant var nettopp de som IKKE gikk gjennom `log()` —
  // en `innerHTML` og en `textContent` som viste `"<status>: <hele JSON-kroppen>"` rett i
  // grensesnittet. De 13 som står igjen ER `log()`-kall, og `log()` oversetter selv.
  "participant.js": 13,
  // #983: de tre søsterflatene brukte serverens engelske `message` rått, med hardkodede engelske
  // reserver som «Error». `profile.js` arvet i tillegg ikke feilkodetabellen i det hele tatt.
  // #1046: begge nede fra 2 til NULL. Reserven på profilsiden var dessuten hardkodet engelsk
  // («Error», «Error downloading data») i et grensesnitt som ellers er oversatt.
  // Kaster videre en lokal parse-feil; teksten er vår egen, ikke serverens.
  "static/admin-content-external-llm.js": 1,
};
// 37 til sammen, per 2026-08-23. Restene er #983 (deltaker/resultat/profil) og admin-platform.

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : entry.endsWith(".js") ? [full] : [];
  });
}

function relativeFiles() {
  return walk(PUBLIC).map((file) => ({
    rel: file.slice(PUBLIC.length + 1).replace(/\\/g, "/"),
    src: readFileSync(file, "utf8"),
  }));
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

function scanToasts() {
  const perFile = {};
  const sites = [];
  for (const { rel, src } of relativeFiles()) {
    for (const call of showToastCalls(src)) {
      if (!RAW.test(call.text)) continue;
      perFile[rel] = (perFile[rel] ?? 0) + 1;
      sites.push(`${rel}:${call.line}`);
    }
  }
  return { perFile, sites };
}

function scanRenders() {
  const perFile = {};
  const sites = [];
  for (const { rel, src } of relativeFiles()) {
    if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
    src.split("\n").forEach((line, index) => {
      // En kommentar som SITERER det gamle mønsteret er ikke en flate. Uten dette ville
      // «hvorfor»-kommentaren over hver fiks telt som gjelden den beskriver.
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      if (!RAW.test(line)) return;
      perFile[rel] = (perFile[rel] ?? 0) + 1;
      sites.push(`${rel}:${index + 1}`);
    });
  }
  return { perFile, sites };
}

// Sammenlikner en måling mot en baseline i BEGGE retninger. Delt mellom de to skanningene fordi
// en ratsj som bare håndheves ett sted er en ratsj noen glemmer å oppdatere.
function ratchetProblems(perFile, baseline, hint) {
  const problems = [];
  for (const [file, count] of Object.entries(perFile)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) problems.push(`${file}: ${count} rå bruk, baseline er ${allowed}. ${hint}`);
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    const count = perFile[file] ?? 0;
    if (count < allowed) {
      problems.push(`${file}: ${count} rå bruk igjen — sett baselinen ned fra ${allowed}. Bra jobba.`);
    }
  }
  return problems;
}

describe("servertekst vises ikke rått i en toast", () => {
  it("ingen fil har flere rå bruk enn baselinen", () => {
    const { perFile, sites } = scanToasts();

    // ⚠️ KONTROLLASSERTION. Endres filstruktur eller navnet på showToast, ville vakta ellers blitt
    // grønn ved å måle NULL. Den fella har allerede gitt oss en falsk «47 av 47 er lokalisert».
    expect(sites.length, "fant ingen showToast-kall i det hele tatt — leter vakta riktig sted?")
      .toBeGreaterThan(0);

    const problems = ratchetProblems(
      perFile,
      TOAST_BASELINE,
      "Send feilen gjennom describeApiError (api-error.js) i stedet.",
    );
    expect(problems, `\n${problems.join("\n")}\n\nKjente steder:\n${sites.join("\n")}`).toEqual([]);
  });

  it("baselinen peker bare på filer som finnes", () => {
    const { perFile } = scanToasts();
    // En baseline-oppføring for en fil som er borte ser ut som gjeld noen holder styr på, men
    // dekker ingenting — og skjuler at tallet aldri blir gjort opp.
    const stale = Object.keys(TOAST_BASELINE).filter((f) => !(f in perFile));
    expect(stale, `Baseline peker på filer uten rå bruk:\n${stale.join("\n")}`).toEqual([]);
  });
});

describe("servertekst vises ikke rått noe annet sted heller", () => {
  it("ingen fil har flere rå bruk enn den brede baselinen", () => {
    const { perFile, sites } = scanRenders();

    // Samme kontrollassertion som over: en tom måling skal ikke kunne se ut som suksess.
    expect(sites.length, "fant ingen rå bruk i det hele tatt — leter vakta riktig sted?")
      .toBeGreaterThan(0);

    const problems = ratchetProblems(
      perFile,
      RENDER_BASELINE,
      "Send feilen gjennom describeApiError (api-error.js) i stedet — også i tomtilstander,"
      + " feilbannere og log().",
    );
    expect(problems, `\n${problems.join("\n")}\n\nKjente steder:\n${sites.join("\n")}`).toEqual([]);
  });

  it("den brede baselinen peker bare på filer som finnes", () => {
    const { perFile } = scanRenders();
    const stale = Object.keys(RENDER_BASELINE).filter((f) => !(f in perFile));
    expect(stale, `Baseline peker på filer uten rå bruk:\n${stale.join("\n")}`).toEqual([]);
  });

  it("unntakslista dekker bare filer som faktisk finnes", () => {
    // ⚠️ Et unntak for en fil som er slettet eller flyttet er et hull ingen ser: vakta slutter å
    // dekke stien, og tallet ser like bra ut som før. Katalogunntak (`static/vendor/`) sjekkes som
    // prefiks mot de faktiske filene.
    const all = relativeFiles().map((f) => f.rel);
    const dead = EXEMPT.filter((prefix) => !all.some((rel) => rel.startsWith(prefix)));
    expect(dead, `Unntak uten filer:\n${dead.join("\n")}`).toEqual([]);
  });
});
