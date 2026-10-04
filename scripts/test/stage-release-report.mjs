// Kjører utgivelsestesten mot stage og lager ÉN side med resultatet og skjermbildene.
//
// Hvorfor: produkteier skal ikke klikke seg gjennom det en maskin kan måle. Testen
// (test/stage/release-2-78-x.spec.ts) kjører den ekte klienten mot de ekte dataene på stage og tar
// bilder underveis. Denne samler det til en side man kan SE over på et par minutter — det som blir
// igjen til et menneske, er det ingen måling kan svare på: hvordan det ser ut.
//
// Kjør:  npm run stage:auth        (logg inn; sesjonen varer rundt en time)
//        npm run test:stage:release
//
// Lokal prøvekjøring uten innlogging (appen i mock-modus):
//        STAGE_LOKAL=http://127.0.0.1:3001 npm run test:stage:release
//
// ⚠️ Rapporten inneholder skjermbilder av ekte innhold på stage. Den skrives til test-results/, som
// er gitignorert, og skal ikke committes.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
// Begge utgivelsestestene kjøres som standard. Gi én fil som argument for å kjøre bare den:
//   npm run test:stage:release -- test/stage/release-2-81-layouts.spec.ts
const SPEC = process.argv.slice(2).join(" ") || "test/stage/release-2-78-x.spec.ts test/stage/release-2-81-layouts.spec.ts";

fs.rmSync(RAPPORT, { recursive: true, force: true });
fs.mkdirSync(RAPPORT, { recursive: true });
const jsonFil = path.join(RAPPORT, "playwright.json");

const kjøring = spawnSync(`npx playwright test --config playwright.stage.config.ts ${SPEC} --reporter=list,json`, {
  shell: true,
  stdio: "inherit",
  env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFil },
});

// ── Les resultatet ─────────────────────────────────────────────────────────────────────────────

const esc = (tekst) => String(tekst).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const utenFarger = (tekst) => String(tekst ?? "").replace(/\x1b\[[0-9;]*m/g, "");

/** @type {Array<{ gruppe: string, navn: string, utfall: "bestått" | "feilet" | "hoppet over" | "ustabil", grunn: string }>} */
const tester = [];
if (fs.existsSync(jsonFil)) {
  const rapport = JSON.parse(fs.readFileSync(jsonFil, "utf8"));
  const gå = (suite, sti) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const siste = t.results?.at(-1);
        const utfall = t.status === "expected" ? "bestått" : t.status === "skipped" ? "hoppet over" : t.status === "flaky" ? "ustabil" : "feilet";
        // Playwrights egen feiltekst er skrevet for den som feilsøker testen. Her leses den av den som
        // skal avgjøre om noe er galt: påstanden som ikke holdt, og hva som ble målt.
        const feil = (siste?.errors ?? []).map((e) => {
          const linjer = utenFarger(e.message).split("\n").map((l) => l.trim()).filter(Boolean);
          const påstand = (linjer[0] ?? "").replace(/^Error:\s*/, "");
          const ventet = linjer.find((l) => l.startsWith("Expected"))?.replace(/^Expected:?\s*/, "");
          const fikk = linjer.find((l) => l.startsWith("Received"))?.replace(/^Received:?\s*/, "");
          return ventet !== undefined && fikk !== undefined ? `${påstand} — ventet ${ventet}, målt ${fikk}` : linjer.slice(0, 3).join(" ");
        }).join("\n");
        const hoppet = (t.annotations ?? []).find((a) => a.type === "skip")?.description ?? "";
        tester.push({ gruppe: sti.at(-1) ?? "", navn: spec.title, utfall, grunn: utfall === "feilet" || utfall === "ustabil" ? feil : hoppet });
      }
    }
    for (const under of suite.suites ?? []) gå(under, [...sti, under.title]);
  };
  for (const suite of rapport.suites ?? []) gå(suite, []);
}

const funnFil = path.join(RAPPORT, "funn.jsonl");
// Et nytt forsøk på en test noterer det samme en gang til. Hver linje vises én gang.
const funn = fs.existsSync(funnFil)
  ? [...new Set(fs.readFileSync(funnFil, "utf8").split("\n").filter(Boolean))].map((linje) => JSON.parse(linje))
  : [];
