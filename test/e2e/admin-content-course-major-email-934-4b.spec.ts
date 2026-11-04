import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// #934 skive 4b: en hovedversjon sender e-post til deltakere med kursbevis (doc/DESIGN_934.md, «4b»). Dialogene viser
// hvor mange (`majorEmailRecipients`, fra samme funksjon som lager e-postradene). Over 200 krever et ekstra «ja», og
// klienten sender tallet den viste (`confirmEmailRecipients`) — uten det sendes ingenting.

const COURSE = "/admin-content/courses/course-1";

const ITEMS = [
  { id: "ci-1", type: "MODULE", sortOrder: 0, moduleId: "mod-a", sectionId: null, title: "Modul A", discussionsEnabled: true, archivedAt: null },
  { id: "ci-2", type: "SECTION", sortOrder: 1, moduleId: null, sectionId: "sec-b", title: "Seksjon B", discussionsEnabled: true, archivedAt: null },
];

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
    modules: [],
    versionMajor: 3,
    versionMinor: 1,
    certificateHolders: 10,
    majorEmailRecipients: 12,
    contentRevision: 5,
    ...overrides,
  };
}

async function nb(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

async function openCourse(page: Page, overrides: Record<string, unknown> = {}, contentStatus = 200) {
  await mockCommonApis(page, { courses: [course(overrides) as never], libraryModules: [] });
  await nb(page);
  const sent: Array<Record<string, unknown>> = [];
  await page.route("**/api/admin/content/courses/*/items", async (route: Route) => {
    if (route.request().method() === "PUT") return route.fulfill({ status: 204, body: "" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: ITEMS }) });
  });
  await page.route("**/api/admin/content/courses/course-1/content", async (route: Route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    if (contentStatus === 409) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "major_email_confirm_required", message: "x", details: { majorEmailRecipients: 251 } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "course-1" } }) });
  });
  await page.goto(COURSE);
  await expect(page.locator("#moduleList li")).toHaveCount(2);
  return sent;
}

