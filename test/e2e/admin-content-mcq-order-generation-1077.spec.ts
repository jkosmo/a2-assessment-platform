import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { mockCommonApis, localizedText, buildMockModuleExport, clickEnabledButton } from "./admin-content-helpers.js";

// #1077 leveranse 2b: KI lager «sett i riktig rekkefølge» bare der kilden har en fast rekkefølge, og sier
// fra når den ikke fant noen (produkteier 2026-10-25). Her: at forfatteren faktisk ser det — med grunnen —
// og at det ikke står noe når genereringen ga en rekkefølge.

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

test("ingen rekkefølge: forfatteren får vite det, med grunnen fra KI", async ({ page }) => {
  await generate(page, {
    questions: [{ stem: "Ny stamme", options: ["X", "Y"], correctAnswer: "X", rationale: "Fordi" }],
    noOrderReason: "Kilden beskriver prinsipper, ikke steg.",
  });
  // Kvitteringen etter genereringen er en melding nederst på skjermen (logResolveSlot → toast).
  const note = page.locator(".toast__message", { hasText: "Ingen «sett i riktig rekkefølge»" }).last();
  await expect(note).toBeVisible({ timeout: 15000 });
  await expect(note).toContainText("KI fant ingen fast rekkefølge av steg i kilden.");
  await expect(note).toContainText("Kilden beskriver prinsipper, ikke steg.");
});

test("kontroll: ga genereringen en rekkefølge, står det ingen slik melding", async ({ page }) => {
  await generate(page, {
    questions: [{ questionType: "order", stem: "Sett i rekkefølge", options: ["Motta", "Vurdere", "Avgjøre"], correctAnswer: "Motta", rationale: "Fordi" }],
  });
  await expect(page.locator("[data-preview-edit-question]")).toHaveCount(3, { timeout: 15000 });
  await expect(page.locator(".toast__message", { hasText: "Ingen «sett i riktig rekkefølge»" })).toHaveCount(0);
  // Og spørsmålet kom inn som rekkefølge.
  await expect(page.locator('[data-preview-edit-order="2"]')).toBeChecked();
});
