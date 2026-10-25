import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// 2.101.0: «publiser alle nye versjoner» på kurssiden, med ETT revisjonssvar for alle modulene.
// Produkteier, 2026-10-25: etter «Oppdater dette kurset» måtte forfatteren inn i hver modul for å
// publisere. Nå spør kurssiden straks, og kan spørres igjen fra knappen i hodet.

const COURSE = "/admin-content/courses/course-1";

const item = (type: "MODULE" | "SECTION", id: string, extra: Record<string, unknown> = {}) => ({
  type, id, title: `Tittel ${id}`, versionId: `${id}-v2`, isNew: false, publishable: true, blockers: [], passedCount: 0, ...extra,
});

function pending(overrides: Record<string, unknown> = {}) {
  return {
    courseId: "course-1",
    items: [item("SECTION", "sec-1"), item("MODULE", "mod-1", { passedCount: 3 })],
    notOwnedItems: [],
    publishable: true,
    passedTotal: 3,
    modulesWithPasses: 1,
    ...overrides,
  };
}

async function mockPending(page: Page, responses: Array<Record<string, unknown>>) {
  let call = 0;
  await page.route("**/api/admin/content/courses/course-1/pending-versions", async (route: Route) => {
    const body = responses[Math.min(call, responses.length - 1)];
    call += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function capturePublish(page: Page, status = 200) {
  const sent: Array<Record<string, unknown>> = [];
  await page.route("**/api/admin/content/courses/course-1/publish-pending", async (route: Route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(status === 200 ? { publishedItems: [{ type: "SECTION", id: "sec-1" }, { type: "MODULE", id: "mod-1" }] } : { error: "pending_versions_changed" }),
    });
  });
  return sent;
}

test.describe("2.101.0 publiser alle nye versjoner i kurset", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommonApis(page, {
      courses: [{ id: "course-1", title: "Rapportskriving", description: null, certificationLevel: "basic", moduleCount: 1, updatedAt: "2026-10-11T12:00:00.000Z", publishedAt: "2026-10-11T12:00:00.000Z", archivedAt: null, modules: [] }],
      libraryModules: [],
    });
  });

  test("etter en kursoppdatering spør siden straks — noen har bestått: ett revisjonssvar, og det sendes med", async ({ page }) => {
    // Tre kall: sidens lasting, dialogens ferske oppslag, og sidens lasting etter publiseringen.
    await mockPending(page, [pending(), pending(), pending({ items: [], passedTotal: 0, modulesWithPasses: 0 })]);
    const sent = await capturePublish(page);
    await page.goto(`${COURSE}?publishPending=1`);

    const dialog = page.locator("#pendingPublishDialog");
    await expect(dialog).toBeVisible();
    // Flagget er borte fra adressen, så en omlasting ikke spør igjen.
    await expect(page).toHaveURL(/\/admin-content\/courses\/course-1$/);
    await expect(page.locator("#pendingPublishText")).toContainText("2 new version(s)");
    await expect(page.locator("#pendingPublishList")).toContainText("Tittel sec-1");
    await expect(page.locator("#pendingPublishList")).toContainText("Tittel mod-1");
    await expect(page.locator("#pendingPublishRevisionHeading")).toHaveText("Is this a revision?");
    await expect(page.locator("#pendingPublishRevisionBody")).toContainText("3 participant(s) have passed 1 of these modules");
    // Ingen nøytral «Publiser alle» når svaret er et valg.
    await expect(page.locator("#pendingPublishConfirmBtn")).toBeHidden();
    await expect(page.locator("#pendingPublishKeepBtn")).toBeVisible();
    await expect(page.locator("#pendingPublishSupersedeBtn")).toContainText("3 notified");

    await page.locator("#pendingPublishSupersedeBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ versionIds: ["sec-1-v2", "mod-1-v2"], supersedesEarlierPasses: true });
    await expect(dialog).toBeHidden();
    await expect(page.locator(".toast__message").first()).toContainText("2 new version(s) published");
    // Knappen i hodet er borte når ingenting ligger klar lenger.
    await expect(page.locator('[data-action="publish-pending"]')).toHaveCount(0);
  });

  test("«tidligere bestått gjelder fortsatt» sender false", async ({ page }) => {
    await mockPending(page, [pending()]);
    const sent = await capturePublish(page);
    await page.goto(`${COURSE}?publishPending=1`);
    await page.locator("#pendingPublishKeepBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ supersedesEarlierPasses: false });
  });

  test("ingen har bestått: «Publiser alle», uten revisjonsspørsmål og uten svar i kallet", async ({ page }) => {
    await mockPending(page, [pending({ items: [item("SECTION", "sec-1", { isNew: true })], passedTotal: 0, modulesWithPasses: 0 })]);
    const sent = await capturePublish(page);
    await page.goto(`${COURSE}?publishPending=1`);
    await expect(page.locator("#pendingPublishRevision")).toBeHidden();
    await expect(page.locator("#pendingPublishKeepBtn")).toBeHidden();
    // Et element som aldri er publisert, merkes «ny».
    await expect(page.locator("#pendingPublishList")).toContainText("Tittel sec-1 (new)");
    await page.locator("#pendingPublishConfirmBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ versionIds: ["sec-1-v2"] });
  });

  test("noe stopper: lista viser hva, og det finnes bare «Lukk»", async ({ page }) => {
    const blockers = [{ code: "translation_incomplete", message: "x", field: "bodyMarkdown", missingLocales: ["nn"] }];
    await mockPending(page, [pending({ publishable: false, items: [item("SECTION", "sec-1", { publishable: false, blockers }), item("MODULE", "mod-1")], notOwnedItems: [{ type: "MODULE", id: "mod-x", title: "Andres" }] })]);
    const sent = await capturePublish(page);
    await page.goto(`${COURSE}?publishPending=1`);
    await expect(page.locator("#pendingPublishTitle")).toHaveText("Cannot publish yet");
    await expect(page.locator("#pendingPublishList .is-blocked")).toContainText("nn");
    await expect(page.locator("#pendingPublishNotOwned")).toContainText("1 element(s)");
    await expect(page.locator("#pendingPublishConfirmBtn")).toBeHidden();
    await expect(page.locator("#pendingPublishKeepBtn")).toBeHidden();
    await expect(page.locator("#pendingPublishSupersedeBtn")).toBeHidden();
    await expect(page.locator("#pendingPublishCancelBtn")).toHaveText("Close");
    await page.locator("#pendingPublishCancelBtn").click();
    await expect(page.locator("#pendingPublishDialog")).toBeHidden();
    expect(sent).toHaveLength(0);
  });

  test("uten flagget spør ikke siden, men knappen i hodet åpner dialogen", async ({ page }) => {
    await mockPending(page, [pending()]);
    await page.goto(COURSE);
    const button = page.locator('[data-action="publish-pending"]');
    await expect(button).toHaveText("Publish new versions (2)");
    await expect(page.locator("#pendingPublishDialog")).toBeHidden();
    await button.click();
    await expect(page.locator("#pendingPublishDialog")).toBeVisible();
    await page.locator("#pendingPublishCancelBtn").click();
    await expect(page.locator("#pendingPublishDialog")).toBeHidden();
  });

  test("ingenting ligger klar: ingen knapp, og flagget åpner ingen dialog", async ({ page }) => {
    await mockPending(page, [pending({ items: [], passedTotal: 0, modulesWithPasses: 0 })]);
    await page.goto(`${COURSE}?publishPending=1`);
    await expect(page.locator('.form-page-actions [data-action="export"]')).toBeVisible();
    await expect(page.locator('[data-action="publish-pending"]')).toHaveCount(0);
    await expect(page.locator("#pendingPublishDialog")).toBeHidden();
  });

  test("har noe endret seg (409), vises lista på nytt med det som ligger klar nå", async ({ page }) => {
    await mockPending(page, [pending(), pending(), pending({ items: [item("SECTION", "sec-1"), item("MODULE", "mod-1", { passedCount: 3 }), item("MODULE", "mod-2")] })]);
    const sent = await capturePublish(page, 409);
    await page.goto(`${COURSE}?publishPending=1`);
    await page.locator("#pendingPublishKeepBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    await expect(page.locator(".toast__message").first()).toContainText("Something changed");
    await expect(page.locator("#pendingPublishDialog")).toBeVisible();
    await expect(page.locator("#pendingPublishList")).toContainText("Tittel mod-2");
    await expect(page.locator("#pendingPublishKeepBtn")).toBeEnabled();
  });
});
