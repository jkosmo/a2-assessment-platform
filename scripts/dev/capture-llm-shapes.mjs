import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #1025: henter FORMEN på ekte LLM-svar fra stage, uten innholdet.
//
// ⚠️ HVORFOR DENNE FINNES.
//
// Testfiksturene våre er skrevet ut fra hva jeg TROR språkmodellen svarer. 2026-08-27 viste det seg
// å være feil på en måte ingen test kunne fanget: #1019 lot `evidence_sufficiency: "insufficient"`
// bety «lav konfidens», mens modellen i nettopp de tilfellene skriver «Det er høy sikkerhet i
// vurderingen på grunn av svarets svært begrensede innhold». Alle testene var grønne, fordi de
// målte mot min egen antakelse.
//
// ⚠️ INGEN FRITEKST LAGRES. Fiksturet havner i et OFFENTLIG repo. Besvarelser, begrunnelser og råd
// erstattes med lengde og språk; av konfidensnotatet beholdes bare hvilke NØKKELORD fra en fast
// liste som forekom. Det som lagres skal ikke kunne føres tilbake til en person.
//
// Bruk:
//   npm run stage:auth      (én gang, ~80 minutters gyldighet)
//   node scripts/dev/capture-llm-shapes.mjs

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "src/scripts/llmResponseShapes.generated.json");

const AUTH_FILE = path.join(ROOT, ".stage-auth.json");
if (!fs.existsSync(AUTH_FILE)) {
  console.log("Ingen .stage-auth.json — kjør `npm run stage:auth` først.");
  process.exit(1);
}
const auth = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
const BASE = auth.baseUrl ?? "https://a2-assessment-platform-stg-app-x6eyx4.azurewebsites.net";
const H = { Authorization: `Bearer ${auth.accessToken}` };

async function get(url) {
  const res = await fetch(BASE + url, { headers: H });
  // ⚠️ Høyt, ikke stille. Et utløpt token som gir 401 ville ellers sett ut som «ingen data funnet»,
  // og fiksturet ville blitt skrevet tomt.
  if (res.status === 401 || res.status === 403) {
    throw new Error(`AUTH ${res.status} på ${url} — tokenet er utløpt. Kjør: npm run stage:auth`);
  }
  return res.ok ? res.json() : null;
}

// Nøkkelordene vi ser etter i konfidensnotatet. En FAST liste: vi lagrer hvilke som forekom, aldri
// setningen. Norsk og engelsk, fordi modellen svarer på begge.
const CONFIDENCE_KEYWORDS = [
  "high confidence", "medium confidence", "low confidence",
  "høy sikkerhet", "lav sikkerhet", "usikker", "uncertain", "not certain",
  "sparse", "limited", "partial evidence", "begrenset", "lite innhold",
];

const textShape = (value) => {
  const text = typeof value === "string" ? value : "";
  return { length: text.length, words: text.trim() ? text.trim().split(/\s+/).length : 0 };
};

const { version } = await get("/version");
console.log(`Henter fra stage ${version}\n`);

const hist = await get("/api/submissions/history?limit=100");
const rows = hist?.history ?? [];

const shapes = [];
for (const r of rows) {
  const id = r.submissionId ?? r.id;
  const result = await get(`/api/submissions/${id}/result`);
  const g = result?.participantGuidance;
  // Bare vurderinger med en LLM-evaluering er interessante her.
  if (!g?.decisionMetadata && !g?.confidenceNote) continue;

  const note = String(g.confidenceNote ?? "").toLowerCase();
  shapes.push({
    // ⚠️ Ingen innleverings-id heller. Den peker på en person i vår egen database.
    assessmentMode: result.assessmentMode ?? null,
    status: result.status,
    passFailTotal: result.decision?.passFailTotal ?? null,
    evidenceSufficiency: g.decisionMetadata?.evidenceSufficiency ?? null,
    recommendedOutcome: g.decisionMetadata?.recommendedOutcome ?? null,
    manualReviewReasonCode: g.decisionMetadata?.manualReviewReasonCode ?? null,
    decisionReasonCode: g.decisionReasonCode ?? null,
    confidenceLevel: g.confidenceLevel ?? null,
    confidenceKeywords: CONFIDENCE_KEYWORDS.filter((k) => note.includes(k)),
    confidenceNoteShape: textShape(g.confidenceNote),
    improvementAdviceCount: Array.isArray(g.improvementAdvice) ? g.improvementAdvice.length : 0,
    criterionRationaleCount: g.criterionRationales ? Object.keys(g.criterionRationales).length : 0,
    scoreComponents: {
      totalScore: result.scoreComponents?.totalScore ?? null,
      mcqPercentScore: result.scoreComponents?.mcqPercentScore ?? null,
    },
  });
}

const tally = (key) => {
  const counts = new Map();
  for (const s of shapes) {
    const v = String(s[key] ?? "(ikke satt)");
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]));
};

const payload = {
  // ⚠️ Et ØYEBLIKKSBILDE. Bytter vi modell, er dette utdatert — og et utdatert fikstur er en ny
  // kilde til falsk trygghet. Stemplet er derfor ikke pynt.
  capturedAt: new Date().toISOString(),
  capturedFrom: `stage ${version}`,
  // ⚠️ MODELLNAVNET, ikke bare appversjonen. Modellen kan byttes uten at appen bumpes, og da er
  // fiksturet utdatert uten at noe i stempelet røper det. Settes fra miljøet der skriptet kjøres;
  // «(ukjent)» er et ærlig svar, ikke en antakelse.
  capturedModel: process.env.LLM_MODEL ?? process.env.AZURE_OPENAI_DEPLOYMENT ?? "(ukjent — sett LLM_MODEL)",
  sampleSize: shapes.length,
  distributions: {
    evidenceSufficiency: tally("evidenceSufficiency"),
    manualReviewReasonCode: tally("manualReviewReasonCode"),
    recommendedOutcome: tally("recommendedOutcome"),
    confidenceLevel: tally("confidenceLevel"),
    decisionReasonCode: tally("decisionReasonCode"),
  },
  shapes,
};

fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`${shapes.length} vurderinger med LLM-evaluering\n`);
for (const [name, dist] of Object.entries(payload.distributions)) {
  console.log(`  ${name}: ${JSON.stringify(dist)}`);
}
console.log(`\nSkrevet til ${path.relative(ROOT, OUT)}`);

// Motsigelsen som avslørte #1019 — verdt å se hver gang dette kjøres.
const contradictions = shapes.filter(
  (s) => s.evidenceSufficiency === "insufficient" && s.confidenceKeywords.some((k) => k.includes("høy") || k.includes("high")),
);
if (contradictions.length > 0) {
  console.log(
    `\n⚠️  ${contradictions.length} av ${shapes.length}: utilstrekkelig grunnlag OG høy sikkerhet i samme svar.`,
  );
  console.log("    Det er ikke en motsigelse — det er to ulike spørsmål. Se #1019.");
}
