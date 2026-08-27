import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// #940: resultatskjermen, inspisert visuelt og MÅLT — i den EKTE deltakersiden.
//
// Produkteier 2026-08-26: «Når vi lager UI-elementer så bør de visuelt inspiseres som en del av
// kvalitetskontroll.»
//
// ⚠️ DENNE FILA ER SKREVET OM, OG GRUNNEN ER VIKTIGERE ENN INNHOLDET.
//
// Første utgave BYGDE KORTET PÅ NYTT: den importerte reglene fra result-summary.js, men gjenskapte
// radene, etikettene og verdiene selv. Den løy to ganger:
//
//   1. Statusraden viste råverdien «COMPLETED» der produktet viser «Ferdig». Jeg satte inn en
//      vakt — men bare for statusraden, altså akkurat den ene som hadde feilet.
//   2. Nøkkelen `result.submissionId` ble senere døpt om. Skriptet slo opp det gamle navnet og
//      skrev «RESULT.SUBMISSIONID» i alle 24 kortene, mens det meldte «Ingen avvik målt».
//
// Et kvalitetsverktøy som viser noe annet enn produktet er verre enn ingen kontroll: det gir en
// falsk kvittering. Og en lapp på det som gikk galt sist er ikke en vakt — den neste divergensen
// oppstår et annet sted.
//
// Løsningen er ikke flere vakter. Den er å ikke ha en kopi å divergere fra: siden lastes nå som den
// er, med participant.js, mockede API-svar og ekte språkfiler. Det som måles, er det deltakeren ser.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, ".ai-qa");
fs.mkdirSync(OUT, { recursive: true });

const PORT = 4189;
const BASE = `http://127.0.0.1:${PORT}`;

const CASES = [
  {
    name: "bestatt-ren-flervalg",
    result: {
      submissionId: "cmt1wuwvq0013qqfi4tk4vsxu",
      status: "COMPLETED",
      assessmentMode: "MCQ_ONLY",
      decision: { passFailTotal: true, decisionType: "AUTOMATIC" },
      scoreComponents: { totalScore: 30, mcqScaledScore: 30, mcqPercentScore: 100, practicalScaledScore: 0 },
      requirement: { mcqMinPercent: 80, totalMin: null, practicalMinPercent: null },
      participantGuidance: {
        decisionReason: "Automatic pass: MCQ score 100% meets the required minimum of 80%.",
        decisionReasonCode: "MCQ_ONLY_PASS",
        decisionReasonParams: { scorePercent: 100, minPercent: 80 },
        confidenceNote: null,
      },
    },
  },
  {
    name: "ikke-bestatt-med-brok",
    result: {
      submissionId: "cmt1wuwvq0013qqfi4tk4vsxu",
      status: "COMPLETED",
      assessmentMode: "MCQ_ONLY",
      decision: { passFailTotal: false, decisionType: "AUTOMATIC" },
      scoreComponents: { totalScore: 18, mcqScaledScore: 18, mcqPercentScore: 66.66666, practicalScaledScore: 0 },
      requirement: { mcqMinPercent: 80, totalMin: null, practicalMinPercent: null },
      participantGuidance: {
        decisionReason: "Automatic fail: MCQ score 66.67% is below the required minimum of 80%.",
        decisionReasonCode: "MCQ_ONLY_FAIL",
        decisionReasonParams: { scorePercent: 66.67, minPercent: 80 },
        confidenceNote: null,
      },
    },
  },
  {
    name: "til-manuell-vurdering",
    result: {
      submissionId: "cmt1wuwvq0013qqfi4tk4vsxu",
      status: "UNDER_REVIEW",
      assessmentMode: "MCQ_ONLY",
      decision: { passFailTotal: false, decisionType: "AUTOMATIC" },
      scoreComponents: { totalScore: 64, mcqScaledScore: 64, mcqPercentScore: 64, practicalScaledScore: 0 },
      requirement: { mcqMinPercent: 80, totalMin: 70, practicalMinPercent: null },
      participantGuidance: {
        decisionReason: "Routed to manual review: total score 64 is in the borderline window [60, 70].",
        decisionReasonCode: "MANUAL_REVIEW_BORDERLINE",
        decisionReasonParams: { totalScore: 64, min: 60, max: 70 },
        confidenceNote: "Low confidence due to sparse content; assessment is based on partial evidence.",
      },
    },
  },
  {
    name: "behandles-fortsatt",
    result: {
      submissionId: "cmt1wuwvq0013qqfi4tk4vsxu",
      status: "PROCESSING",
      assessmentMode: "MCQ_ONLY",
      decision: null,
      scoreComponents: { totalScore: null, mcqScaledScore: null, mcqPercentScore: null, practicalScaledScore: null },
      requirement: { mcqMinPercent: 80, totalMin: null, practicalMinPercent: null },
      participantGuidance: { decisionReason: null, decisionReasonCode: null, decisionReasonParams: {}, confidenceNote: null },
    },
  },
];

