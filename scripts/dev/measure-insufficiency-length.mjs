import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #1048: MÅL om regelen faktisk skiller de to sakene den skal skille.
//
// ⚠️ HVA SOM SKAL MÅLES. Modellen sier ofte to ting samtidig: «det er for lite grunnlag her» OG «et
// menneske bør se på dette». Før #1048 hørte vi bare det første, og saken ble automatisk strøket.
// Nå krever automatisk stryk et MÅLBART faktum: at svaret er vesentlig kortere enn forventet.
//
// ⚠️ DERFOR ER KONTROLLPARET SELVE MÅLINGEN, ikke pynt rundt den.
//
//   KORT + tynt  → skal fortsatt strykes automatisk (COMPLETED). Uten denne kan vi ikke skille
//                  «regelen virker» fra «regelen slo av auto-stryk helt».
//   LANG + tynt  → skal nå gå til et menneske (UNDER_REVIEW). Dette er populasjonen saken finnes
//                  for: de 21 av 78 på stage som ba om en sensor og ikke fikk en.
//
// Går BEGGE samme vei, måler vi ingenting — da er utfallet styrt av noe annet enn lengden.
//
// ⚠️ LENGDEN MÅ LIGGE PÅ HVER SIDE AV TERSKELEN, ELLERS ER SAKENE IKKE ET PAR. Modulen må ha et
// nivå i skalaen (basic=100 ord → terskel 50). Skriptet SJEKKER nivået før det leverer, og nekter
// å kjøre på en modul der forventningen ikke finnes — da ville alt gått til menneske uansett, og
// en grønn måling ville betydd null.
//
// ⚠️ INGEN FRITEKST SKRIVES TIL DISK. Rapporten teller strukturerte verdier, som i #1025.
//
// Bruk:
//   npm run stage:auth
//   node scripts/dev/measure-insufficiency-length.mjs [--per-case=2]

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const AUTH_FILE = path.join(ROOT, ".stage-auth.json");
if (!fs.existsSync(AUTH_FILE)) {
  console.log("Ingen .stage-auth.json — kjør `npm run stage:auth` først.");
  process.exit(1);
}
const auth = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
const BASE = auth.baseUrl ?? "https://a2-assessment-platform-stg-app-x6eyx4.azurewebsites.net";
const locale = (process.argv.find((a) => a.startsWith("--locale=")) ?? "--locale=nb").split("=")[1];
const perCase = Number((process.argv.find((a) => a.startsWith("--per-case=")) ?? "--per-case=2").split("=")[1]);
const H = {
  Authorization: `Bearer ${auth.accessToken}`,
  "Content-Type": "application/json",
  "x-locale": locale,
};

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

const tellOrd = (t) => (t ?? "").trim().split(/\s+/).filter(Boolean).length;
const sov = (ms) => new Promise((r) => setTimeout(r, ms));

