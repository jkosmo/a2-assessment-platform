import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #1023: MÅL om den strukturerte konfidensutløseren i det hele tatt fyrer.
//
// ⚠️ HVORFOR DENNE FINNES. `evaluateSecondaryAssessmentTrigger` bestemmer om en besvarelse får en
// ANDRE uavhengig vurdering. Den utløses av to ting:
//
//   strukturert:   manual_review_reason_code === "low_confidence"
//   delstreng:     confidence_note inneholder "medium confidence" eller "low confidence"
//
// Delstrengene er ENGELSKE, og etter #1024 skriver modellen konfidensnotatet på deltakerens språk.
// For norske deltakere kan de derfor ikke matche — de kjører allerede på den strukturerte alene.
//
// Det eksisterende fiksturet (`llmResponseShapes.generated.json`, 27. august, n=10) viser
// `low_confidence` i 0 av 10 og utledet konfidensnivå «ikke satt» i 10 av 10. Men i alle ti var
// modellen FAKTISK sikker — ingen av dem skulle utløst noe. Med det utvalget kan vi ikke skille
// «mekanismen er død» fra «det fantes ingen saker å fyre på».
//
// ⚠️ DERFOR ER SAKENE HER BEVISST TVETYDIGE. En besvarelse som er på tema, men vag, delvis belagt
// eller selvmotsigende, er der en modell rimeligvis KAN bli usikker. Er `low_confidence` fortsatt
// null over dem, er det et svar; er det ikke null, er det også et svar.
//
// ⚠️ INGEN FRITEKST SKRIVES TIL DISK. Rapporten teller strukturerte verdier, som i #1025.
//
// Bruk:
//   npm run stage:auth
//   node scripts/dev/measure-secondary-trigger.mjs [--per-case=2]

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const AUTH_FILE = path.join(ROOT, ".stage-auth.json");
if (!fs.existsSync(AUTH_FILE)) {
  console.log("Ingen .stage-auth.json — kjør `npm run stage:auth` først.");
  process.exit(1);
}
const auth = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
const BASE = auth.baseUrl ?? "https://a2-assessment-platform-stg-app-x6eyx4.azurewebsites.net";
// ⚠️ VURDERINGSSPRÅKET FØLGER `x-locale`, ikke besvarelsens tekst. Første kjøring leverte norske
// besvarelser uten headeren, fikk `en-GB` som standard, og målte dermed den ENGELSKE veien — mens
// hele spørsmålet i #1023 er hva som skjer på den norske. Uten dette valget måler skriptet feil sak.
const locale = (process.argv.find((a) => a.startsWith("--locale=")) ?? "--locale=en-GB").split("=")[1];
const H = {
  Authorization: `Bearer ${auth.accessToken}`,
  "Content-Type": "application/json",
  "x-locale": locale,
};

const perCase = Number((process.argv.find((a) => a.startsWith("--per-case=")) ?? "--per-case=2").split("=")[1]);

async function api(metode, sti, kropp) {
  const res = await fetch(BASE + sti, {
    method: metode,
    headers: H,
    ...(kropp ? { body: JSON.stringify(kropp) } : {}),
  });
  // ⚠️ Høyt, ikke stille. Et utløpt token som gir 401 ville ellers sett ut som «ingen data».
  if (res.status === 401 || res.status === 403) {
    throw new Error(`AUTH ${res.status} på ${sti} — tokenet er utløpt. Kjør: npm run stage:auth`);
  }
  if (!res.ok) return { _feil: res.status, _tekst: (await res.text()).slice(0, 200) };
  return res.json();
}

