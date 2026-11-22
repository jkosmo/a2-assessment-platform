import { test, expect, type Page, type Route } from "@playwright/test";
import { revealRowAction } from "./admin-content-helpers.js";

// #1168, andre skive: «Arkiver» og «Gjenopprett» på en seksjon følger modulen (2.178.0) og kurset (#1150). Før spurte
// nettleserens spørreboks «Arkivere denne seksjonen?», og holdt et kurs seksjonen igjen, kom avslaget etterpå. Nå spør
// «Arkiver» tjeneren først (`GET …/sections/:id/archive-preview`) og viser enten kursene med lenker og uten bekreftknapp, eller
// hva som skjer, med en bekreftknapp. Ingenting sendes før forfatteren har sagt ja. Gjenopprett spør ikke, men sier at
// seksjonen kom tilbake som utkast. Begge stedene: lista og redigereren. (Slett: test/e2e/section-editor.spec.ts.)
//
// Tjenerens svar er etterlignet her. At forhåndsvisningen svarer det samme som sperren, festes i
// test/m2-section-archive-preview-1168.test.ts.

const TITLE = { nb: "Seksjon 1168", nn: "Seksjon 1168", "en-GB": "Section 1168" };
const ACTIVE_ID = "sec-1168";
const ARCHIVED_ID = "sec-1168-arkivert";
const ARCHIVED_TITLE = { nb: "Arkivert seksjon", nn: "Arkivert seksjon", "en-GB": "Archived section" };

const row = (id: string, archivedAt: string | null, title = TITLE) => ({
  id,
  title: JSON.stringify(title),
  bodyMarkdown: JSON.stringify({ nb: "Tekst", nn: "Tekst", "en-GB": "Text" }),
  activeVersionId: archivedAt ? null : "v1",
  versionNo: 1,
  updatedAt: "2026-11-01T00:00:00.000Z",
  archivedAt,
  courseCount: 0,
  courses: [],
  canManage: true,
});

type Calls = { archive: number; restore: number; previews: number; browserQuestions: string[] };

async function mockSections(page: Page, preview: { published: boolean; uses: object[] } = { published: true, uses: [] }): Promise<Calls> {
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.route("**/participant/config", (route: Route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } },
      calibrationWorkspace: { accessRoles: [] },
    }),
  }));
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }),
  }));
  const calls: Calls = { archive: 0, restore: 0, previews: 0, browserQuestions: [] };
  let activeArchived = false;
  await page.route("**/api/admin/content/sections", (route: Route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ sections: [row(ACTIVE_ID, activeArchived ? "2026-11-22T12:00:00.000Z" : null), row(ARCHIVED_ID, "2026-11-02T00:00:00.000Z", ARCHIVED_TITLE)] }),
  }));
  await page.route("**/api/admin/content/content-owners/**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners: [], canManageOwners: false }) }));
  await page.route("**/api/admin/content-owners/**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners: [], canManageOwners: false }) }));
  await page.route(`**/api/admin/content/sections/${ACTIVE_ID}/archive-preview`, (route: Route) => {
    calls.previews += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sectionId: ACTIVE_ID, archived: false, ...preview }) });
  });
  await page.route(`**/api/admin/content/sections/${ACTIVE_ID}/archive`, (route: Route) => {
    calls.archive += 1;
    activeArchived = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: row(ACTIVE_ID, "2026-11-22T12:00:00.000Z") }) });
  });
  await page.route(`**/api/admin/content/sections/${ARCHIVED_ID}/restore`, (route: Route) => {
    calls.restore += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: row(ARCHIVED_ID, null) }) });
  });
  for (const id of [ACTIVE_ID, ARCHIVED_ID]) {
    await page.route(`**/api/admin/content/sections/${id}`, (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const archivedAt = id === ARCHIVED_ID ? "2026-11-02T00:00:00.000Z" : (activeArchived ? "2026-11-22T12:00:00.000Z" : null);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: row(id, archivedAt, id === ARCHIVED_ID ? ARCHIVED_TITLE : TITLE) }) });
    });
  }
  await page.route("**/api/admin/content/sections/preview", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>Tekst</p>" }) }));
  // Nettleserens spørreboks skal ikke dukke opp. Gjør den det, sier testen nei, og ingenting sendes.
  page.on("dialog", (dialog) => { calls.browserQuestions.push(dialog.message()); void dialog.dismiss(); });
  return calls;
}

