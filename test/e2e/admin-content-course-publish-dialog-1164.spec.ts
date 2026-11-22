import { expect, test } from "@playwright/test";
import type { Locator, Page, Route } from "@playwright/test";

import { mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

// #1164 (produkteier 14.11.2026, «Vi bør gjøre ting likt mellom moduler og kurs»): «Publiser» på et kurs spør før publiseringen,
// og dialogen sier hvem som ser kurset etterpå — alle deltakere (åpent), eller de tildelte (begrenset), med klassene og tallene
// tjeneren regnet ut (`GET …/publish-audience`, svarformen i doc/API_REFERENCE.md). Avbryt sender ingenting; Publiser publiserer.
// Og et nytt kurs er begrenset som standard i skjemaet.

const LIST = "/admin-content/courses";
const DETAIL = "/admin-content/courses/course-1";

const COURSE = {
  id: "course-1",
  title: { "en-GB": "Arbeidsmiljø", nb: "Arbeidsmiljø", nn: "Arbeidsmiljø" },
  description: null,
  certificationLevel: "basic",
  moduleCount: 1,
  updatedAt: "2026-11-13T12:00:00.000Z",
  publishedAt: null,
  archivedAt: null,
  modules: [{ moduleId: "mod-a", sortOrder: 0, moduleTitle: "Modul A" }],
  contentRevision: 3,
};

const RESTRICTED = {
  policy: "RESTRICTED",
  classes: [
    { id: "class-a", name: "Prosjektledere Bergen", isSystem: false, memberCount: 12 },
    { id: "class-b", name: "Nye i A-2", isSystem: false, memberCount: 1 },
  ],
  individualCount: 3,
  totalCount: 15,
};

async function locale(page: Page, value: string) {
  await page.addInitScript((loc) => { try { localStorage.setItem("participant.locale", loc); } catch { /* ignore */ } }, value);
}

/** Tjeneren: hvem som ser kurset (med spørringen som kom), og publiseringen (kroppene som kom). */
async function setup(page: Page, audience: unknown, { loc = "nb", course = {} as Record<string, unknown> } = {}) {
  const state = await mockCommonApis(page, { courses: [{ ...COURSE, ...course } as never] });
  await locale(page, loc);
  const calls = { audience: [] as string[], publish: [] as unknown[] };
  await page.route("**/api/admin/content/courses/*/publish-audience*", async (route: Route) => {
    calls.audience.push(new URL(route.request().url()).search);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ audience }) });
  });
  await page.route("**/api/admin/content/courses/*/publish", async (route: Route) => {
    calls.publish.push(route.request().postDataJSON());
    const target = state.mutableCourses.find((c) => c.id === "course-1");
    if (target) target.publishedAt = "2026-11-15T12:00:00.000Z";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: target, publishedItems: [] }) });
  });
  return { state, calls };
}

const listPublish = (page: Page) => page.locator("#coursesTableBody tr").filter({ hasText: "Arbeidsmiljø" }).locator('[data-action="publish"]');
const dialog = (page: Page) => page.locator("#cascadePublishDialog");

async function openFromList(page: Page) {
  await page.goto(LIST);
  const button = listPublish(page);
  await (await revealRowAction(page, button)).click();
  await expect(dialog(page)).toBeVisible();
  return button;
}