const bilder = fs.readdirSync(RAPPORT).filter((f) => f.endsWith(".png")).sort();
const bildeData = (fil) => `data:image/png;base64,${fs.readFileSync(path.join(RAPPORT, fil)).toString("base64")}`;

const antall = (utfall) => tester.filter((t) => t.utfall === utfall).length;
const lokal = Boolean(process.env.STAGE_LOKAL);
const ingenKjørt = tester.length === 0 || tester.every((t) => t.utfall === "hoppet over");

// ── Hva hvert bilde viser, og hva man skal se etter ────────────────────────────────────────────

const BILDETEKST = [
  [/^1083-figur-i-egen-fane/, "#1083 — figuren åpnet i en egen fane", "Tre bokser med «§ 12», «10 %» og «kr 500». Ingen feilside."],
  [/^1083-forhaandsvisning/, "#1083 — forhåndsvisningen i seksjonseditoren", "Figuren står i teksten, hel og lesbar."],
  [/^1080-doep-om/, "#1080 — «Døp om» på telefonbredde", "Skrivefeltet ligger inne i kortet og er bredt nok til å lese navnet."],
  [/^1080-(.+)-390/, "#1080 — lista på telefonbredde (390 px)", "Hver rad er et kort. Kolonnenavn til venstre, verdi til høyre. Se etter lange navn: brekkes de pent?"],
  [/^1081-(.+)-1280/, "#1081 — «Mer» åpnet i nederste rad, PC-bredde", "Alle valgene i menyen er synlige. Ingen er kuttet av rammekanten."],
  [/^1081-(.+)-390/, "#1081 — «Mer» åpnet i nederste kort, telefonbredde", "Alle valgene i menyen er synlige."],
  [/^894-/, "#894 — en testseksjon døpt om fra lista", "Raden viser det nye navnet."],
  [/^1079-forhaandsvisning-(\d+)/, "#1079 — figur i to oppsett, forhåndsvisningen i editoren, skjermbredde", "På 390 px: stegene står på to rader. På 1280 px: oppsettet som passer bredden forhåndsvisningen har."],
  [/^1079-deltaker-(\d+)/, "#1079 — figur i to oppsett, slik deltakeren ser den, skjermbredde", "På 1280 px: alle stegene på én rad. På 390 px: to rader, og etikettene er lesbare."],
  [/^pc-(.+)-1280/, "PC-bredde — lista slik den åpner seg, uten å rulle", "Er «Mer» helt til høyre synlig i hver rad, eller kuttet av rammekanten?"],
];
const bildetekst = (fil) => {
  for (const [mønster, tittel, seEtter] of BILDETEKST) {
    const treff = mønster.exec(fil);
    if (treff) return { tittel: treff[1] ? `${tittel} — ${treff[1]}` : tittel, seEtter };
  }
  return { tittel: fil, seEtter: "" };
};

// ── Siden ──────────────────────────────────────────────────────────────────────────────────────

const merke = { bestått: "ok", feilet: "feil", "hoppet over": "hoppet", ustabil: "feil" };
const grupper = [...new Set(tester.map((t) => t.gruppe))];
const konklusjon = ingenKjørt
  ? "Ingen tester ble kjørt. Sesjonen mangler eller er utløpt: kjør <code>npm run stage:auth</code> og så denne kommandoen på nytt."
  : antall("feilet") + antall("ustabil") === 0
    ? `Alle ${antall("bestått")} målingene besto${antall("hoppet over") ? `, ${antall("hoppet over")} ble hoppet over` : ""}. Se over bildene under.`
    : `${antall("feilet") + antall("ustabil")} av ${tester.length} målinger feilet. De står øverst i tabellen.`;

