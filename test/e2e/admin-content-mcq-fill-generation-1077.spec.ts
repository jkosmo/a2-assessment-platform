import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { mockCommonApis, localizedText, buildMockModuleExport, clickEnabledButton } from "./admin-content-helpers.js";

// #1077 leveranse 3b: KI lager «fyll inn ordet som mangler» bare der kilden har et entydig ord, og sier fra
// når den ikke fant noe (produkteier 2026-10-31). Her: at forfatteren ser det — med grunnen — og at et
// generert «fyll inn» kommer inn i editoren som den typen, med de godkjente svarene.

const bank = ["q1", "q2"].map((id) => ({
  stem: localizedText(`Question ${id}`), options: [localizedText("A"), localizedText("B")], correctAnswer: localizedText("A"), rationale: localizedText("R"),
}));

async function generate(page: Page, reply: Record<string, unknown>) {
  const moduleExport = buildMockModuleExport({ id: "module-1", title: "Cases", moduleVersionId: "module-1-version-1", taskText: localizedText("Scenario"), mcqQuestions: bank });
  await mockCommonApis(page, { modules: [{ id: "module-1", title: "Cases", activeVersion: { versionNo: 1 } }], moduleExports: { "module-1": moduleExport } });
  await page.route("**/api/admin/content/generate/mcq", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ validation: { valid: true, issues: [] }, ...reply }) }));
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content/module/module-1/conversation");
  await expect(page.locator("[data-preview-edit-question]")).toHaveCount(2);
  await clickEnabledButton(page, /^Generate questions$|^Generer spørsmål$/);
  await page.locator("#dialogGenerate .chat-textarea").fill("Prinsippene for god forvaltning.");
  await page.locator("#dialogGenerate .chat-submit-btn").click();
}

test("ingen «fyll inn»: forfatteren får vite det, med grunnen fra KI", async ({ page }) => {
  await generate(page, {
    questions: [{ stem: "Ny stamme", options: ["X", "Y"], correctAnswer: "X", rationale: "Fordi" }],
    noFillReason: "Kilden har vurderinger, ikke begreper eller tall.",
  });
  const note = page.locator(".toast__message", { hasText: "Ingen «fyll inn ordet som mangler»" }).last();
  await expect(note).toBeVisible({ timeout: 15000 });
  await expect(note).toContainText("KI fant ikke noe begrep eller tall i kilden som bare ett ord kan fylle.");
  await expect(note).toContainText("Kilden har vurderinger, ikke begreper eller tall.");
});

test("ga genereringen et «fyll inn», kommer det inn som den typen, og det står ingen slik melding", async ({ page }) => {
  await generate(page, {
    questions: [{ questionType: "fill", stem: "Fristen for å klage er ___ uker.", options: ["tre", "3"], correctAnswer: "tre", rationale: "Forskriften sier tre uker." }],
  });
  await expect(page.locator("[data-preview-edit-question]")).toHaveCount(3, { timeout: 15000 });
  await expect(page.locator(".toast__message", { hasText: "Ingen «fyll inn ordet som mangler»" })).toHaveCount(0);
  await expect(page.locator('[data-preview-edit-fill="2"]')).toBeChecked();
});
