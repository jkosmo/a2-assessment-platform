import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { mockCommonApis, localizedText, buildMockModuleExport, clickEnabledButton } from "./admin-content-helpers.js";

// #1119: skillets hint-kontroll på plattformen — varsel, ikke stopp. Her: at forfatteren faktisk ser
// varselet, på sitt språk, der hen er etterpå (en melding lagt i kø før et sidebytte vises på siden
// det byttes til).

const nb = async (page: Page) => page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
const bank = ["q1", "q2"].map((id) => ({ stem: localizedText(`Question ${id}`), options: [localizedText("A"), localizedText("B")], correctAnswer: localizedText("A"), rationale: localizedText("R") }));
const moduleExport = buildMockModuleExport({ id: "module-1", title: "Cases", moduleVersionId: "module-1-version-1", taskText: localizedText("Scenario"), mcqQuestions: bank });

test("KI-generering: hint-funnene og distraktorsjekken vises som tekst — ikke «[object Object]»", async ({ page }) => {
  await mockCommonApis(page, { modules: [{ id: "module-1", title: "Cases", activeVersion: { versionNo: 1 } }], moduleExports: { "module-1": moduleExport } });
  await page.route("**/api/admin/content/generate/mcq", (route: Route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      questions: [{ stem: "Hva anbefaler kurset?", options: ["X", "Y", "Z"], correctAnswer: "X", rationale: "Fordi" }],
      validation: { valid: false, issues: [{ severity: "blocking", code: "MCQ_DISTRACTOR_HIGH_ELIMINATION_RISK", message: "Question 1: one or more options can be eliminated without domain reasoning (eliminationRisk: high)." }] },
      cueWarnings: [{ code: "stem_about_course", question: 1 }],
    }),
  }));
  await nb(page);
  await page.goto("/admin-content/module/module-1/conversation");
  await expect(page.locator("[data-preview-edit-question]")).toHaveCount(2);
  await clickEnabledButton(page, /^Generate questions$|^Generer spørsmål$/);
  await page.locator("#dialogGenerate .chat-textarea").fill("Kundemøter.");
  await page.locator("#dialogGenerate .chat-submit-btn").click();

  const note = page.locator(".toast__message", { hasText: "Spørsmål 1 spør hva kurset sier" }).last();
  await expect(note).toBeVisible({ timeout: 15000 });
  await expect(note).toContainText("eliminationRisk: high");
  await expect(page.locator(".toast__message", { hasText: "[object Object]" })).toHaveCount(0);
});

async function save(page: Page, cueWarnings: unknown[], stem: string) {
  await mockCommonApis(page, { modules: [{ id: "module-1", title: "Cases", activeVersion: { versionNo: 1 } }], moduleExports: { "module-1": moduleExport } });
  await page.route("**/api/admin/content/modules/*/versions", (route: Route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 }, cueWarnings }) }));
  await nb(page);
  await page.goto("/admin-content/module/module-1/conversation");
  await page.locator("#previewEditMcqStem0").fill(stem);
  await page.locator("#formSaveBtn").click();
}

test("lagring med funn: lagret, og kvitteringen er et varsel med funnene", async ({ page }) => {
  await save(page, [{ code: "stem_about_course", question: 1 }], "Hva anbefaler kurset?");
  await expect(page.locator(".toast--warning .toast__message").last()).toContainText("Utkastet er lagret som en ny modulversjon. Noen spørsmål kan besvares uten å kunne stoffet:");
  await expect(page.locator(".toast--warning .toast__detail").last()).toContainText("Spørsmål 1 spør hva kurset sier");
});

test("lagring uten funn: en vanlig kvittering", async ({ page }) => {
  await save(page, [], "Hva gjør du først?");
  // Kvitteringen fra lagringsloggen og fra lagringen har samme tekst, og toast.js viser den én gang.
  await expect(page.locator(".toast__message", { hasText: "Utkastet er lagret som en ny modulversjon." }).first()).toBeVisible();
  await expect(page.locator(".toast__message", { hasText: "kan besvares uten å kunne stoffet" })).toHaveCount(0);
});

test.describe("import", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommonApis(page, {
      courses: [{ id: "course-1", title: "Rapportskriving", description: null, certificationLevel: "basic", moduleCount: 1, updatedAt: "2026-10-11T12:00:00.000Z", publishedAt: null, archivedAt: null, modules: [] }],
      libraryModules: [{ id: "module-1", title: "Cases", status: "published" }],
      modules: [{ id: "module-1", title: "Cases", activeVersion: { versionNo: 1 } }],
      moduleExports: { "module-1": moduleExport },
    });
    await nb(page);
  });

  const kurspakke = {
    exportFormat: "a2-content-export/v1", exportedAt: "2026-10-26T08:00:00.000Z", exportedBy: null, exportedByEmail: null, scope: "course",
    course: { course: { title: { nb: "Nytt kurs" }, description: null, certificationLevel: null, audit: { publishedAt: null, publishedBy: null, publishedByEmail: null, sourceVersionNo: null }, items: [] } },
  };

  test("kursimport med funn: meldingen på kurssiden er et varsel som nevner testen og funnet", async ({ page }) => {
    await page.route("**/api/admin/content/courses/import", (route: Route) => route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ courseId: "course-1", moduleIds: ["module-1"], heldBackByTranslationGate: false, cueWarnings: [{ title: { nb: "Kunnskapstest", "en-GB": "Knowledge test" }, warnings: [{ code: "absolute_words", question: null, count: 4 }] }] }),
    }));
    await page.goto("/admin-content/courses");
    await page.setInputFiles("#importCoursePackageFile", { name: "kurs.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(kurspakke)) });
    await expect(page).toHaveURL(/\/admin-content\/courses\/course-1$/);
    await expect(page.locator(".toast--warning .toast__detail")).toContainText("1 tester har spørsmål som kan besvares uten å kunne stoffet. Kunnskapstest: 4 gale alternativer");
  });

  test("kursimport uten funn: en vanlig kvittering, uten detalj", async ({ page }) => {
    await page.route("**/api/admin/content/courses/import", (route: Route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ courseId: "course-1", moduleIds: [], heldBackByTranslationGate: false, cueWarnings: [] }) }));
    await page.goto("/admin-content/courses");
    await page.setInputFiles("#importCoursePackageFile", { name: "kurs.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(kurspakke)) });
    await expect(page).toHaveURL(/\/admin-content\/courses\/course-1$/);
    await expect(page.locator(".toast--success .toast__message")).toBeVisible();
    await expect(page.locator(".toast__detail")).toHaveCount(0);
  });

  test("modulimport: kvitteringen og funnene vises på modulsiden importen går til", async ({ page }) => {
    await page.route("**/api/admin/content/modules/import", (route: Route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ moduleId: "module-1", cueWarnings: [{ code: "stem_about_course", question: 2 }] }) }));
    await page.goto("/admin-content");
    await expect(page.locator(".list-table")).toBeVisible();
    const modulpakke = { exportFormat: "a2-content-export/v1", exportedAt: "2026-10-26T08:00:00.000Z", scope: "module", module: { module: { title: { nb: "M" } } } };
    await page.setInputFiles("#importModulePackageFile", { name: "modul.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(modulpakke)) });
    await expect(page).toHaveURL(/\/admin-content\/module\/module-1\/conversation$/);
    await expect(page.locator(".toast--warning .toast__detail")).toContainText("Spørsmål 2 spør hva kurset sier");
  });
});
