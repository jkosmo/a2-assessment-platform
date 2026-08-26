import { chromium } from "playwright";
import fs from "node:fs";

// #953: rendrer kortet og tar skjermbilde, så det kan INSPISERES før det sendes videre.
// Produkteier 2026-08-26: «Når vi lager UI-elementer så bør de visuelt inspiseres som en del av
// kvalitetskontroll.»

// Skjermbildene havner i .ai-qa/, som er gitignorert — de er arbeidsmateriale, ikke leveranse.
const OUT = ".ai-qa";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:4173";

const ROWS = [
  {
    jobId: "job-1", submissionId: "sub-1", attempts: 1, maxAttempts: 1,
    errorMessage: "fetch failed",
    failedAt: "2026-08-26T19:43:21.056Z", submissionStatus: "PROCESSING",
    submittedAt: "2026-08-26T19:40:00.000Z",
    participantName: "Joakim Kosmo", participantEmail: "joakim.kosmo@gmail.com",
    moduleId: "m1", moduleTitle: JSON.stringify({ "en-GB": "Module 3: Short KS2 case", nb: "Modul 3: Kort KS2-case", nn: "Modul 3: Kort KS2-case" }),
  },
  {
    // ⚠️ Med vilje en LANG feilmelding og et langt navn. Et kort som bare er testet med korte
    // verdier ser pent ut helt til virkeligheten kommer.
    jobId: "job-2", submissionId: "sub-2", attempts: 6, maxAttempts: 6,
    errorMessage: "AzureOpenAI request failed after 3 attempts: ETIMEDOUT connecting to a2-assessment-stg-openai-weu.openai.azure.com:443",
    failedAt: "2026-08-25T07:05:00.000Z", submissionStatus: "PROCESSING",
    submittedAt: "2026-08-25T07:00:00.000Z",
    participantName: "Anne-Marie Sørensen-Bakketun", participantEmail: "anne-marie.sorensen-bakketun@a-2.no",
    moduleId: "m2", moduleTitle: JSON.stringify({ "en-GB": "Risk, Control and Human Responsibility", nb: "Risiko, kontroll og menneskelig ansvar", nn: "Risiko, kontroll og menneskeleg ansvar" }),
  },
];

const browser = await chromium.launch();
for (const [locale, label] of [["nb", "nb"], ["en-GB", "en"]]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.route("**/participant/config", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      authMode: "mock", navigation: { items: [], workspaceItems: [] },
      identityDefaults: { contentAdmin: { userId: "admin-1", email: "admin@x.no", name: "Admin", roles: ["ADMINISTRATOR"] } },
      calibrationWorkspace: { accessRoles: [] },
    }),
  }));
  await page.route("**/version", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"version":"2.33.0"}' }));
  await page.route("**/api/me", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ user: { roles: ["ADMINISTRATOR"] }, consent: { accepted: true, currentVersion: "1.0" } }),
  }));
  await page.route("**/api/admin/platform", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ platformName: "A-2", consentBody: {}, certificateBackground: false }),
  }));
  await page.route("**/api/admin/platform/failed-assessments", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ total: ROWS.length, shown: ROWS.length, failedAssessments: ROWS }),
  }));

  await page.addInitScript((loc) => {
    try { localStorage.setItem("participant.locale", loc); } catch { /* ignorer */ }
  }, locale);

  await page.goto(`${BASE}/admin-platform`);
  await page.waitForSelector("#failedAssessmentsCard tbody tr");
  const card = page.locator("#failedAssessmentsCard");
  await card.screenshot({ path: `${OUT}/kort-${label}.png` });

  // Mål det jeg ellers ville gjettet på.
  const m = await card.evaluate((el) => {
    const th = [...el.querySelectorAll("th")];
    const td = [...el.querySelectorAll("tbody tr:first-child td")];
    const btn = el.querySelector("tbody button");
    const reason = el.querySelector("td.failed-reason");
    return {
      headerAlign: th.map((h) => getComputedStyle(h).textAlign),
      cellCount: td.length,
      headerCount: th.length,
      buttonRight: btn ? Math.round(btn.getBoundingClientRect().right) : null,
      cardRight: Math.round(el.getBoundingClientRect().right),
      reasonRight: reason ? Math.round(reason.getBoundingClientRect().right) : null,
      buttonLeft: btn ? Math.round(btn.getBoundingClientRect().left) : null,
      overflowX: el.scrollWidth > el.clientWidth,
    };
  });
  // ⚠️ Overskriften skrives ut som BEVIS på at språket faktisk skiftet. Første utgave satte feil
  // localStorage-nøkkel («locale» i stedet for «participant.locale»), så begge skjermbildene ble på
  // norsk mens skriptet meldte at to språk var sjekket. En måling som ikke måler er verre enn
  // ingen — den ser ut som dekning.
  const heading = (await card.locator("h2").textContent())?.trim();
  console.log(`\n[${label}] overskrift: «${heading}»`);
  console.log(`[${label}]`, JSON.stringify(m, null, 1));
  console.log(`  kolonner: ${m.headerCount} overskrifter, ${m.cellCount} celler ${m.headerCount === m.cellCount ? "OK" : "AVVIK"}`);
  console.log(`  overskrifter venstrejustert: ${m.headerAlign.every((a) => a === "left" || a === "start") ? "OK" : "NEI — " + m.headerAlign.join(",")}`);
  console.log(`  ingen vannrett rulling: ${m.overflowX ? "NEI" : "OK"}`);
  await page.close();
}
await browser.close();
console.log(`\nskjermbilder: ${OUT}/kort-nb.png og kort-en.png`);
