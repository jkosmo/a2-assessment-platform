import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

// #1168, tredje skive: «Avpubliser» på et kurs brukte nettleserens spørreboks («Avpublisere kurset …?»), mens «Publiser» (#1164)
// har sidas dialog som sier hvem som ser kurset. Nå har «Avpubliser» den samme dialogen, og den sier hvem som MISTER tilgangen,
// med de samme tallene (`GET …/publish-audience`, kursets egen synlighet). Avbryt og Esc sender ingenting; «Avpubliser»
// avpubliserer én gang. Og kursets slettedialog nevner seksjonene, ikke bare modulene.

const LIST = "/admin-content/courses";

const COURSE = {
  id: "course-1",
  title: { "en-GB": "Arbeidsmiljø", nb: "Arbeidsmiljø", nn: "Arbeidsmiljø" },
  description: null,
  certificationLevel: "basic",
  moduleCount: 1,
  updatedAt: "2026-11-13T12:00:00.000Z",
  publishedAt: "2026-11-10T12:00:00.000Z",
  archivedAt: null,
  modules: [{ moduleId: "mod-a", sortOrder: 0, moduleTitle: "Modul A" }],
  contentRevision: 3,
};

const RESTRICTED = {
  policy: "RESTRICTED",
  classes: [{ id: "class-a", name: "Prosjektledere Bergen", isSystem: false, memberCount: 12 }],
  individualCount: 2,
  totalCount: 14,
};

async function setup(page: Page, audience: unknown, { course = {} as Record<string, unknown> } = {}) {
  const state = await mockCommonApis(page, { courses: [{ ...COURSE, ...course } as never] });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  const calls = { audience: [] as string[], unpublish: 0, browserQuestions: [] as string[] };
  await page.route("**/api/admin/content/courses/*/publish-audience*", async (route: Route) => {
    calls.audience.push(new URL(route.request().url()).search);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ audience }) });
  });
  await page.route("**/api/admin/content/courses/*/unpublish", async (route: Route) => {
    calls.unpublish += 1;
    const target = state.mutableCourses.find((c) => c.id === "course-1");
    if (target) target.publishedAt = null;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: target }) });
  });
  // Nettleserens spørreboks skal ikke dukke opp. Gjør den det, sier testen nei, og ingenting sendes.
  page.on("dialog", (d) => { calls.browserQuestions.push(d.message()); void d.dismiss(); });
  return calls;
}

const listUnpublish = (page: Page) => page.locator("#coursesTableBody tr").filter({ hasText: "Arbeidsmiljø" }).locator('[data-action="unpublish"]');
const dialog = (page: Page) => page.locator("#cascadePublishDialog");

async function openFromList(page: Page) {
  await page.goto(LIST);
  const button = listUnpublish(page);
  await (await revealRowAction(page, button)).click();
  await expect(dialog(page)).toBeVisible();
  return button;
}

test.describe("#1168 — «Avpubliser» på et kurs", () => {
  test("åpent kurs: «Hvem mister tilgangen: alle deltakere»; Avbryt og Esc sender ingenting, Avpubliser avpubliserer én gang", async ({ page }) => {
    const calls = await setup(page, { policy: "OPEN" });
    const button = await openFromList(page);
    await expect(page.locator("#cascadePublishTitle")).toHaveText("Avpublisere «Arbeidsmiljø»?");
    await expect(page.locator("#cascadePublishText")).toHaveText("Kurset blir skjult for deltakerne til du publiserer det igjen.");
    const section = dialog(page).locator("[data-publish-audience='open']");
    await expect(section.locator("h3")).toHaveText("Hvem mister tilgangen");
    await expect(section).toContainText("Alle deltakere. Kurset er åpent, så det forsvinner fra Mine kurs hos alle.");
    await expect(page.locator("#cascadePublishConfirmBtn")).toHaveText("Avpubliser");
    await expect(page.locator("#cascadePublishCancelBtn")).toBeFocused();
    // Kurset spurt uten utkastet: det er de som ser kurset NÅ som mister det.
    expect(calls.audience).toEqual([""]);

    await page.locator("#cascadePublishCancelBtn").click();
    await expect(dialog(page)).toBeHidden();
    expect(calls.unpublish).toBe(0);
    await expect(button).toBeEnabled();

    await (await revealRowAction(page, listUnpublish(page))).click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    expect(calls.unpublish).toBe(0);

    await (await revealRowAction(page, listUnpublish(page))).click();
    await page.locator("#cascadePublishConfirmBtn").click();
    await expect.poll(() => calls.unpublish).toBe(1);
    await expect(page.locator(".toast__message").first()).toBeVisible();
    expect(calls.browserQuestions).toEqual([]);
  });

  test("begrenset kurs: klassene og tallene, under «Hvem mister tilgangen»", async ({ page }) => {
    const calls = await setup(page, RESTRICTED);
    await openFromList(page);
    const section = dialog(page).locator("[data-publish-audience='restricted']");
    await expect(section.locator("h3")).toHaveText("Hvem mister tilgangen");
    await expect(section).toContainText("De som er tildelt kurset:");
    await expect(section.locator("[data-audience-class='class-a']")).toContainText("12 deltakere");
    await expect(section.locator("[data-audience-individuals]")).toHaveText("2 tildelt enkeltvis");
    await expect(section.locator("[data-audience-total]")).toHaveText("14 deltakere i alt.");
    await page.locator("#cascadePublishConfirmBtn").click();
    await expect.poll(() => calls.unpublish).toBe(1);
  });

  test("KONTROLL: «Publiser» har fortsatt sine egne ord («Hvem ser kurset etterpå»)", async ({ page }) => {
    await setup(page, { policy: "OPEN" }, { course: { publishedAt: null } });
    await page.goto(LIST);
    await (await revealRowAction(page, page.locator("#coursesTableBody tr").filter({ hasText: "Arbeidsmiljø" }).locator('[data-action="publish"]'))).click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator("#cascadePublishTitle")).toHaveText("Publisere kurset?");
    await expect(dialog(page).locator("[data-publish-audience='open'] h3")).toHaveText("Hvem ser kurset etterpå");
    await expect(page.locator("#cascadePublishText")).toBeHidden();
  });

  test("390 px: dialogen passer, og sida ruller ikke vannrett", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, RESTRICTED);
    await openFromList(page);
    const box = await dialog(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