const dialog = (page: Page) => page.locator("#moduleLifecycleDialog");
const confirmBtn = (page: Page) => page.locator("#moduleLifecycleDialogConfirmBtn");
const cancelBtn = (page: Page) => page.locator("#moduleLifecycleDialogCancelBtn");

async function openList(page: Page) {
  await page.goto("/admin-content/sections");
  await expect(page.locator(`#sectionsTableBody [data-id="${ACTIVE_ID}"]`).first()).toBeAttached();
}

async function clickArchiveInList(page: Page) {
  await (await revealRowAction(page, page.locator(`#sectionsTableBody [data-action="archive"][data-id="${ACTIVE_ID}"]`))).click();
}

test.describe("#1168 — seksjonens livssyklus", () => {
  test("lista, sperret: kursene står med lenker, ingen bekreftknapp, ingenting arkiveres, og fokus går tilbake", async ({ page }) => {
    const calls = await mockSections(page, {
      published: true,
      uses: [
        { courseId: "kurs-a", title: "Kurs A", via: "course" },
        { courseId: "kurs-b", title: "Kurs B", via: "draft" },
      ],
    });
    await openList(page);
    await clickArchiveInList(page);

    await expect(dialog(page)).toHaveAttribute("data-module-dialog", "archive-blocked");
    await expect(page.locator("#moduleLifecycleDialogTitle")).toHaveText("Arkiver «Seksjon 1168»");
    await expect(page.locator("#moduleLifecycleDialogText")).toHaveText("Seksjonen er i bruk i 2 kurs. Ta den ut av kursene først, så kan den arkiveres.");
    const links = dialog(page).locator('[data-lifecycle-part="usedIn"] a');
    await expect(links).toHaveText(["Kurs A", "Kurs B"]);
    await expect(links.first()).toHaveAttribute("href", "/admin-content/courses/kurs-a");
    await expect(dialog(page).locator('[data-course-id="kurs-b"]')).toContainText("bare i kursets lagrede utkast");
    await expect(confirmBtn(page)).toBeHidden();
    await expect(cancelBtn(page)).toHaveText("Lukk");

    await cancelBtn(page).click();
    await expect(dialog(page)).toBeHidden();
    expect(calls).toMatchObject({ previews: 1, archive: 0, browserQuestions: [] });
    const focusOk = await page.evaluate((id) => {
      const button = document.querySelector(`#sectionsTableBody [data-action="archive"][data-id="${id}"]`);
      const menu = button?.closest("details.row-more");
      return document.activeElement === (menu ? menu.querySelector("summary") : button);
    }, ACTIVE_ID);
    expect(focusOk, "fokus tilbake til knappen eller «Mer» i samme rad").toBe(true);
  });

  test("lista, publisert: dialogen sier hva som skjer; Avbryt sender ingenting, bekreft arkiverer én gang", async ({ page }) => {
    const calls = await mockSections(page, { published: true, uses: [] });
    await openList(page);
    await clickArchiveInList(page);

    await expect(dialog(page)).toHaveAttribute("data-module-dialog", "archive");
    await expect(page.locator("#moduleLifecycleDialogText")).toHaveText("Seksjonen forsvinner fra de aktive i lista og kan ikke legges inn i kurs. Du kan gjenopprette den senere.");
    await expect(dialog(page).locator('[data-lifecycle-part="unpublishes"]')).toHaveText("Den avpubliseres også.");
    await expect(confirmBtn(page)).toHaveText("Arkiver seksjonen");
    await expect(cancelBtn(page)).toBeFocused();
    await cancelBtn(page).click();
    expect(calls.archive).toBe(0);

    await clickArchiveInList(page);
    await confirmBtn(page).click();
    await expect.poll(() => calls.archive).toBe(1);
    await expect(page.locator(".toast__message")).toHaveText("Seksjon arkivert.");
    expect(calls).toMatchObject({ previews: 2, browserQuestions: [] });
  });

  test("KONTROLL: en upublisert seksjon får ikke linja om avpublisering", async ({ page }) => {
    await mockSections(page, { published: false, uses: [] });
    await openList(page);
    await clickArchiveInList(page);
    await expect(dialog(page)).toHaveAttribute("data-module-dialog", "archive");
    await expect(dialog(page).locator('[data-lifecycle-part="unpublishes"]')).toHaveCount(0);
    await expect(confirmBtn(page)).toBeVisible();
  });

  test("lista: Gjenopprett spør ikke, og sier at seksjonen kom tilbake som utkast", async ({ page }) => {
    const calls = await mockSections(page);
    await openList(page);
    await page.locator('.list-filter-btn[data-filter="archived"]').click();
    await (await revealRowAction(page, page.locator(`#sectionsTableBody [data-action="restore"][data-id="${ARCHIVED_ID}"]`))).click();
    await expect.poll(() => calls.restore).toBe(1);
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator(".toast__message")).toHaveText("«Arkivert seksjon» er gjenopprettet som utkast. Publiser den når du er klar.");
    expect(calls.browserQuestions).toEqual([]);
  });

  test("redigereren, sperret: samme dialog med kursene; ingenting arkiveres", async ({ page }) => {
    const calls = await mockSections(page, { published: true, uses: [{ courseId: "kurs-a", title: "Kurs A", via: "course" }] });
    await page.goto(`/admin-content/sections?id=${ACTIVE_ID}`);
    await expect(page.locator("#titleInput")).toBeVisible();
    await (await revealRowAction(page, page.locator('.form-page-actions [data-editor-action="archive"]'))).click();

    await expect(dialog(page)).toHaveAttribute("data-module-dialog", "archive-blocked");
    await expect(page.locator("#moduleLifecycleDialogTitle")).toHaveText("Arkiver «Seksjon 1168»");
    await expect(page.locator("#moduleLifecycleDialogText")).toHaveText("Seksjonen er i bruk i 1 kurs. Ta den ut av kurset først, så kan den arkiveres.");
    await cancelBtn(page).click();
    expect(calls).toMatchObject({ previews: 1, archive: 0, browserQuestions: [] });
  });

  test("redigereren: bekreft arkiverer én gang, og hodet viser Gjenopprett etterpå", async ({ page }) => {
    const calls = await mockSections(page, { published: true, uses: [] });
    await page.goto(`/admin-content/sections?id=${ACTIVE_ID}`);
    await expect(page.locator("#titleInput")).toBeVisible();
    await (await revealRowAction(page, page.locator('.form-page-actions [data-editor-action="archive"]'))).click();
    await expect(dialog(page)).toHaveAttribute("data-module-dialog", "archive");
    await confirmBtn(page).click();
    await expect.poll(() => calls.archive).toBe(1);
    await expect(page.locator(".toast__message")).toHaveText("Seksjon arkivert.");
    await expect(page.locator('.form-page-actions [data-editor-action="restore"]')).toBeAttached();
    expect(calls.browserQuestions).toEqual([]);
  });

  test("redigereren: «Gjenopprett» som blir ferdig etter at forfatteren har åpnet en annen seksjon, navngir den riktige (QA 2.179.0)", async ({ page }) => {
    const calls = await mockSections(page);
    // Gjenopprettingen holdes tilbake til forfatteren har åpnet den andre seksjonen.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**/api/admin/content/sections/${ARCHIVED_ID}/restore`, async (route: Route) => {
      calls.restore += 1;
      await gate;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: row(ARCHIVED_ID, null) }) });
    });
    // Inne i sida (lista → redigereren → tilbake → den andre), som i section-jobs-stay-in-their-section-1154: en ny `goto` ville
    // lastet sida på nytt, og svaret fra den første ville aldri kommet fram.
    await openList(page);
    await page.locator('.list-filter-btn[data-filter="archived"]').click();
    await page.locator(`[data-action="edit"][data-id="${ARCHIVED_ID}"]`).click();
    await expect(page.locator("#titleInput")).toHaveValue("Arkivert seksjon");
    await (await revealRowAction(page, page.locator('.form-page-actions [data-editor-action="restore"]'))).click();
    await expect.poll(() => calls.restore).toBe(1);

    await page.goBack();
    await page.locator('.list-filter-btn[data-filter="active"]').click().catch(() => {});
    await page.locator(`[data-action="edit"][data-id="${ACTIVE_ID}"]`).click();
    await expect(page.locator("#titleInput")).toHaveValue("Seksjon 1168");
    release();
    // Meldingen navngir seksjonen som ble gjenopprettet, ikke den som vises nå.
    await expect(page.locator(".toast__message")).toHaveText("«Arkivert seksjon» er gjenopprettet som utkast. Publiser den når du er klar.");
  });

  test("390 px: den sperrede dialogen passer, og sida ruller ikke vannrett", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSections(page, {
      published: true,
      uses: [{ courseId: "kurs-a", title: "Et kurs med et svært langt navn som må brytes over flere linjer på en liten skjerm", via: "draft" }],
    });
    await openList(page);
    await clickArchiveInList(page);
    await expect(dialog(page)).toBeVisible();
    const box = await dialog(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
