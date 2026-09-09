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

// SAKENE. Skrevet mot modulens FAKTISKE oppgavetekst, som krever mål, kilder, steg, output og
// kontrollpunkt, forklart for en ikke-teknisk prosjekteier.
//
// ⚠️ FØRSTE RUNDE HADDE INGEN VIRKENDE KONTROLL. Sakene handlet om KI-bruk generelt og ble levert
// til denne modulen, så ingen av dem traff oppgaven: alle tjue fikk `evidence_sufficiency:
// insufficient`, også den «tydelig gode». Da måler man bare én hjørne av inngangsrommet, og et
// fravær av utslag kan like gjerne bety at instrumentet ikke virker.
//
// Derfor et KONTROLLPAR: én besvarelse som dekker alle fem kravene og bør gi `sufficient`, og én
// som åpenbart ikke gjør det og bør gi `insufficient`. Spriker de to, virker målingen. Gjør de det
// ikke, sier tallene fra de tvetydige sakene ingenting.
const SAKER = [
  {
    id: "kontroll_oppad_komplett",
    hensikt: "dekker alle fem kravene — skal gi sufficient",
    response:
      "Mål: at prosjekteier får en statusrapport hver fredag uten at jeg bruker en halv dag på den. " +
      "Kilder: oppgavelista i Jira, referatene fra ukemøtet, og budsjettarket. " +
      "Steg: 1) hent alle oppgaver som endret status siste uke, 2) hent beslutninger fra siste referat, " +
      "3) sammenstill avvik mellom plan og faktisk framdrift, 4) skriv et utkast på én side. " +
      "Output: et utkast med tre faste avsnitt — framdrift, risiko, og hva jeg trenger svar på. " +
      "Kontrollpunkt: jeg leser gjennom utkastet før det sendes, og flyten stopper og spør meg hvis " +
      "et tall avviker mer enn ti prosent fra forrige uke. Ingenting går ut uten at jeg har godkjent det.",
    reflection:
      "Jeg prøvde først uten stoppunktet, og da foreslo den en risiko som ikke fantes i kildene. " +
      "Etter at jeg la inn kontrollen fant jeg to slike før de nådde rapporten.",
  },
  {
    id: "kontroll_nedad_tom",
    hensikt: "åpenbart utilstrekkelig — skal gi insufficient",
    response: "Jeg ville laget en flyt som lager statusrapporten automatisk.",
    reflection: "Det ville spart tid.",
  },
  {
    id: "tvetydig_mangler_kontrollpunkt",
    hensikt: "fire av fem krav er godt dekket, kontrollpunktet mangler helt",
    response:
      "Mål: automatisk oppdatert risikobilde før hvert styringsmøte. " +
      "Kilder: risikoregisteret, avviksmeldingene fra siste måned og leverandørens statusbrev. " +
      "Steg: 1) hent nye avvik, 2) koble hvert avvik til en eksisterende risiko eller opprett en ny, " +
      "3) oppdater sannsynlighet og konsekvens, 4) lag en kort oppsummering av hva som har endret seg. " +
      "Output: oppdatert risikoregister og et sammendrag på ti linjer til styringsmøtet.",
    reflection:
      "Jeg tror dette ville fungert bra. Jeg har ikke tenkt så mye på hva som skjer hvis den kobler " +
      "et avvik til feil risiko.",
  },
  {
    id: "tvetydig_paastaatt_kontroll",
    hensikt: "sier at det finnes et kontrollpunkt, men beskriver ikke noe",
    response:
      "Mål: følge opp aksjoner etter prosjektmøtet. Kilder: møtereferatet og aksjonslista. " +
      "Steg: les referatet, finn nye aksjoner, legg dem i lista med frist og ansvarlig, og send påminnelse. " +
      "Output: oppdatert aksjonsliste og en påminnelse til hver ansvarlig. " +
      "Kontrollpunkt: kvaliteten sikres underveis, og det er lagt inn kontroll i flyten.",
    reflection: "Kontrollen er viktig, så den er med.",
  },
  {
    id: "tvetydig_teknisk_register",
    hensikt: "faglig komplett, men bryter kravet om å forklare for en ikke-teknisk eier",
    response:
      "Orkestrering via en scheduler som trigger en DAG hver fredag 0600. Node 1 poller Jira REST v3 " +
      "med JQL på updated >= -7d, node 2 embedder referatene og gjør top-k retrieval mot en vektorindeks, " +
      "node 3 kjører en LLM-kall med structured output mot et JSON-skjema, node 4 validerer mot skjemaet " +
      "og ruter til en human-in-the-loop-kø ved schema-avvik eller lav confidence. Idempotens sikres med " +
      "en hash av inputsettet.",
    reflection:
      "Arkitekturen er robust. Jeg har ikke skrevet om det til et språk prosjekteier bruker.",
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
    // ⚠️ ID-EN HENTES RETT ETTER HVER INNLEVERING, ikke ved å pare to lister til slutt.
    //
    // Første utgave leverte alt og paret så historikken mot rapporten på INDEKS. Én innlevering
    // feilet, og da fikk alle etter hullet feil etikett: den tomme besvarelsen sto som «sufficient»
    // og den grundige som «insufficient». En forskyvning ser ut som et faglig funn, og det er verre
    // enn ingen etikett.
    const h = await api("GET", "/api/submissions/history?limit=5");
    const nyeste = (h?.history ?? [])[0];
    console.log(`  ${merkelapp}: levert (${nyeste?.submissionId ?? "id ikke funnet"})`);
    rapport.push({ caseId: sak.id, hensikt: sak.hensikt, submissionId: nyeste?.submissionId ?? null });
    await sov(7000);
  }
}

console.log(`
${rapport.length} innleveringer sendt.
`);

// ⚠️ Koblingen sak→innlevering. Uten den kan vi telle FORDELINGER, men ikke si om KONTROLLSAKENE
// oppførte seg som kontroller — og en forskjøvet etikett ser ut som et faglig funn.
//
// Fila ligger utenfor repoet: den peker på innleveringer, og slike id-er hører ikke hjemme i et
// offentlig repo, heller ikke for testdata.
const kartsti = process.env.MEASURE_MAP ?? "";
if (kartsti) {
  fs.writeFileSync(kartsti, JSON.stringify(
    rapport.filter((r) => r.submissionId).map((r) => ({ submissionId: r.submissionId, caseId: r.caseId })), null, 2));
  console.log(`  kobling sak→innlevering skrevet til ${kartsti}`);
}

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