// Sakene. Den første er en kontroll: en tydelig god besvarelse skal IKKE gjøre modellen usikker.
// Uten den vet vi ikke om et fravær av treff betyr «aldri usikker» eller «alltid usikker».
const SAKER = [
  {
    id: "kontroll_tydelig_god",
    hensikt: "kontrollcase — modellen skal være sikker",
    response:
      "Jeg brukte språkmodellen til å omarbeide en workshop-agenda. Første utkast inneholdt tre punkter som ikke sto i notatene mine, så jeg strammet ledeteksten til å bare bruke vedlagte beslutninger. Andre utkast var korrekt, og jeg sammenlignet det punkt for punkt mot referatet før jeg sendte det.",
    reflection:
      "Den viktigste endringen var å begrense modellen til kildematerialet. Jeg loggførte begge utkastene og hva jeg endret mellom dem, slik at en kollega kan etterprøve vurderingen.",
  },
  {
    id: "tvetydig_delvis_belagt",
    hensikt: "på tema, men bare halve påstanden er belagt",
    response:
      "Jeg brukte modellen til å lage et utkast, og det ble ganske bra. Jeg sjekket det etterpå. Noen av forslagene brukte jeg, andre ikke. Kvaliteten var nok bedre enn om jeg skrev det selv, men jeg har ikke målt det.",
    reflection:
      "Jeg tror prosessen ble raskere. Jeg har ikke tall på det, og jeg husker ikke nøyaktig hva jeg endret.",
  },
  {
    id: "tvetydig_selvmotsigende",
    hensikt: "sier både at den kontrollerte og at den ikke gjorde det",
    response:
      "Jeg kontrollerte alle påstandene mot kildene. Det var for mange til å gå gjennom alt, så jeg stolte på modellen for de fleste. Resultatet ble sendt videre uten flere endringer.",
    reflection:
      "Jeg mener kvalitetssikringen var god nok, selv om jeg ikke rakk å gå gjennom hele teksten.",
  },
  {
    id: "tvetydig_kort_men_konkret",
    hensikt: "kort nok til å ligne «utilstrekkelig», men inneholder et konkret bevis",
    response:
      "Jeg ba modellen om et sammendrag, og den fant én feil i tallgrunnlaget som jeg rettet: summen i tabell 3 var 240 mot fakturaens 204.",
    reflection: "Feilen ville jeg trolig ikke oppdaget selv.",
  },
];

const rapport = [];
const startet = new Date().toISOString();

const moduler = await api("GET", "/api/modules?includeCompleted=true");
const liste = moduler?.modules ?? moduler?.items ?? (Array.isArray(moduler) ? moduler : []);
const modul = liste.find((m) => (m.assessmentMode ?? "").includes("FREETEXT")) ?? liste[0];
if (!modul) {
  console.log("Fant ingen modul å levere til. Svar:", JSON.stringify(moduler).slice(0, 300));
  process.exit(1);
}
console.log(`Modul: ${modul.id} · modus ${modul.assessmentMode ?? "(ukjent)"}\n`);

const sov = (ms) => new Promise((r) => setTimeout(r, ms));

// ⚠️ Innleveringsruta er RATEBEGRENSET (429 med `retryAfterSeconds`). Et første forsøk fyrte av
// tolv rett etter hverandre og fikk avvist de to siste. En måling som stille mister prøver er
// verre enn ingen måling, så vi venter den tiden serveren selv oppgir og prøver igjen.
async function leverMedTålmodighet(kropp, merkelapp) {
  for (let forsøk = 1; forsøk <= 5; forsøk++) {
    const svar = await api("POST", "/api/submissions", kropp);
    if (!svar?._feil) return svar;
    if (svar._feil === 429) {
      let vent = 60;
      try { vent = JSON.parse(svar._tekst.replace(/\.\.\.$/, "")).details?.retryAfterSeconds ?? 60; } catch {}
      console.log(`  ${merkelapp}: ratebegrenset, venter ${vent}s (forsøk ${forsøk}/5)`);
      await sov((vent + 2) * 1000);
      continue;
    }
    return svar;
  }
  return { _feil: 429, _tekst: "ga opp etter fem forsøk" };
}