const html = `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stage-rapport</title>
<style>
  :root { --bg: #fff; --fg: #1c2330; --dempet: #5b6577; --kant: #d9dee7; --flate: #f5f7fa; --ok: #1f7a3d; --feil: #b3261e; --hoppet: #7a5a00; }
  @media (prefers-color-scheme: dark) { :root { --bg: #14181f; --fg: #e6e9ef; --dempet: #9aa4b5; --kant: #2c3442; --flate: #1b212b; --ok: #6fd08c; --feil: #ff8a80; --hoppet: #e2c15a; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  h2 { font-size: 1.15rem; margin: 40px 0 8px; }
  .dempet { color: var(--dempet); }
  .konklusjon { background: var(--flate); border: 1px solid var(--kant); border-radius: 8px; padding: 14px 16px; margin: 16px 0; font-size: 1.05rem; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--kant); }
  th { font-weight: 600; color: var(--dempet); font-size: .9rem; }
  .ok { color: var(--ok); font-weight: 600; } .feil { color: var(--feil); font-weight: 600; } .hoppet { color: var(--hoppet); font-weight: 600; }
  pre { white-space: pre-wrap; margin: 6px 0 0; font-size: .85rem; color: var(--dempet); }
  figure { margin: 24px 0; }
  figure img { max-width: 100%; height: auto; border: 1px solid var(--kant); border-radius: 6px; display: block; }
  figcaption { margin-bottom: 8px; }
  figcaption strong { display: block; }
  code { background: var(--flate); padding: 1px 5px; border-radius: 4px; }
  li { margin: 6px 0; }
</style>
</head>
<body>
<main>
<h1>Stage-rapport — utgivelsestestene</h1>
<p class="dempet">${lokal ? "LOKAL PRØVEKJØRING — ikke stage. " : ""}Kjørt ${new Date().toLocaleString("nb-NO")}. Den ekte klienten mot de ekte dataene, i Chromium.</p>
<div class="konklusjon">${konklusjon}</div>

<h2>Det som er målt</h2>
<table>
<thead><tr><th>Sak</th><th>Måling</th><th>Utfall</th></tr></thead>
<tbody>
${[...tester].sort((a, b) => (a.utfall === "feilet" ? -1 : 0) - (b.utfall === "feilet" ? -1 : 0)).map((t) => `<tr><td>${esc(t.gruppe.split(" — ")[0])}</td><td>${esc(t.navn)}${t.grunn ? `<pre>${esc(t.grunn)}</pre>` : ""}</td><td class="${merke[t.utfall]}">${t.utfall}</td></tr>`).join("\n")}
</tbody>
</table>
<p class="dempet">${grupper.length} saker, ${tester.length} målinger: ${antall("bestått")} bestått, ${antall("feilet") + antall("ustabil")} feilet, ${antall("hoppet over")} hoppet over.</p>

${funn.length ? `<h2>Det testen noterte underveis</h2>
<table>
<thead><tr><th>Sak</th><th>Hva</th><th>Verdi</th></tr></thead>
<tbody>
${funn.map((f) => `<tr><td>${esc(f.test)}</td><td>${esc(f.hva)}</td><td>${esc(f.verdi)}</td></tr>`).join("\n")}
</tbody>
</table>` : ""}

<h2>Det du må se på selv</h2>
<p>Målingene sier om noe er klippet, borte eller utenfor. De sier ikke om det ser riktig ut. Se over bildene: det tar et par minutter.</p>
${bilder.map((fil) => { const t = bildetekst(fil.replace(/\.png$/, "")); return `<figure><figcaption><strong>${esc(t.tittel)}</strong><span class="dempet">${esc(t.seEtter)}</span></figcaption><img src="${bildeData(fil)}" alt="${esc(t.tittel)}"></figure>`; }).join("\n")}

<h2>Det ingen måling her dekker</h2>
<ul>
  <li><strong>En ekte telefon.</strong> Alt er målt i Chromium på PC, med telefonbredde. Safari på iPhone kan oppføre seg annerledes. Har du en telefon for hånden: åpne modullista og se at radene er kort.</li>
  <li><strong>Hvordan animasjonen oppleves.</strong> Testen spør nettleseren om animasjonene i figuren: tre, én gang hver, etter tur. Om det ser bra ut, er en smakssak.</li>
  <li><strong>Figurer som alt lå lagret før 2.78.2.</strong> De er ikke reparert, og skriptet som finner dem er ikke kjørt.</li>
</ul>
</main>
</body>
</html>
`;

const ut = path.join(RAPPORT, "rapport.html");
fs.writeFileSync(ut, html, "utf8");
console.log(`\nRapport: ${ut}`);
console.log(ingenKjørt ? "Ingen tester ble kjørt — se rapporten." : `${antall("bestått")} bestått, ${antall("feilet") + antall("ustabil")} feilet, ${antall("hoppet over")} hoppet over.`);
process.exit(kjøring.status ?? 1);