async function noHorizontalOverflow(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const width = page.viewportSize()!.width;
  expect(box, "dialogen vises").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`#1164 publiseringsdialogen (${viewport.width} px)`, () => {
    test.use({ viewport });

    test("åpent kurs: «Alle deltakere», Avbryt sender ingenting og gir fokuset tilbake, Publiser publiserer", async ({ page }) => {
      const { calls } = await setup(page, { policy: "OPEN" });
      const button = await openFromList(page);
      await expect(page.locator("#cascadePublishTitle")).toHaveText("Publisere kurset?");
      await expect(dialog(page).locator("[data-publish-audience='open']")).toContainText("Alle deltakere. Kurset er åpent");
      await expect(page.locator("#cascadePublishConfirmBtn")).toHaveText("Publiser");
      await expect(page.locator("#cascadePublishCancelBtn")).toBeFocused();
      await noHorizontalOverflow(page, dialog(page));
      await page.screenshot({ path: `test-results/1164-dialog-apent-${viewport.width}.png` });

      await page.locator("#cascadePublishCancelBtn").click();
      await expect(dialog(page)).toBeHidden();
      expect(calls.publish).toEqual([]);
      await expect(button).toBeEnabled();
      await expect(button).toBeFocused();

      // Esc er også et nei.
      await button.click();
      await expect(dialog(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toBeHidden();
      expect(calls.publish).toEqual([]);

      await button.click();
      await page.locator("#cascadePublishConfirmBtn").click();
      await expect.poll(() => calls.publish.length).toBe(1);
      expect(calls.publish[0]).toMatchObject({ publishItems: false });
      await expect(page.locator(".toast--success").first()).toBeVisible();
    });

    test("begrenset kurs: klassene med antall, de enkeltvis tildelte og tallet i alt", async ({ page }) => {
      const { calls } = await setup(page, RESTRICTED);
      await openFromList(page);
      const section = dialog(page).locator("[data-publish-audience='restricted']");
      await expect(section).toContainText("Bare de som er tildelt kurset:");
      await expect(section.locator("[data-audience-class='class-a']")).toContainText("Prosjektledere Bergen");
      await expect(section.locator("[data-audience-class='class-a']")).toContainText("12 deltakere");
      await expect(section.locator("[data-audience-class='class-b']")).toContainText("1 deltaker");
      await expect(section.locator("[data-audience-individuals]")).toHaveText("3 tildelt enkeltvis");
      await expect(section.locator("[data-audience-total]")).toHaveText("15 deltakere i alt.");
      await noHorizontalOverflow(page, dialog(page));
      await page.screenshot({ path: `test-results/1164-dialog-begrenset-${viewport.width}.png` });
      // Kurset spurt uten utkastet.
      expect(calls.audience).toEqual([""]);
      await page.locator("#cascadePublishConfirmBtn").click();
      await expect.poll(() => calls.publish.length).toBe(1);
    });
  });
}

test.describe("#1164 publiseringsdialogen, de andre veiene", () => {
  test("begrenset uten tildelinger: «Ingen ennå»", async ({ page }) => {
    await setup(page, { policy: "RESTRICTED", classes: [], individualCount: 0, totalCount: 0 });
    await openFromList(page);
    await expect(dialog(page).locator("[data-publish-audience='none']")).toContainText("Ingen ennå.");
  });

  test("med upublisert innhold: lista og hvem som ser kurset i samme dialog, og publiseringen tar innholdet med", async ({ page }) => {
    const { calls } = await setup(page, RESTRICTED);
    await page.route("**/api/admin/content/courses/*/publish-preview", (route: Route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courseId: "course-1", allPublished: false, publishable: true, unpublishedItems: [{ type: "MODULE", id: "mod-a", title: "Modul A", publishable: true, blockers: [] }] }),
    }));
    await openFromList(page);
    await expect(page.locator("#cascadePublishList")).toContainText("Modul A");
    await expect(dialog(page).locator("[data-publish-audience='restricted']")).toBeVisible();
    await page.locator("#cascadePublishConfirmBtn").click();
    await expect.poll(() => calls.publish.length).toBe(1);
    expect(calls.publish[0]).toMatchObject({ publishItems: true });
  });

  test("noe kan ikke publiseres: bare grunnen og «Lukk», ingen tekst om hvem som ser kurset", async ({ page }) => {
    const { calls } = await setup(page, { policy: "OPEN" });
    await page.route("**/api/admin/content/courses/*/publish-preview", (route: Route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courseId: "course-1", allPublished: false, publishable: false, unpublishedItems: [{ type: "MODULE", id: "mod-a", title: "Modul A", publishable: false, blockers: [{ code: "module_no_content", message: "x" }] }] }),
    }));
    await openFromList(page);
    await expect(page.locator("#cascadePublishConfirmBtn")).toBeHidden();
    await expect(page.locator("#cascadePublishAudience")).toBeHidden();
    await page.locator("#cascadePublishCancelBtn").click();
    expect(calls.publish).toEqual([]);
  });

  test("«Publiser» i det åpnede kurset: samme dialog", async ({ page }) => {
    const { calls } = await setup(page, { policy: "OPEN" });
    await page.goto(DETAIL);
    await page.locator('.form-page-actions [data-action="publish"]').click();
    await expect(dialog(page).locator("[data-publish-audience='open']")).toBeVisible();
    await page.locator("#cascadePublishCancelBtn").click();
    expect(calls.publish).toEqual([]);
    await page.locator('.form-page-actions [data-action="publish"]').click();
    await page.locator("#cascadePublishConfirmBtn").click();
    await expect.poll(() => calls.publish.length).toBe(1);
  });

  test("hentingen av hvem som ser kurset feiler: ingen dialog, ingenting publiseres, og knappen virker igjen", async ({ page }) => {
    const { calls } = await setup(page, { policy: "OPEN" });
    await page.route("**/api/admin/content/courses/*/publish-audience*", (route: Route) => route.fulfill({
      status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal_error", message: "x" }),
    }));
    await page.goto(LIST);
    const button = listPublish(page);
    await (await revealRowAction(page, button)).click();
    await expect(page.locator(".toast--error").first()).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    await expect(button).toBeEnabled();
    expect(calls.publish).toEqual([]);
  });

  for (const [loc, expected] of [["en-GB", "All participants."], ["nn", "Alle deltakarar."]] as const) {
    test(`${loc}: dialogen er oversatt, uten rå nøkler`, async ({ page }) => {
      await setup(page, RESTRICTED, { loc });
      await openFromList(page);
      const text = await dialog(page).innerText();
      expect(text).not.toMatch(/courses\.|publishDialog|\{[a-zA-Z]+\}/);
      await page.locator("#cascadePublishCancelBtn").click();
      await page.unroute("**/api/admin/content/courses/*/publish-audience*");
      await page.route("**/api/admin/content/courses/*/publish-audience*", (route: Route) => route.fulfill({
        status: 200, contentType: "application/json", body: JSON.stringify({ audience: { policy: "OPEN" } }),
      }));
      await (await revealRowAction(page, listPublish(page))).click();
      await expect(dialog(page).locator("[data-publish-audience='open']")).toContainText(expected);
    });
  }
});

