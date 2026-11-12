import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// #934 skive 4a (doc/DESIGN_934.md, «4a — innholdslåsen, kursskjemaet og overgangen»):
//   - Feiler lastingen av elementlista, brukte skjemaet en gammel liste med bare moduler — og en lagring tok bort
//     alle seksjonene. Nå sier skjemaet fra og lagrer ikke.
//   - Et eksisterende kurs lagres i ÉTT kall til …/content, med telleren skjemaet lastet.
//   - Har noen andre lagret kurset siden (409), beholder skjemaet det forfatteren skrev og sier hva hen skal gjøre.

const COURSE = "/admin-content/courses/course-1";

function course(overrides: Record<string, unknown> = {}) {
  return {
    id: "course-1",
    title: { "en-GB": "Generativ KI", nb: "Generativ KI", nn: "Generativ KI" },
    description: null,
    certificationLevel: "basic",
    moduleCount: 1,
    updatedAt: "2026-10-11T12:00:00.000Z",
    publishedAt: "2026-10-11T12:00:00.000Z",
    archivedAt: null,
    // Det den gamle reservelista ble laget av: bare modulene. Kurset har også en seksjon.
    modules: [{ moduleId: "mod-a", sortOrder: 0, moduleTitle: "Modul A" }],
    versionMajor: 2,
    versionMinor: 4,
    certificateHolders: 0,
    contentRevision: 9,
    ...overrides,
  };
}

const ITEMS = [
  { id: "ci-1", type: "MODULE", sortOrder: 0, moduleId: "mod-a", sectionId: null, title: "Modul A", discussionsEnabled: true, archivedAt: null },
  { id: "ci-2", type: "SECTION", sortOrder: 1, moduleId: null, sectionId: "sec-b", title: "Seksjon B", discussionsEnabled: true, archivedAt: null },
];

type Sent = { method: string; url: string; body: unknown };

// #1140 etappe 2 (skive 2c): et PUBLISERT kurs lagres til utkastet (`PUT …/draft`, test/e2e/admin-content-course-draft-1140.spec.ts).
// Testene av den direkte lagringen til …/content bruker derfor et kurs som er avpublisert (`unpublished`).
async function openCourse(page: Page, options: { itemsFail?: boolean; saveStatus?: number; saveBody?: unknown; unpublished?: boolean } = {}) {
  await mockCommonApis(page, { courses: [course(options.unpublished ? { publishedAt: null } : {}) as never], libraryModules: [] });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  const writes: Sent[] = [];
  await page.route("**/api/admin/content/courses/course-1/items", async (route: Route) => {
    if (route.request().method() !== "GET") {
      writes.push({ method: route.request().method(), url: route.request().url(), body: route.request().postDataJSON() });
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    if (options.itemsFail) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal_error", message: "boom" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: ITEMS }) });
  });
  await page.route("**/api/admin/content/courses/course-1/content", async (route: Route) => {
    writes.push({ method: route.request().method(), url: route.request().url(), body: route.request().postDataJSON() });
    if (options.saveStatus && options.saveStatus >= 400) {
      await route.fulfill({ status: options.saveStatus, contentType: "application/json", body: JSON.stringify(options.saveBody ?? {}) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: course() }) });
  });
  await page.route("**/api/admin/content/courses/course-1", async (route: Route) => {
    if (route.request().method() === "GET") return route.fallback();
    writes.push({ method: route.request().method(), url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: course() }) });
  });
  await page.goto(COURSE);
  await expect(page.locator("#title-nb")).toBeVisible();
  return { writes };
}

test.describe("#934 skive 4a — kursskjemaet", () => {
  test("elementlista kom ikke: skjemaet sier fra, viser ikke bare modulene, og lagrer ingenting — heller ikke etter at hodet er tegnet på nytt", async ({ page }) => {
    const { writes } = await openCourse(page, { itemsFail: true });
    const banner = page.locator("#formErrorBanner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Kunne ikke laste kursets moduler og seksjoner, så kurset kan ikke lagres nå.");
    // Den gamle reservelista (bare modulene fra kursdetaljen) brukes ikke.
    await expect(page.locator("#moduleList li")).toHaveCount(0);

    await page.locator("#title-nb").fill("Generativ KI — nytt navn");
    await page.locator("#formSaveBtn").click();
    await expect(banner).toContainText("kan ikke lagres nå");
    // Hodet tegnes på nytt ved språkbytte (refreshHeader bytter knappene). Lagre der også.
    await page.locator('[data-form-locale="nn"]').click();
    await page.locator('[data-form-locale="nb"]').click();
    await page.locator("#formSaveBtn").click();
    await expect(banner).toContainText("kan ikke lagres nå");
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
  });

  test("kontroll: kom lista, lagres kurset i ÉTT kall til …/content med elementene, seksjonen og telleren", async ({ page }) => {
    const { writes } = await openCourse(page, { unpublished: true });
    await expect(page.locator("#moduleList li")).toHaveCount(2);
    await expect(page.locator("#formErrorBanner")).toBeHidden();
    await page.locator("#title-nb").fill("Generativ KI — nytt navn");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].url).toMatch(/\/courses\/course-1\/content$/);
    expect(writes[0].method).toBe("PUT");
    const body = writes[0].body as { items: Array<{ moduleId?: string; sectionId?: string }>; expectedRevision: number; versionAware?: unknown };
    expect(body.items.map((i) => i.moduleId ?? i.sectionId)).toEqual(["mod-a", "sec-b"]);
    expect(body.expectedRevision).toBe(9);
    expect(body).not.toHaveProperty("versionAware");
  });

  test("noen andre har lagret kurset (409 course_changed): skjemaet beholder teksten og sier hva forfatteren skal gjøre", async ({ page }) => {
    const { writes } = await openCourse(page, {
      unpublished: true,
      saveStatus: 409,
      saveBody: { error: "course_changed", message: "Someone else saved this course after you opened it.", details: { expectedRevision: 9, currentRevision: 10 } },
    });
    await page.locator("#title-nb").fill("Mitt nye navn");
    await page.locator("#formSaveBtn").click();
    const banner = page.locator("#formErrorBanner");
    await expect(banner).toContainText("Noen andre har lagret kurset etter at du åpnet det. Ingenting ble lagret.");
    await expect(page.locator("#title-nb")).toHaveValue("Mitt nye navn");
    await expect(page.locator("#formSaveBtn")).toBeEnabled();
    expect(writes).toHaveLength(1);
  });

  test("390 px: feilmeldingen om elementlista flyter ikke over", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCourse(page, { itemsFail: true });
    const banner = page.locator("#formErrorBanner .error-banner");
    await expect(banner).toBeVisible();
    const box = await banner.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