const WIDTHS = [
  { label: "desktop", width: 1100, height: 1400 },
  { label: "mobil", width: 390, height: 1800 },
];

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function mockParticipant(page, result) {
  await page.route("**/participant/config", (r) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { participant: { userId: "p-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
    calibrationWorkspace: { accessRoles: [] },
    flow: { autoStartAfterMcq: false },
    output: {},
  })));
  await page.route("**/version", (r) => r.fulfill(json({ version: "inspeksjon" })));
  await page.route("**/api/me", (r) => r.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (r) => r.fulfill(json({ counts: {} })));
  await page.route("**/api/modules**", (r) => r.fulfill(json({
    modules: [{
      id: "m-mcq", title: "Modul", description: null, assessmentMode: "MCQ_ONLY",
      submissionSchema: null, assessmentPolicy: null, taskText: null,
      activeVersion: { versionNo: 1 }, participantStatus: null,
    }],
  })));
  await page.route("**/api/submissions", (r) => r.fulfill({ ...json({ submission: { id: "s1" } }), status: 201 }));
  await page.route("**/api/modules/*/mcq/start**", (r) => r.fulfill(json({
    attemptId: "a1", questions: [{ id: "q1", stem: "Spørsmål", options: ["A", "B"] }],
  })));
  await page.route("**/api/modules/*/mcq/submit", (r) => r.fulfill(json({ assessmentComplete: true })));
  await page.route("**/api/submissions/*/result", (r) => r.fulfill(json(result)));
}

const server = spawn(process.execPath, [path.join(ROOT, "scripts/test/admin-content-static-server.mjs")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
process.on("exit", () => server.kill());

// Vent til serveren svarer, i stedet for å sove et tall vi har gjettet på.
let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
  try {
    const res = await fetch(`${BASE}/static/participant.js`);
    up = res.ok;
  } catch { /* ikke oppe ennå */ }
  if (!up) await new Promise((r) => setTimeout(r, 250));
}
if (!up) {
  console.log("Fikk ikke opp den statiske serveren — avbryter.");
  server.kill();
  process.exit(1);
}

const browser = await chromium.launch();
let problems = 0;

for (const locale of ["nb", "nn", "en-GB"]) {
  for (const size of WIDTHS) {
    for (const testCase of CASES) {
      const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
      // ⚠️ Sidefeil er også et avvik. Uten dette kunne kortet vært tomt fordi noe kastet, og
      // skjermdumpen ville bare vist et tomt felt.
      const pageErrors = [];
      page.on("pageerror", (err) => pageErrors.push(String(err.message)));

      await page.addInitScript((loc) => {
        try { localStorage.setItem("participant.locale", loc); } catch { /* uten lagring: standardspråk */ }
      }, locale);
      await mockParticipant(page, testCase.result);

      await page.goto(`${BASE}/participant`, { waitUntil: "domcontentloaded" });
      await page.locator("#loadModules").click();
      await page.locator(".module-card").first().click();
      await page.locator("input[name='q_q1']").first().check();
      await page.locator("#submitMcq").click();
      await page.locator("#resultSummary .result-headline").waitFor({ timeout: 15000 });

      // Detaljene åpnes, ellers inspiserer vi bare halve kortet.
      const summary = page.locator("#resultSummary .result-details summary");
      if (await summary.count()) await summary.click();

      const slug = `${locale}-${size.label}-${testCase.name}`;
      const file = path.join(OUT, `resultat-${slug}.png`);
      await page.locator("#assessmentSection").screenshot({ path: file });

      const measured = await page.evaluate(() => {
        const card = document.querySelector("#resultSummary .summary-card");
        if (!card) return { missing: true };
        const section = document.getElementById("assessmentSection");
        const values = [...card.querySelectorAll(".summary-value")];
        const headline = card.querySelector(".result-headline");
        const text = (el) => (el?.textContent ?? "").trim();
        const leaves = [...card.querySelectorAll("*")].filter((el) => el.childElementCount === 0);
        return {
          headline: text(headline),
          overflow: Math.round(Math.max(0, card.getBoundingClientRect().right - section.getBoundingClientRect().right)),
          // ⚠️ Rå nøkkeltekst er den feilen verktøyet selv gjorde to ganger. Nå letes den i det
          // deltakeren faktisk ser, ikke i en kopi.
          rawKeys: leaves.map(text).filter((t) => /^(result|assessment|submission|mcq)\.[a-zA-Z.]+$/.test(t)).slice(0, 3),
          dashes: values.filter((el) => text(el) === "-").map((el) => text(el.previousElementSibling)),
          placeholders: leaves.some((el) => /\{\w+\}/.test(text(el))),
          clipped: values.some((el) => el.scrollHeight - el.clientHeight > 1),
        };
      });

      const bad = [];
      if (measured.missing) bad.push("kortet ble ikke rendret");
      if (pageErrors.length) bad.push(`sidefeil: ${pageErrors[0]}`);
      if (measured.overflow > 0) bad.push(`flyter ${measured.overflow}px ut`);
      if (measured.rawKeys?.length) bad.push(`rå nøkkeltekst: ${measured.rawKeys.join(" | ")}`);
      if (measured.dashes?.length) bad.push(`strek-rader: ${measured.dashes.join(", ")}`);
      if (measured.placeholders) bad.push("plassholder {…} står igjen");
      if (measured.clipped) bad.push("tekst er klippet");
      if (!measured.headline) bad.push("overskriften er tom");

      if (bad.length) {
        problems += 1;
        console.log(`  x ${slug}: ${bad.join(", ")}`);
      } else {
        console.log(`  ${slug}: ${measured.headline.replace(/\s+/g, " ").slice(0, 90)}`);
      }

      await page.close();
    }
  }
}

await browser.close();
server.kill();
console.log(problems === 0 ? "\nIngen avvik målt." : `\n${problems} avvik målt.`);
process.exit(problems === 0 ? 0 : 1);