async function askMajor(page: Page) {
  await page.locator('[data-move="down"][data-index="0"]').click();
  await page.locator("#formSaveBtn").click();
  const dialog = page.locator("#courseVersionDialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[value="major"]').check();
  return dialog;
}

test.describe("#934 skive 4b — kursskjemaet", () => {
  test("hovedversjon: dialogen sier hvor mange som får e-post, og kallet sender tallet", async ({ page }) => {
    const sent = await openCourse(page);
    const dialog = await askMajor(page);
    const konsekvens = dialog.locator("[data-version-consequence]");
    await expect(konsekvens).toContainText("12 deltakere får en e-post om versjon 4.0.");
    // Under 200: ikke noe ekstra «ja».
    await expect(konsekvens.locator("[data-email-confirm]")).toHaveCount(0);
    // Mindre versjon: ingen e-post nevnt.
    await dialog.locator('input[value="minor"]').check();
    await expect(konsekvens).not.toContainText("e-post");
    await dialog.locator('input[value="major"]').check();
    await page.locator("#courseVersionSaveBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ version: "major", confirmEmailRecipients: 12 });
  });

  test("én mottaker i entall", async ({ page }) => {
    await openCourse(page, { majorEmailRecipients: 1 });
    const dialog = await askMajor(page);
    await expect(dialog.locator("[data-version-consequence]")).toContainText("1 deltaker får en e-post om versjon 4.0.");
  });

  test("mindre versjon sender ikke tallet", async ({ page }) => {
    const sent = await openCourse(page);
    await page.locator('[data-move="down"][data-index="0"]').click();
    await page.locator("#formSaveBtn").click();
    await page.locator("#courseVersionSaveBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ version: "minor" });
    expect(sent[0]).not.toHaveProperty("confirmEmailRecipients");
  });

  test("over 200: uten det ekstra «ja» lagres ingenting, og dialogen sier hvorfor; med det sendes tallet", async ({ page }) => {
    const sent = await openCourse(page, { majorEmailRecipients: 250 });
    const dialog = await askMajor(page);
    const konsekvens = dialog.locator("[data-version-consequence]");
    await expect(konsekvens).toContainText("250 deltakere får en e-post om versjon 4.0.");
    const ja = konsekvens.locator("[data-email-confirm]");
    await expect(ja).not.toBeChecked();
    await expect(konsekvens).toContainText("Ja, send e-posten til 250 deltakere.");

    await page.locator("#courseVersionSaveBtn").click();
    await expect(dialog).toBeVisible();
    await expect(konsekvens.locator("[data-email-confirm-missing]")).toBeVisible();
    await expect(konsekvens.locator("[data-email-confirm-missing]")).toHaveText("Kryss av for å sende e-posten til 250 deltakere, eller velg mindre versjon.");
    await expect(ja).toBeFocused();
    expect(sent).toHaveLength(0);

    await ja.check();
    await page.locator("#courseVersionSaveBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ version: "major", confirmEmailRecipients: 250 });
    await expect(dialog).toBeHidden();
  });

  test("over 200, men mindre versjon: ingen bekreftelse trengs", async ({ page }) => {
    const sent = await openCourse(page, { majorEmailRecipients: 250 });
    await page.locator('[data-move="down"][data-index="0"]').click();
    await page.locator("#formSaveBtn").click();
    await page.locator("#courseVersionSaveBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ version: "minor" });
  });

  test("tallet endret seg på serveren (409): feilen sier hva forfatteren skal gjøre", async ({ page }) => {
    await openCourse(page, { majorEmailRecipients: 250 }, 409);
    const dialog = await askMajor(page);
    await dialog.locator("[data-email-confirm]").check();
    await page.locator("#courseVersionSaveBtn").click();
    await expect(page.locator("#formErrorBanner")).toContainText("Last siden på nytt og bekreft tallet i dialogen");
  });

  test("390 px: dialogen med det ekstra «ja» flyter ikke over", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCourse(page, { majorEmailRecipients: 1250, title: { "en-GB": "Et svært langt kursnavn som går over flere linjer på en liten skjerm", nb: "Et svært langt kursnavn som går over flere linjer på en liten skjerm", nn: "x" } });
    const dialog = await askMajor(page);
    await expect(dialog.locator("[data-email-confirm]")).toBeVisible();
    const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await dialog.locator(".course-version-email-confirm").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});

test.describe("#934 skive 4b — «Publiser kurs» og «Publiser nye versjoner»", () => {
  async function cascade(page: Page, courseInfo: Record<string, unknown>) {
    await mockCommonApis(page, { courses: [course({ publishedAt: null }) as never], libraryModules: [] });
    await nb(page);
    await page.route("**/api/admin/content/courses/*/publish-preview", (route: Route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courseId: "course-1",
        allPublished: false,
        publishable: true,
        unpublishedItems: [{ type: "SECTION", id: "sec-1", title: "Kilder", publishable: true, blockers: [] }],
        course: courseInfo,
      }),
    }));
    const sent: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/courses/course-1/publish", async (route: Route) => {
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "course-1" }, publishedItems: [] }) });
    });
    await page.goto("/admin-content/courses");
    await page.locator('tr[data-row-id="course-1"] [data-action="publish"], #coursesTableBody tr [data-action="publish"]').first().click();
    await expect(page.locator("#cascadePublishDialog")).toBeVisible();
    return sent;
  }

  test("«Publiser kurs», over 200: dialogen står til det ekstra «ja» er gitt, og sender så tallet", async ({ page }) => {
    const sent = await cascade(page, { published: false, versionMajor: 3, versionMinor: 1, certificateHolders: 240, majorEmailRecipients: 240 });
    const block = page.locator("#cascadePublishVersion");
    await block.locator('input[value="major"]').check();
    await expect(block).toContainText("240 deltakere får en e-post om versjon 4.0.");
    await page.locator("#cascadePublishConfirmBtn").click();
    await expect(page.locator("#cascadePublishDialog")).toBeVisible();
    await expect(block.locator("[data-email-confirm-missing]")).toBeVisible();
    expect(sent).toHaveLength(0);
    await block.locator("[data-email-confirm]").check();
    await page.locator("#cascadePublishConfirmBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ publishItems: true, courseVersion: "major", confirmEmailRecipients: 240 });
  });

  test("«Publiser nye versjoner», over 200: samme regel", async ({ page }) => {
    await mockCommonApis(page, { courses: [course() as never], libraryModules: [] });
    await nb(page);
    await page.route("**/api/admin/content/courses/course-1/pending-versions", (route: Route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courseId: "course-1",
        items: [{ type: "SECTION", id: "sec-1", title: "Kilder", versionId: "sec-1-v2", isNew: false, publishable: true, blockers: [], passedCount: 0 }],
        notOwnedItems: [],
        publishable: true,
        passedTotal: 0,
        modulesWithPasses: 0,
        course: { published: true, versionMajor: 3, versionMinor: 1, certificateHolders: 300, majorEmailRecipients: 301 },
      }),
    }));
    const sent: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/courses/course-1/publish-pending", async (route: Route) => {
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ publishedItems: [{ type: "SECTION", id: "sec-1" }], version: null }) });
    });
    await page.goto(`${COURSE}?publishPending=1`);
    await expect(page.locator("#pendingPublishDialog")).toBeVisible();
    const block = page.locator("#pendingPublishVersion");
    await block.locator('input[value="major"]').check();
    await expect(block).toContainText("301 deltakere får en e-post om versjon 4.0.");
    await page.locator("#pendingPublishConfirmBtn").click();
    await expect(page.locator("#pendingPublishDialog")).toBeVisible();
    await expect(page.locator("#pendingPublishConfirmBtn")).toBeEnabled();
    expect(sent).toHaveLength(0);
    await block.locator("[data-email-confirm]").check();
    await page.locator("#pendingPublishConfirmBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ versionIds: ["sec-1-v2"], courseVersion: "major", confirmEmailRecipients: 301 });
  });
});