test.describe("#1164 «Publiser utkastet»", () => {
  /** Et publisert kurs med et lagret utkast: kursdetaljen, elementene og utkastet. */
  async function draftCourse(page: Page, audience: unknown, { certificateHolders = 0, draftItems = ["mod-a"] } = {}) {
    const { state, calls } = await setup(page, audience, { course: { publishedAt: "2026-10-01T12:00:00.000Z", hasDraft: true, lifecycle: "published_with_draft", certificateHolders, versionMajor: 3, versionMinor: 1 } });
    const draftPublish: unknown[] = [];
    await page.route("**/api/admin/content/courses/course-1/items", (route: Route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ items: [{ id: "ci-1", type: "MODULE", sortOrder: 0, moduleId: "mod-a", sectionId: null, title: "Modul A", discussionsEnabled: true, archivedAt: null }] }),
    }));
    await page.route("**/api/admin/content/courses/course-1/draft", (route: Route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ draft: {
        id: "draft-1", revision: 2, source: "form", updatedById: "u", updatedByName: "Kari", updatedAt: "2026-11-14T12:00:00.000Z",
        course: { title: JSON.stringify(COURSE.title), description: null, certificationLevel: "basic", enrollmentPolicy: "OPEN", discussionsEnabled: true, discussionOwnerNotifications: true, sortOrder: null, themeIds: [] },
        items: draftItems.map((id, index) => ({ type: "MODULE", sortOrder: index, moduleId: id, sectionId: null, title: id === "mod-a" ? "Modul A" : "Modul B", discussionsEnabled: true, archivedAt: null, unpublished: false, missing: false })),
      } }),
    }));
    await page.route("**/api/admin/content/courses/course-1/draft/publish", async (route: Route) => {
      draftPublish.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { ...COURSE, versionMajor: 3, versionMinor: 2 } }) });
    });
    return { state, calls, draftPublish };
  }

  test("uten versjonsspørsmål: dialogen sier hvem som ser kurset med utkastets synlighet; Avbryt publiserer ikke, Publiser utkastet gjør det", async ({ page }) => {
    const { calls, draftPublish } = await draftCourse(page, { policy: "OPEN" });
    await page.goto(DETAIL);
    const publish = page.locator('.form-page-actions [data-action="publish-draft"]');
    await publish.click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator("#cascadePublishTitle")).toHaveText("Publisere utkastet?");
    await expect(page.locator("#cascadePublishConfirmBtn")).toHaveText("Publiser utkastet");
    await expect(dialog(page).locator("[data-publish-audience='open']")).toBeVisible();
    expect(calls.audience).toEqual(["?draft=1"]);
    await page.locator("#cascadePublishCancelBtn").click();
    await expect(dialog(page)).toBeHidden();
    expect(draftPublish).toEqual([]);

    await publish.click();
    await page.locator("#cascadePublishConfirmBtn").click();
    await expect.poll(() => draftPublish.length).toBe(1);
    expect(draftPublish[0]).toMatchObject({ loaded: { draftId: "draft-1", revision: 2 } });
  });

  test("med versjonsspørsmål (lista endret, kursbevis): ÉN dialog, versjonen og hvem som ser kurset sammen", async ({ page }) => {
    const { draftPublish } = await draftCourse(page, RESTRICTED, { certificateHolders: 4, draftItems: ["mod-a", "mod-b"] });
    await page.goto(DETAIL);
    await page.locator('.form-page-actions [data-action="publish-draft"]').click();
    const versionDialog = page.locator("#courseVersionDialog");
    await expect(versionDialog).toBeVisible();
    // Synlig, ikke bare i DOM-en (mutasjonsprøven: et skjult avsnitt besto `toContainText`).
    await expect(versionDialog.locator("[data-publish-audience='restricted']")).toBeVisible();
    await expect(versionDialog.locator("[data-publish-audience='restricted']")).toContainText("Prosjektledere Bergen");
    // #1168: «Avpubliser» bruker de samme tallene med egne ord; her er det publiseringens.
    await expect(versionDialog.locator("[data-publish-audience='restricted'] h3")).toHaveText("Hvem ser kurset etterpå");
    await expect(versionDialog.locator("[data-publish-audience='restricted']")).toContainText("Bare de som er tildelt kurset:");
    await expect(dialog(page)).toBeHidden();
    await page.locator("#courseVersionSaveBtn").click();
    await expect.poll(() => draftPublish.length).toBe(1);
    expect(draftPublish[0]).toMatchObject({ version: "minor" });
  });
});

test.describe("#1164 nytt kurs er begrenset som standard", () => {
  test("«Nytt kurs»: synligheten står på «Begrenset», og lagringen sender det", async ({ page }) => {
    await mockCommonApis(page, { courses: [] });
    await locale(page, "nb");
    let created: Record<string, unknown> | null = null;
    await page.route("**/api/admin/content/courses", async (route: Route) => {
      if (route.request().method() !== "POST") return route.fallback();
      created = route.request().postDataJSON();
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ course: { ...COURSE, id: "course-new" } }) });
    });
    await page.goto("/admin-content/courses/new");
    await page.locator("#title-nb").fill("Nytt kurs");
    await page.locator("#certLevel").selectOption("basic");
    await page.locator("#formTab-innstillinger").click();
    await expect(page.locator("#enrollmentPolicy")).toHaveValue("RESTRICTED");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => created).not.toBeNull();
    expect(created).toMatchObject({ enrollmentPolicy: "RESTRICTED" });
  });
});
