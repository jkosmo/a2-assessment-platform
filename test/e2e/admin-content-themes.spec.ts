import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// 2.102.0 — tema i «Mine kurs».
//
// Produkteier, 2026-10-25: «Tema defineres i et eget UI under innholdsforvaltning og plassert til
// venstre for kurs. Kurs tilordnes Tema inne i selve kurset.» Bare administrator endrer lista. Navnet
// skrives på bokmål; nynorsk og engelsk fylles inn automatisk når de står tomme.

type Theme = { id: string; name: string; courseCount: number; updatedAt: string };
const L = (nb: string, nn: string, en: string) => JSON.stringify({ nb, nn, "en-GB": en });

async function mockThemes(page: Page, initial: Theme[], opts: { failTranslation?: boolean } = {}) {
  const themes = [...initial];
  const sent: Array<{ method: string; url: string; body: unknown }> = [];
  const translated: unknown[] = [];
  await page.route("**/api/admin/content/themes**", async (route: Route) => {
    const request = route.request();
    const method = request.method();
    if (method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ themes }) });
    }
    const body = method === "DELETE" ? null : request.postDataJSON();
    sent.push({ method, url: request.url(), body });
    if (method === "POST") {
      const theme = { id: `t-${themes.length + 1}`, name: JSON.stringify(body.name), courseCount: 0, updatedAt: "2026-10-25T12:00:00.000Z" };
      themes.push(theme);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ theme }) });
    }
    const id = decodeURIComponent(request.url().split("/").pop() ?? "");
    const index = themes.findIndex((theme) => theme.id === id);
    if (method === "PUT") {
      themes[index] = { ...themes[index], name: JSON.stringify(body.name) };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ theme: themes[index] }) });
    }
    const [removed] = themes.splice(index, 1);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ detachedCourseCount: removed.courseCount }) });
  });
  await page.route("**/api/admin/content/titles/localize", async (route: Route) => {
    const body = route.request().postDataJSON();
    translated.push(body);
    const title: Record<string, string> = {};
    const failedLocales: string[] = [];
    for (const locale of body.targetLocales) {
      if (opts.failTranslation && locale === "en-GB") failedLocales.push(locale);
      else title[locale] = `${body.title} (${locale})`;
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title, failedLocales }) });
  });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  return { themes, sent, translated };
}

const EXISTING: Theme[] = [
  { id: "t-ki", name: L("KI", "KI", "AI"), courseCount: 2, updatedAt: "2026-10-25T12:00:00.000Z" },
  { id: "t-pl", name: L("Prosjektledelse", "Prosjektleiing", "Project management"), courseCount: 0, updatedAt: "2026-10-25T12:00:00.000Z" },
];

