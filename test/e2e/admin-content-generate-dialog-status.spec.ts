import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mockCommonApis, localizedText, buildMockModuleExport, clickEnabledButton } from "./admin-content-helpers.js";

// Stage 14.09 (produkteier): «Vi trenger å gjøre det bedre synlig når løsningen jobber i bakgrunnen,
// eksempelvis i denne dialogboksen.» En crawl eller en analyse kan ta minutter; det eneste synlige
// var en knapp som byttet tekst — og toastene lå BAK dialogens bakteppe (modal <dialog> er i
// toppsjiktet). Nå: en statuslinje med spinner i dialogen mens noe pågår, Stopp der jobben kan
// avbrytes, og toastene i toppsjiktet så de vises over dialogen. Generer står ved siden av Avbryt.

async function openModuleAndDialog(page: Page, delays: { crawlMs: number; blueprintMs: number }) {
  await mockCommonApis(page, {
    modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
    moduleExports: {
      "module-1": buildMockModuleExport({ id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1", taskText: localizedText("Norsk scenario") }),
    },
  });
  await page.route("**/api/admin/content/source-material/crawl-url", async (route) => {
    await new Promise((r) => setTimeout(r, delays.crawlMs));
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ startHostname: "di2x.com", truncated: false, pages: [{ url: "https://di2x.com/a", extractedText: "Tekst A" }, { url: "https://di2x.com/b", extractedText: "Tekst B" }] }),
    });
  });
  await page.route("**/api/admin/content/generate/blueprint", async (route) => {
    await new Promise((r) => setTimeout(r, delays.blueprintMs));
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ blueprint: { learningObjectives: ["Mål"], keyTopics: ["Tema"], mcqProfile: { recommendedCount: 3 }, notes: "" } }),
    });
  });
  await page.goto("/admin-content/module/module-1/conversation");
  await expect(page.locator("#previewEditTaskText")).toHaveValue(/Norsk scenario/);
  await clickEnabledButton(page, /^Generate content$|^Generer innhold$/);
  await expect(page.locator("#dialogGenerate")).toHaveAttribute("open", "");
}

test.describe("Generer innhold: det som pågår, vises i dialogen", () => {
  test("crawl shows a status line with the host while it runs, and the result toast is visible above the modal", async ({ page }) => {
    await openModuleAndDialog(page, { crawlMs: 1500, blueprintMs: 0 });
    const status = page.locator("#dialogGenerateStatus");
    await expect(status).toBeHidden();

    page.once("dialog", (d) => d.accept("https://di2x.com/start"));
    await page.getByRole("button", { name: /Crawl/ }).click();
    await expect(status).toBeVisible();
    await expect(status).toContainText("di2x.com");
    // Ingenting å stoppe: crawlen har ingen avbryter.
    await expect(status.locator("[data-dialog-status-abort]")).toBeHidden();
    // Generer er slått av mens kilden hentes.
    await expect(page.locator("#dialogGenerate .chat-submit-btn")).toBeDisabled();

    await expect(page.locator(".source-chip")).toBeVisible({ timeout: 10000 });
    await expect(status).toBeHidden();
    await expect(page.locator("#dialogGenerate .chat-submit-btn")).toBeEnabled();
    // Toasten er i toppsjiktet (popover) — synlig og ikke bak bakteppet.
    const toast = page.locator(".toast").filter({ hasText: /Crawled 2 pages|Hentet 2 sider|2 sider/ }).first();
    await expect(toast).toBeVisible();
    await expect(page.locator("#toastRegion")).toHaveAttribute("popover", "manual");
    expect(await page.locator("#toastRegion").evaluate((el) => el.matches(":popover-open"))).toBe(true);
  });

  test("Generate shows the analysis in the dialog with Stop, and clears it when the plan arrives", async ({ page }) => {
    await openModuleAndDialog(page, { crawlMs: 0, blueprintMs: 2500 });
    await page.locator("#dialogGenerate .chat-textarea").fill("Source notes about organising.");
    await page.locator("#dialogGenerate .chat-submit-btn").click();

    const status = page.locator("#dialogGenerateStatus");
    await expect(status).toBeVisible();
    await expect(status).toContainText(/Analysing source material|Analyserer kildemateriale/);
    await expect(status.locator("[data-dialog-status-abort]")).toBeVisible();
    // Framdriften står i dialogen, ikke som toast i tillegg.
    await expect(page.locator(".toast").filter({ hasText: /Analysing source material|Analyserer kildemateriale/ })).toHaveCount(0);

    await expect(page.locator("#dialogGeneratePlan")).toBeVisible({ timeout: 10000 });
    await expect(status).toBeHidden();
  });

  test("Stop in the status line aborts the analysis", async ({ page }) => {
    await openModuleAndDialog(page, { crawlMs: 0, blueprintMs: 20000 });
    await page.locator("#dialogGenerate .chat-textarea").fill("Source notes about organising.");
    await page.locator("#dialogGenerate .chat-submit-btn").click();
    const status = page.locator("#dialogGenerateStatus");
    await expect(status.locator("[data-dialog-status-abort]")).toBeVisible();
    await status.locator("[data-dialog-status-abort]").click();
    await expect(status).toBeHidden();
    await expect(page.locator(".toast").filter({ hasText: /cancelled|aborted|avbrutt|avbrote/i }).first()).toBeVisible();
  });

  test("Cancel and Generate sit together in the footer, Generate to the right", async ({ page }) => {
    await openModuleAndDialog(page, { crawlMs: 0, blueprintMs: 0 });
    const cancel = page.locator("#dialogGenerateCancel");
    const generate = page.locator("#dialogGenerateSubmitSlot .chat-submit-btn");
    await expect(generate).toBeVisible();
    const [c, g] = await Promise.all([cancel.boundingBox(), generate.boundingBox()]);
    expect(c && g && Math.abs(c.y - g.y) < 4).toBe(true);
    expect(c && g && g.x > c.x).toBe(true);
    // Avbryt er ikke en halv rad bred (.row-rutenettet): begge er knapper i naturlig bredde.
    expect(c && c.width < 160).toBe(true);
  });
});