// ⚠️ TERSKELEN ER 0.5 × nivåets minimum (autoFailBelowScopeRatio). basic=100 → 50 ord.
// Sakene under ligger med vilje godt på hver sin side, ikke like ved streken: en måling som
// avhenger av at ordtellingen treffer på ordet er ikke en måling, den er en tilfeldighet.
const SAKER = [
  {
    id: "kort_tynt",
    hensikt: "KONTROLL: under terskelen — skal fortsatt strykes automatisk",
    venter: "COMPLETED",
    response: "Jeg ville brukt KI til å lage rapporten automatisk.",
    reflection: "Det sparer tid.",
  },
  {
    id: "lang_tynt",
    hensikt: "MÅLINGEN: over terskelen, men tynt — skal nå gå til et menneske",
    venter: "UNDER_REVIEW",
    response:
      "Jeg tenker at kunstig intelligens kan brukes til mange ulike ting i arbeidshverdagen min, og " +
      "at det er viktig å bruke det på en fornuftig måte. Det er mange muligheter her, og jeg tror " +
      "at de fleste vil se nytten av det etter hvert som de blir kjent med verktøyene. Samtidig er " +
      "det viktig å være bevisst på at teknologien har begrensninger, og at man ikke kan stole blindt " +
      "på alt som kommer ut av den. Jeg mener derfor at en god tilnærming handler om å finne en " +
      "balanse mellom å utnytte mulighetene og å beholde en kritisk holdning til resultatene. Dette " +
      "vil jeg ta med meg videre i arbeidet mitt, og jeg tror det vil gi god effekt over tid.",
    reflection:
      "Jeg har tenkt en del på dette, og jeg mener at det er en fornuftig måte å gjøre det på. Det " +
      "er nok mye mer å lære her, og jeg vil fortsette å utforske det framover i egen praksis.",
  },
  {
    id: "kontroll_godt",
    hensikt: "KONTROLL: konkret og belagt — skal verken utløse insufficiency eller sensor",
    venter: "COMPLETED",
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
];

// ── Velg modul, og KREV at forventningen finnes ────────────────────────────────────────────────
const moduler = await api("GET", "/api/modules?includeCompleted=true");
const liste = moduler?.modules ?? moduler?.items ?? (Array.isArray(moduler) ? moduler : []);
const kandidater = liste.filter((m) => (m.assessmentMode ?? "").includes("FREETEXT"));
if (!kandidater.length) {
  console.log("Fant ingen fritekstmodul å levere til.");
  process.exit(1);
}

// ⚠️ Deltakerruta bærer ikke nivået — det gjør bibliotekruta. Uten dette oppslaget kunne skriptet
// levert til en modul UTEN forventning, og da går alt til menneske uansett hva regelen gjør.
const bibliotek = await api("GET", "/api/admin/content/modules/library");
const nivåer = new Map((bibliotek?.modules ?? []).map((m) => [m.id, m.certificationLevel]));
const MÅLBARE = { basic: 100, intermediate: 250, advanced: 400 };

const modul = kandidater.find((m) => MÅLBARE[nivåer.get(m.id)]);
if (!modul) {
  console.log("STOPP: ingen fritekstmodul har et nivå i skalaen (basic/intermediate/advanced).");
  console.log("Uten en forventet lengde finnes ikke faktumet regelen måler, og alt ville gått til");
  console.log("menneske uansett. En grønn måling ville da betydd null. Nivåer sett:");
  for (const m of kandidater) console.log(`  ${m.id}: ${nivåer.get(m.id) ?? "(ingen)"}`);
  process.exit(1);
}
const nivå = nivåer.get(modul.id);
const terskel = MÅLBARE[nivå] * 0.5;
console.log(`Modul: ${modul.id} · nivå ${nivå} · minimum ${MÅLBARE[nivå]} ord · terskel ${terskel} ord`);
console.log("");
for (const s of SAKER) {
  const ord = tellOrd(s.response) + tellOrd(s.reflection);
  const side = ord < terskel ? "UNDER terskel" : "OVER terskel";
  console.log(`  ${s.id.padEnd(16)} ${String(ord).padStart(3)} ord  ${side.padEnd(13)} venter ${s.venter}`);
}
// ⚠️ Er ikke sakene på hver sin side, er de ikke et par, og målingen kan ikke si noe.
const sider = new Set(SAKER.map((s) => tellOrd(s.response) + tellOrd(s.reflection) < terskel));
if (sider.size < 2) {
  console.log("");
  console.log("STOPP: alle sakene ligger på SAMME side av terskelen. Da måler kjøringen ikke lengden.");
  process.exit(1);
}
console.log("");

async function leverMedTålmodighet(kropp, merkelapp) {
  for (let forsøk = 1; forsøk <= 5; forsøk++) {
    const svar = await api("POST", "/api/submissions", kropp);
    if (!svar?._feil) return svar;
    if (svar._feil === 429) {
      let vent = 60;
      try {
        vent = JSON.parse(svar._tekst.replace(/\.\.\.$/, "")).details?.retryAfterSeconds ?? 60;
      } catch {}
      console.log(`  ${merkelapp}: ratebegrenset, venter ${vent}s (forsøk ${forsøk}/5)`);
      await sov((vent + 2) * 1000);
      continue;
    }
    return svar;
  }
  return { _feil: 429, _tekst: "ga opp etter fem forsøk" };
}

const rapport = [];

for (const sak of SAKER) {
  for (let i = 0; i < perCase; i++) {
    const merkelapp = `${sak.id} #${i + 1}`;
    const svar = await leverMedTålmodighet(
      {
        moduleId: modul.id,
        deliveryType: "text",
        responseJson: { response: sak.response, reflection: sak.reflection },
        processSignals: { declaration: "improve", declarationText: "Modellen ble brukt som utkastverktøy." },
      },
      merkelapp,
    );
    if (svar?._feil) {
      console.log(`  ${merkelapp}: kunne ikke leveres (${svar._feil}) ${svar._tekst}`);
      continue;
    }
    // ⚠️ ID-en hentes rett etter HVER innlevering. Å pare to lister på indeks til slutt gir feil
    // etikett så snart én feiler, og en forskyvning ser ut som et faglig funn.
    const h = await api("GET", "/api/submissions/history?limit=5");
    const nyeste = (h?.history ?? [])[0];
    console.log(`  ${merkelapp}: levert (${nyeste?.submissionId ?? "id ikke funnet"})`);
    rapport.push({
      caseId: sak.id,
      venter: sak.venter,
      hensikt: sak.hensikt,
      ord: tellOrd(sak.response) + tellOrd(sak.reflection),
      submissionId: nyeste?.submissionId ?? null,
    });
    await sov(7000);
  }
}

console.log("");
console.log(`${rapport.length} innleveringer sendt. Starter vurderingene…`);
console.log("");

// ⚠️ EN INNLEVERING STARTER IKKE VURDERINGEN. Det gjør POST /api/assessments/:id/run, som
// deltakerkonsollet kaller som et eget steg. Ruta er ratebegrenset for seg.
let startetAntall = 0;
for (const r of rapport.filter((x) => x.submissionId)) {
  for (let forsøk = 1; forsøk <= 4; forsøk++) {
    const res = await fetch(`${BASE}/api/assessments/${r.submissionId}/run`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    if (res.ok || res.status === 202) {
      startetAntall++;
      break;
    }
    const tekst = (await res.text()).slice(0, 140);
    if (res.status === 429) {
      let vent = 30;
      try {
        vent = JSON.parse(tekst).details?.retryAfterSeconds ?? 30;
      } catch {}
      console.log(`  ${r.caseId}: kjøring ratebegrenset, venter ${vent}s`);
      await sov((vent + 2) * 1000);
      continue;
    }
    console.log(`  ${r.caseId}: kunne ikke startes (${res.status}) ${tekst}`);
    break;
  }
  await sov(3000);
}
console.log(`${startetAntall} av ${rapport.length} vurderinger lagt i kø.`);
console.log("");

// ── Vent på resultatene og still dem opp mot forventningen ─────────────────────────────────────
const venteslutt = Date.now() + 15 * 60 * 1000;
let ferdige = [];
const forventet = rapport.filter((x) => x.submissionId).length;
while (Date.now() < venteslutt) {
  await sov(20000);
  const h = await api("GET", "/api/submissions/history?limit=50");
  const nye = (h?.history ?? []).filter((r) => rapport.some((x) => x.submissionId === r.submissionId));
  ferdige = nye.filter((r) => r.status !== "SUBMITTED" && r.status !== "PROCESSING");
  const tell = new Map();
  for (const r of nye) tell.set(r.status, (tell.get(r.status) ?? 0) + 1);
  console.log(`  ${new Date().toISOString().slice(11, 19)} ${[...tell].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  if (ferdige.length >= forventet) break;
}

console.log("");
console.log("RESULTAT");
console.log("");
let riktig = 0;
let feil = 0;
const rader = [];
for (const r of rapport.filter((x) => x.submissionId)) {
  const f = ferdige.find((x) => x.submissionId === r.submissionId);
  const res = await api("GET", `/api/submissions/${r.submissionId}/result`);
  const g = res?.participantGuidance ?? res?.guidance ?? {};
  const md = g.decisionMetadata ?? {};
  const fikk = f?.status ?? "(ikke ferdig)";
  const ok = fikk === r.venter;
  if (ok) riktig++;
  else feil++;
  rader.push({
    sak: r.caseId,
    ord: r.ord,
    venter: r.venter,
    fikk,
    ok,
    sufficiency: md.evidenceSufficiency ?? null,
    anbefalt: md.recommendedOutcome ?? null,
    grunn: md.manualReviewReasonCode ?? null,
  });
  await sov(1500);
}

for (const r of rader) {
  console.log(
    `  ${r.ok ? "OK   " : "AVVIK"} ${r.sak.padEnd(16)} ${String(r.ord).padStart(3)} ord  ` +
      `venter ${r.venter.padEnd(13)} fikk ${String(r.fikk).padEnd(13)} ` +
      `sufficiency=${r.sufficiency} anbefalt=${r.anbefalt} grunn=${r.grunn}`,
  );
}
console.log("");
console.log(`${riktig} som forventet, ${feil} avvik.`);

// ⚠️ ET GRØNT TALL ER IKKE NOK. Er kontrollen og målingen enige, styrer noe ANNET enn lengden.
const kort = rader.filter((r) => r.sak === "kort_tynt").map((r) => r.fikk);
const lang = rader.filter((r) => r.sak === "lang_tynt").map((r) => r.fikk);
console.log("");
if (kort.length && lang.length && new Set([...kort, ...lang]).size === 1) {
  console.log("⚠️ ADVARSEL: kort og lang endte likt. Da måler ikke kjøringen lengderegelen,");
  console.log("   uansett hvor mange rader som står som OK.");
} else if (kort.length && lang.length) {
  console.log(`Kontrollparet spriker som det skal: kort → ${kort.join(",")}, lang → ${lang.join(",")}.`);
}