test.describe("2.102.0 Tema i innholdsforvaltningen", () => {
  test("Tema står til venstre for Kurs i menyen, på alle sidene i innholdsforvaltningen", async ({ page }) => {
    await mockCommonApis(page, { meRoles: ["ADMINISTRATOR"] });
    await mockThemes(page, EXISTING);
    for (const path of ["/admin-content/themes", "/admin-content/courses", "/admin-content/sections"]) {
      await page.goto(path);
      const links = page.locator("#contentAreaNav a");
      await expect(links.first()).toHaveAttribute("id", "navTema");
      await expect(links.nth(1)).toHaveAttribute("id", "navKurs");
    }
  });

  test("administrator: nytt tema på bokmål får nynorsk og engelsk automatisk, og det som lagres, vises", async ({ page }) => {
    await mockCommonApis(page, { meRoles: ["ADMINISTRATOR"] });
    const mock = await mockThemes(page, EXISTING);
    await page.goto("/admin-content/themes");
    await expect(page.locator("#themesTableBody tr")).toHaveCount(2);

    await page.locator("#newThemeBtn").click();
    await page.locator("#themeName-nb").fill("Rådgivning");
    await page.locator("#themeDialogSaveBtn").click();

    await expect.poll(() => mock.sent.length).toBe(1);
    expect(mock.translated[0]).toMatchObject({ title: "Rådgivning", sourceLocale: "nb", targetLocales: ["nn", "en-GB"] });
    expect(mock.sent[0]).toMatchObject({ method: "POST", body: { name: { nb: "Rådgivning", nn: "Rådgivning (nn)", "en-GB": "Rådgivning (en-GB)" } } });
    await expect(page.locator("#themeDialog")).not.toBeVisible();
    await expect(page.locator("#themesTableBody tr")).toHaveCount(3);
  });

  test("et språk forfatteren har fylt inn, oversettes ikke over", async ({ page }) => {
    await mockCommonApis(page, { meRoles: ["ADMINISTRATOR"] });
    const mock = await mockThemes(page, EXISTING);
    await page.goto("/admin-content/themes");
    await page.locator("#newThemeBtn").click();
    await page.locator("#themeName-nb").fill("Ledelse");
    await page.locator("#themeName-nn").fill("Leiing");
    await page.locator("#themeDialogSaveBtn").click();
    await expect.poll(() => mock.sent.length).toBe(1);
    expect(mock.translated[0]).toMatchObject({ targetLocales: ["en-GB"] });
    expect(mock.sent[0]).toMatchObject({ body: { name: { nb: "Ledelse", nn: "Leiing", "en-GB": "Ledelse (en-GB)" } } });
  });

  test("en oversettelse som feiler, blir stående tom med en melding — aldri fylt med bokmål — og neste lagring endrer samme tema", async ({ page }) => {
    await mockCommonApis(page, { meRoles: ["ADMINISTRATOR"] });
    const mock = await mockThemes(page, EXISTING, { failTranslation: true });
    await page.goto("/admin-content/themes");
    await page.locator("#newThemeBtn").click();
    await page.locator("#themeName-nb").fill("Økonomi");
    await page.locator("#themeDialogSaveBtn").click();

    await expect(page.locator("#themeDialogError")).toBeVisible();
    await expect(page.locator("#themeDialogError")).toContainText("Engelsk");
    await expect(page.locator("#themeName-en-GB")).toHaveValue("");
    await expect(page.locator("#themeName-nn")).toHaveValue("Økonomi (nn)");
    expect(mock.sent[0]).toMatchObject({ method: "POST", body: { name: { nb: "Økonomi", nn: "Økonomi (nn)" } } });
    expect((mock.sent[0].body as { name: Record<string, string> }).name["en-GB"]).toBeUndefined();

    await page.locator("#themeName-en-GB").fill("Finance");
    await page.locator("#themeDialogSaveBtn").click();
    await expect.poll(() => mock.sent.length).toBe(2);
    expect(mock.sent[1].method).toBe("PUT");
    expect(mock.sent[1].url).toContain("/api/admin/content/themes/t-3");
    await expect(page.locator("#themeDialog")).not.toBeVisible();
  });

  test("bokmål er påkrevd — ingenting sendes uten", async ({ page }) => {
    await mockCommonApis(page, { meRoles: ["ADMINISTRATOR"] });
    const mock = await mockThemes(page, EXISTING);
    await page.goto("/admin-content/themes");
    await page.locator("#newThemeBtn").click();
    await page.locator("#themeName-en-GB").fill("Only English");
    await page.locator("#themeDialogSaveBtn").click();
    await expect(page.locator("#themeDialogError")).toBeVisible();
    expect(mock.sent).toHaveLength(0);
    expect(mock.translated).toHaveLength(0);
  });

  test("slett sier hvor mange kurs som mister temaet", async ({ page }) => {
    await mockCommonApis(page, { meRoles: ["ADMINISTRATOR"] });
    const mock = await mockThemes(page, EXISTING);
    await page.goto("/admin-content/themes");
    await page.locator('#themesTableBody tr[data-row-id="t-ki"] [data-action="delete"]').click();
    await expect(page.locator("#themeDeleteText")).toContainText("2 kurs");
    await page.locator("#themeDeleteConfirmBtn").click();
    await expect.poll(() => mock.sent.length).toBe(1);
    expect(mock.sent[0]).toMatchObject({ method: "DELETE" });
    await expect(page.locator("#themesTableBody tr")).toHaveCount(1);
  });

  test("fagansvarlig ser lista, men ingen knapper for å endre den", async ({ page }) => {
    await mockCommonApis(page, { meRoles: ["SUBJECT_MATTER_OWNER"] });
    await mockThemes(page, EXISTING);
    await page.goto("/admin-content/themes");
    await expect(page.locator("#themesTableBody tr")).toHaveCount(2);
    await expect(page.locator("#newThemeBtn")).toHaveCount(0);
    await expect(page.locator('#themesTableBody [data-action="edit"], #themesTableBody [data-action="delete"]')).toHaveCount(0);
    await expect(page.locator(".page-lead")).toContainText("Bare administrator");
  });

  test("tema har ingen tilstander, og da ingen filterknapper — mens kursoversikten beholder sine", async ({ page }) => {
    // Ett kurs i lista: en tom kursliste viser tom-tilstanden, uten verktøylinje, og ville ikke målt noe.
    await mockCommonApis(page, {
      meRoles: ["ADMINISTRATOR"],
      courses: [{ id: "k1", title: "Arbeidsmiljø", description: null, certificationLevel: "basic", moduleCount: 1, updatedAt: "2026-10-25T10:00:00.000Z", publishedAt: null, archivedAt: null, modules: [] }] as never,
    });
    await mockThemes(page, EXISTING);
    await page.goto("/admin-content/themes");
    await expect(page.locator("#themesTableBody tr")).toHaveCount(2);
    await expect(page.locator(".list-filters")).toHaveCount(0);
    // Kontrollcase: lista med tilstander har fortsatt pillene sine.
    await page.goto("/admin-content/courses");
    await expect(page.locator(".list-filters .list-filter-btn").first()).toBeVisible();
  });
});

