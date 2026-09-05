import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #1023, lesedelen: hent resultatene for innleveringer gjort etter et tidspunkt, og tell de
// STRUKTURERTE verdiene som avgjør om en andre vurdering utløses.
//
// ⚠️ IDENTITETEN HENTES FRA HISTORIKKEN, ikke fra POST-svaret. Et første forsøk leste
// `svar.submissionId ?? svar.id` fra innleveringssvaret; begge var `undefined`, og pollingen spurte
// etter `/api/submissions/undefined/result` i tjue minutter uten å si fra. Historikken er dessuten
// veien `capture-llm-shapes.mjs` allerede bruker — én mekanisme, ikke to.
//
// ⚠️ INGEN FRITEKST SKRIVES TIL DISK.
//
// Bruk:  node scripts/dev/read-secondary-trigger.mjs --since=2026-09-05T10:44:00Z [--vent=25]

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const auth = JSON.parse(fs.readFileSync(path.join(ROOT, ".stage-auth.json"), "utf8"));
const BASE = auth.baseUrl ?? "https://a2-assessment-platform-stg-app-x6eyx4.azurewebsites.net";
const H = { Authorization: `Bearer ${auth.accessToken}` };

const arg = (navn, standard) =>
  (process.argv.find((a) => a.startsWith(`--${navn}=`)) ?? `--${navn}=${standard}`).split("=").slice(1).join("=");
const since = new Date(arg("since", new Date(Date.now() - 3600e3).toISOString()));
const ventMinutter = Number(arg("vent", "25"));

async function get(sti) {
  const res = await fetch(BASE + sti, { headers: H });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`AUTH ${res.status} på ${sti} — tokenet er utløpt. Kjør: npm run stage:auth`);
  }
  return res.ok ? res.json() : null;
}

const sov = (ms) => new Promise((r) => setTimeout(r, ms));

const hentNye = async () => {
  const h = await get("/api/submissions/history?limit=100");
  return (h?.history ?? []).filter((r) => new Date(r.submittedAt) >= since);
};

let nye = await hentNye();
console.log(`${nye.length} innleveringer etter ${since.toISOString()}\n`);
if (nye.length === 0) {
  console.log("Ingen å lese. Er --since riktig?");
  process.exit(1);
}

const frist = Date.now() + ventMinutter * 60 * 1000;
let ferdige = [];
while (Date.now() < frist) {
  nye = await hentNye();
  const status = new Map();
  for (const r of nye) status.set(r.status, (status.get(r.status) ?? 0) + 1);
  ferdige = nye.filter((r) => r.status !== "SUBMITTED" && r.status !== "PROCESSING");
  const linje = [...status.entries()].map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`  ${new Date().toISOString().slice(11, 19)}  ${linje}`);
  if (ferdige.length === nye.length) break;
  await sov(30000);
}

console.log(`\nVurdert: ${ferdige.length} av ${nye.length}\n`);
if (ferdige.length === 0) {
  console.log("INGEN ble vurdert. Se om workeren kjører — det er en annen feil enn en tom måling.");
  process.exit(1);
}

const rader = [];
for (const r of ferdige) {
  const res = await get(`/api/submissions/${r.submissionId}/result`);
  const g = res?.participantGuidance;
  if (!g) continue;
  const notat = String(g.confidenceNote ?? "").toLowerCase();
  rader.push({
    status: r.status,
    manualReviewReasonCode: g.decisionMetadata?.manualReviewReasonCode ?? null,
    evidenceSufficiency: g.decisionMetadata?.evidenceSufficiency ?? null,
    confidenceLevel: g.confidenceLevel ?? null,
    // Bare OM de engelske mønstrene ville truffet — aldri selve setningen.
    engelskeTraff: ["medium confidence", "low confidence"].filter((p) => notat.includes(p)),
    notatSpråk: /[æøå]/.test(notat) ? "norsk" : notat ? "engelsk?" : "(tomt)",
    notatLengde: notat.length,
  });
}

const tell = (v) => {
  const m = new Map();
  for (const x of v) m.set(String(x), (m.get(String(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log("=== SVARET PÅ #1023 ===\n");
for (const [felt, verdier] of [
  ["manual_review_reason_code", rader.map((r) => r.manualReviewReasonCode)],
  ["evidence_sufficiency", rader.map((r) => r.evidenceSufficiency)],
  ["utledet confidenceLevel", rader.map((r) => r.confidenceLevel)],
  ["konfidensnotatets språk", rader.map((r) => r.notatSpråk)],
]) {
  console.log(`${felt}:`);
  for (const [v, n] of tell(verdier)) console.log(`   ${v}: ${n}`);
  console.log();
}

const engelske = rader.filter((r) => r.engelskeTraff.length > 0).length;
const lav = rader.filter((r) => r.manualReviewReasonCode === "low_confidence").length;
console.log(`engelske delstrengmønstre traff: ${engelske} av ${rader.length}`);
console.log(`low_confidence:                  ${lav} av ${rader.length}\n`);

console.log("=== TOLKNING ===");
if (lav === 0 && engelske === 0) {
  console.log(`Ingen av ${rader.length} vurderinger utløste konfidensbasert andre vurdering —`);
  console.log("verken strukturert eller via delstreng, heller ikke de bevisst tvetydige sakene.");
  console.log("Utløseren er i praksis død, og #1023 handler om en mekanisme som ikke virker,");
  console.log("ikke om en reserve som må beskyttes.");
} else if (lav > 0) {
  console.log(`${lav} fikk low_confidence: den strukturerte utløseren FYRER, og delstreng-reserven`);
  console.log("kan fjernes uten å svekke kontrollen.");
} else {
  console.log(`${engelske} traff bare via engelsk delstreng. Da bærer reserven noe den strukturerte`);
  console.log("ikke gjør — og for norske deltakere er nettopp det tapt.");
}
