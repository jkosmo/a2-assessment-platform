import { test, expect, type Page, type Route } from "@playwright/test";

// #1027: resultatsiden hentet ikke rapportene på nytt ved språkbytte. Serveren baker inn språket
// når rapporten HENTES, så titlene ble stående på det forrige språket — engelsk side, norske
// titler, uten en eneste feilmelding.
//
// ⚠️ HVORFOR DENNE FILA FINNES. QA-porten mutasjonsbeviste at fiksen på denne flaten IKKE hadde
// noen test som kunne bli rød: den fjernet språksjekken i vakta, og enhet (1306), DOM (6) og e2e
// forble grønne. Ingen test i repoet åpnet `/results` overhodet. Påstanden «mutasjonsverifisert»
// i commit-meldingen var derfor usann for nettopp denne flaten.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const TITLES: Record<string, string> = { nb: "Hendelseshåndtering", "en-GB": "Incident response" };

function completionRows(locale: string) {
  return [{ moduleId: "m-1", moduleTitle: TITLES[locale] ?? TITLES["en-GB"], started: 3, completed: 2, passed: 2, failed: 0, underReview: 0, completionRate: 0.67 }];
}
function passRateRows(locale: string) {
  return [{ moduleId: "m-1", moduleTitle: TITLES[locale] ?? TITLES["en-GB"], attempts: 3, passes: 2, passRate: 0.67 }];
}

/** Serveren svarer etter x-locale, slik den ekte gjør. `delayFor` treger ETT språk med vilje. */
async function mockResultsWorkspace(page: Page, opts: { delayFor?: string; delayMs?: number } = {}) {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "en-GB"); } catch { /* standardspråk */ }
  });
  await page.route("**/participant/config", (r: Route) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { reportReader: { userId: "rep", email: "r@x.no", name: "Leser", roles: ["REPORT_READER"] } },
    calibrationWorkspace: { accessRoles: [] },
  })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (r: Route) => r.fulfill(json({
    user: { id: "rep", roles: ["REPORT_READER"] },
    consent: { accepted: true, currentVersion: "1.0" },
  })));
  await page.route("**/api/queue-counts", (r: Route) => r.fulfill(json({ counts: {} })));

  const respond = async (r: Route, body: unknown) => {
    const locale = r.request().headers()["x-locale"] ?? "en-GB";
    if (opts.delayFor && locale === opts.delayFor) {
      await new Promise((res) => setTimeout(res, opts.delayMs ?? 900));
    }
    return r.fulfill(json(body));
  };
  await page.route("**/api/reports/pass-rates**", (r: Route) =>
    respond(r, { rows: passRateRows(r.request().headers()["x-locale"] ?? "en-GB") }));
  await page.route("**/api/reports/completion**", (r: Route) =>
    respond(r, { rows: completionRows(r.request().headers()["x-locale"] ?? "en-GB") }));
  await page.route("**/api/reports/courses**", (r: Route) => r.fulfill(json({ rows: [] })));
  await page.route("**/api/reports/participants**", (r: Route) => r.fulfill(json({ rows: [] })));
  await page.route("**/api/reports/completion/details**", (r: Route) =>
    r.fulfill(json({ rows: [{ userId: "u-1", userName: "Kandidat", email: "k@x.no", moduleId: "m-1", status: "COMPLETED" }] })));
  await page.route("**/api/reports/courses/details**", (r: Route) => r.fulfill(json({ rows: [] })));
}

test.describe("#1027 — resultatsiden henter rapportene på nytt ved språkbytte", () => {

  // ⚠️ QA-runde 4: detaljlinja blandet språk etter bytte — «1 learners for Hendelseshåndtering».
  // Den valgte raden bar tittelen fra det øyeblikket den ble KLIKKET, og den fulgte ikke med når
  // rapporten ble hentet på nytt.
  //
  // Fikset i renderingen, ikke i de to stedene som skriver linja: en fiks hos leserne ville betydd
  // at neste leser av `selectedModuleRow.moduleTitle` arvet feilen på nytt.
  test("detaljlinja blander ikke språk etter et bytte", async ({ page }) => {
    await mockResultsWorkspace(page);
    await page.goto("/results");
    await page.click("#loadResults");
    await expect(page.locator("#completionBody")).toContainText("Incident response");

    await page.locator("#completionBody tr").first().click();
    await expect(page.locator("#moduleDetailMeta")).toContainText("Incident response");

    await page.selectOption("#localeSelect", "nb");

    await expect(page.locator("#moduleDetailMeta")).toContainText("Hendelseshåndtering");
    // Selve poenget: den ENGELSKE tittelen skal ikke stå igjen inne i den norske setningen.
    await expect(page.locator("#moduleDetailMeta")).not.toContainText("Incident response");
    await expect(page.locator("#moduleDetailMeta")).not.toContainText("learners");
  });
});