test.describe("2.102.0 Tema inne i kurset", () => {
  const COURSE = {
    id: "course-1", title: "Kontrakter", description: null, certificationLevel: "basic", moduleCount: 0,
    updatedAt: "2026-10-25T12:00:00.000Z", publishedAt: null, archivedAt: null, sortOrder: null, modules: [],
    themeIds: ["t-pl"],
  };

  async function openCourse(page: Page) {
    await mockCommonApis(page, { courses: [COURSE], libraryModules: [] });
    await mockThemes(page, EXISTING);
    await page.route("**/api/admin/content/courses/*/items", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
    const sent: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/courses/course-1", async (route: Route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "course-1" } }) });
    });
    await page.goto("/admin-content/courses/course-1");
    await expect(page.locator("#courseThemesField")).toBeVisible();
    return sent;
  }

  test("kurset viser temaene alfabetisk med sine avkrysset, og lagrer nøyaktig de valgte", async ({ page }) => {
    const sent = await openCourse(page);
    const boxes = page.locator('#courseThemesField input[name="courseTheme"]');
    await expect(boxes).toHaveCount(2);
    await expect(page.locator("#courseThemesField .course-theme-option").nth(0)).toContainText("KI");
    await expect(page.locator('#courseThemesField input[value="t-pl"]')).toBeChecked();
    await expect(page.locator("#courseThemesSummary")).toHaveText("Vises under: Prosjektledelse.");

    await page.locator('#courseThemesField input[value="t-ki"]').check();
    await expect(page.locator("#courseThemesSummary")).toHaveText("Vises under: KI, Prosjektledelse.");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect([...(sent[0].themeIds as string[])].sort()).toEqual(["t-ki", "t-pl"]);
  });

  test("uten avkrysning: tom liste sendes, og oppsummeringen sier «Andre kurs»", async ({ page }) => {
    const sent = await openCourse(page);
    await page.locator('#courseThemesField input[value="t-pl"]').uncheck();
    await expect(page.locator("#courseThemesSummary")).toContainText("Andre kurs");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].themeIds).toEqual([]);
  });

  test("kom ikke temalista, vises ikke valget — og kursets tema røres ikke ved lagring", async ({ page }) => {
    await mockCommonApis(page, { courses: [COURSE], libraryModules: [] });
    await page.route("**/api/admin/content/themes**", (route: Route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
    await page.route("**/api/admin/content/courses/*/items", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
    const sent: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/courses/course-1", async (route: Route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "course-1" } }) });
    });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.goto("/admin-content/courses/course-1");
    await expect(page.locator("#certLevel")).toBeVisible();
    await expect(page.locator("#courseThemesField")).toHaveCount(0);
    await page.locator("#title-nb").fill("Kontrakter 2");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect("themeIds" in sent[0]).toBe(false);
  });
});