for (const sak of SAKER) {
  for (let i = 0; i < perCase; i++) {
    const merkelapp = `${sak.id} #${i + 1}`;
    const svar = await leverMedTålmodighet({
      moduleId: modul.id,
      deliveryType: "text",
      responseJson: { response: sak.response, reflection: sak.reflection },
      // ⚠️ Gyldige verdier er none | ideas | improve | autonomous. «assisted» finnes ikke, og ga 400.
      processSignals: { declaration: "improve", declarationText: "Modellen ble brukt som utkastverktøy." },
    }, merkelapp);
    if (svar?._feil) {
      console.log(`  ${merkelapp}: kunne ikke leveres (${svar._feil}) ${svar._tekst}`);
      continue;
    }
    console.log(`  ${merkelapp}: levert`);
    rapport.push({ caseId: sak.id, hensikt: sak.hensikt, submissionId: null });
    await sov(7000);
  }
}

console.log(`
${rapport.length} innleveringer sendt. Henter id-ene fra historikken…
`);

// ⚠️ POST /api/submissions returnerer IKKE id-en. Første utgave leste `svar.submissionId ?? svar.id`
// — begge `undefined` — og pollet `/api/submissions/undefined/result` i tjue minutter uten å si fra.
// Historikken er kilden, og den er allerede veien `capture-llm-shapes.mjs` bruker.
const historikk = await api("GET", "/api/submissions/history?limit=100");
const mine = (historikk?.history ?? [])
  .filter((r) => new Date(r.submittedAt) >= new Date(startet))
  .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
console.log(`  fant ${mine.length} av ${rapport.length} i historikken`);
if (mine.length !== rapport.length) {
  console.log("  ⚠️ Avvik mellom sendte og gjenfunne. Tallene under gjelder de gjenfunne.");
}
// Rekkefølgen er den vi leverte i, så saks-merkelappen følger med.
mine.forEach((r, i) => { if (rapport[i]) rapport[i].submissionId = r.submissionId; });

console.log(`
Starter vurderingene…
`);

// ⚠️ EN INNLEVERING STARTER IKKE VURDERINGEN. Det gjør `POST /api/assessments/:id/run`, som
// deltakerkonsollet kaller som et eget steg. Første kjøring leverte tolv besvarelser og ventet i
// tjue minutter på resultater som aldri kunne komme — workerens kølogg sto på `pendingJobs: 0`
// hele tiden, fordi det ikke fantes en jobb å hente. Det så ut som en død worker.
//
// Ruta er ratebegrenset for seg (`assessmentRunLimiter`), uavhengig av innleveringsgrensen.
let startetAntall = 0;
for (const r of rapport.filter((x) => x.submissionId)) {
  for (let forsøk = 1; forsøk <= 4; forsøk++) {
    const res = await fetch(`${BASE}/api/assessments/${r.submissionId}/run`, {
      method: "POST", headers: H, body: "{}",
    });
    if (res.ok || res.status === 202) { startetAntall++; break; }
    const tekst = (await res.text()).slice(0, 140);
    if (res.status === 429) {
      let vent = 30;
      try { vent = JSON.parse(tekst).details?.retryAfterSeconds ?? 30; } catch {}
      console.log(`  ${r.caseId}: kjøring ratebegrenset, venter ${vent}s`);
      await sov((vent + 2) * 1000);
      continue;
    }
    console.log(`  ${r.caseId}: kunne ikke startes (${res.status}) ${tekst}`);
    break;
  }
  await sov(3000);
}
console.log(`${startetAntall} av ${rapport.length} vurderinger lagt i kø.
`);

// ⚠️ LESINGEN ER FLYTTET UT. Denne fila pollet tidligere `svar.submissionId ?? svar.id` fra
// POST-svaret; begge er `undefined`, så den spurte etter `/api/submissions/undefined/result`.
// Identiteten hentes nå fra HISTORIKKEN, som er veien `capture-llm-shapes.mjs` allerede bruker.
console.log("Les resultatene med:");
console.log(`  node scripts/dev/read-secondary-trigger.mjs --since=${startet}`);
