import { test, expect, type Page, type Route } from "@playwright/test";
import { mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

// #1168: «Arkiver», «Gjenopprett» og «Slett» på en modul i biblioteket følger kursets mønster (#1150). Arkiver spør tjeneren
// først (`GET …/archive-preview`) og viser enten kursene som holder modulen igjen, med lenker og uten bekreftknapp, eller hva
// som skjer, med en bekreftknapp. Ingenting sendes før forfatteren har sagt ja. Slett har sidas egen dialog i stedet for
// nettleserens spørreboks. Gjenopprett spør ikke, men sier at modulen kom tilbake som utkast.
//
// Tjenerens svar er etterlignet her. At forhåndsvisningen svarer det samme som sperren, festes i
// test/m2-module-archive-preview-1168.test.ts.

const ACTIVE = { id: "module-1168", title: "Modul 1168", status: "published", courseCount: 1, courses: [] };
const ARCHIVED = { id: "module-1168-arkivert", title: "Arkivert modul 1168", status: "archived", courseCount: 0, courses: [] };

type Calls = { archive: number; restore: number; del: number; previews: number };

async function openLibrary(page: Page, preview: { published: boolean; uses: object[] } = { published: true, uses: [] }): Promise<Calls> {
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await mockCommonApis(page, { libraryModules: [ACTIVE, ARCHIVED] });
  const calls: Calls = { archive: 0, restore: 0, del: 0, previews: 0 };
  await page.route(`**/api/admin/content/modules/${ACTIVE.id}/archive-preview`, (route: Route) => {
    calls.previews += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ moduleId: ACTIVE.id, archived: false, ...preview }) });
  });
  await page.route(`**/api/admin/content/modules/${ACTIVE.id}/archive`, (route: Route) => {
    calls.archive += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ moduleId: ACTIVE.id, archivedAt: "2026-11-22T12:00:00.000Z" }) });
  });
  await page.route(`**/api/admin/content/modules/${ARCHIVED.id}/restore`, (route: Route) => {
    calls.restore += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ moduleId: ARCHIVED.id }) });
  });
  await page.route(`**/api/admin/content/modules/${ARCHIVED.id}`, (route: Route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    calls.del += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ deletedModule: { id: ARCHIVED.id } }) });
  });
  // Nettleserens spørreboks skal ikke dukke opp. Gjør den det, sier testen nei, og ingenting sendes.
  page.on("dialog", (dialog) => void dialog.dismiss());
  await page.goto("/admin-content-library.html");
  await expect(page.locator(".list-table tbody tr", { hasText: ACTIVE.title })).toHaveCount(1);
  return calls;
}

const dialog = (page: Page) => page.locator("#moduleLifecycleDialog");
const confirmBtn = (page: Page) => page.locator("#moduleLifecycleDialogConfirmBtn");
const cancelBtn = (page: Page) => page.locator("#moduleLifecycleDialogCancelBtn");

async function clickArchive(page: Page) {
  await (await revealRowAction(page, page.locator(`[data-action="archive"][data-module-id="${ACTIVE.id}"]`))).click();
}

async function showArchived(page: Page) {
  await page.locator('.list-filter-btn[data-filter="archived"]').click();
  await expect(page.locator(".list-table tbody tr", { hasText: ARCHIVED.title })).toHaveCount(1);
}

test.describe("#1168 — modulens livssyklus i biblioteket", () => {
  test("Arkiver, sperret: kursene står med lenker, ingen bekreftknapp, og ingenting arkiveres", async ({ page }) => {
    const calls = await openLibrary(page, {
      published: true,
      uses: [
        { courseId: "kurs-a", title: "Kurs A", via: "course" },
        { courseId: "kurs-b", title: "Kurs B", via: "draft" },
      ],
    });
    await clickArchive(page);

    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAttribute("data-module-dialog", "archive-blocked");
    await expect(page.locator("#moduleLifecycleDialogTitle")).toHaveText("Arkiver «Modul 1168»");
    await expect(page.locator("#moduleLifecycleDialogText")).toHaveText("Modulen er i bruk i 2 kurs. Ta den ut av kursene først, så kan den arkiveres.");
    const links = dialog(page).locator('[data-lifecycle-part="usedIn"] a');
    await expect(links).toHaveText(["Kurs A", "Kurs B"]);
    await expect(links.first()).toHaveAttribute("href", "/admin-content/courses/kurs-a");
    await expect(dialog(page).locator('[data-course-id="kurs-b"]')).toContainText("bare i kursets lagrede utkast");
    await expect(dialog(page).locator('[data-course-id="kurs-a"]')).not.toContainText("utkast");
    await expect(confirmBtn(page)).toBeHidden();
    await expect(cancelBtn(page)).toHaveText("Lukk");
    await page.screenshot({ path: "test-results/1168-arkiver-sperret-1280.png" });

    await cancelBtn(page).click();
    await expect(dialog(page)).toBeHidden();
    expect(calls).toMatchObject({ previews: 1, archive: 0 });
    // Fokus tilbake til knappen som åpnet dialogen, eller til «Mer» i samme rad når knappen står i den menyen.
    const focus = await page.evaluate((id) => {
      const button = document.querySelector(`[data-action="archive"][data-module-id="${id}"]`);
      const menu = button?.closest("details.row-more");
      const expected = menu ? menu.querySelector("summary") : button;
      return { ok: document.activeElement === expected, inMenu: Boolean(menu) };
    }, ACTIVE.id);
    expect(focus.ok, `fokus (knappen i «Mer»: ${focus.inMenu})`).toBe(true);
  });

  test("Arkiver, publisert modul: dialogen sier hva som skjer; Avbryt sender ingenting, bekreft arkiverer én gang", async ({ page }) => {
    const calls = await openLibrary(page, { published: true, uses: [] });
    await clickArchive(page);

    await expect(dialog(page)).toHaveAttribute("data-module-dialog", "archive");
    await expect(page.locator("#moduleLifecycleDialogText")).toHaveText(
      "Modulen forsvinner fra de aktive i lista og kan ikke legges inn i kurs. Deltakerne beholder besvarelsene og resultatene sine. Du kan gjenopprette den senere.",
    );
    await expect(dialog(page).locator('[data-lifecycle-part="unpublishes"]')).toHaveText("Den avpubliseres også, så ingen kan levere nye besvarelser.");
    await expect(confirmBtn(page)).toHaveText("Arkiver modulen");
    // Avbryt har fokus fra start: Enter skal ikke arkivere ved et uhell.
    await expect(cancelBtn(page)).toBeFocused();

    await cancelBtn(page).click();
    await expect(dialog(page)).toBeHidden();
    expect(calls.archive).toBe(0);

    await clickArchive(page);
    await confirmBtn(page).click();
    await expect.poll(() => calls.archive).toBe(1);
    await expect(page.locator(".toast__message")).toHaveText("Modul arkivert.");
    expect(calls.previews).toBe(2);
  });

  test("KONTROLL: en upublisert modul får ikke linja om avpublisering", async ({ page }) => {
    await openLibrary(page, { published: false, uses: [] });
    await clickArchive(page);
    await expect(dialog(page)).toHaveAttribute("data-module-dialog", "archive");
    await expect(dialog(page).locator('[data-lifecycle-part="unpublishes"]')).toHaveCount(0);
    await expect(confirmBtn(page)).toBeVisible();
  });

  test("Gjenopprett spør ikke, og sier at modulen kom tilbake som utkast", async ({ page }) => {
    const calls = await openLibrary(page);
    await showArchived(page);
    await (await revealRowAction(page, page.locator(`[data-action="restore"][data-module-id="${ARCHIVED.id}"]`))).click();
    await expect.poll(() => calls.restore).toBe(1);
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator(".toast__message")).toHaveText("«Arkivert modul 1168» er gjenopprettet som utkast. Publiser den når du er klar.");
  });

  test("Slett: sidas dialog; Avbryt sender ingenting, bekreft sletter én gang", async ({ page }) => {
    const calls = await openLibrary(page);
    await showArchived(page);
    const deleteBtn = async () => revealRowAction(page, page.locator(`[data-action="delete"][data-module-id="${ARCHIVED.id}"]`));

    await (await deleteBtn()).click();
    await expect(dialog(page)).toHaveAttribute("data-module-dialog", "delete");
    await expect(page.locator("#moduleLifecycleDialogTitle")).toHaveText("Slett «Arkivert modul 1168»");
    await expect(confirmBtn(page)).toHaveText("Slett modulen");
    await expect(confirmBtn(page)).toHaveClass(/btn-danger/);
    await cancelBtn(page).click();
    expect(calls.del).toBe(0);

    await (await deleteBtn()).click();
    await confirmBtn(page).click();
    await expect.poll(() => calls.del).toBe(1);
  });

  test("390 px: den sperrede dialogen passer, og sida ruller ikke vannrett", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page, {
      published: true,
      uses: [{ courseId: "kurs-a", title: "Et kurs med et svært langt navn som må brytes over flere linjer på en liten skjerm", via: "draft" }],
    });
    await clickArchive(page);
    await expect(dialog(page)).toBeVisible();
    // Ett kurs: entall (QA 2.178.0).
    await expect(page.locator("#moduleLifecycleDialogText")).toHaveText("Modulen er i bruk i 1 kurs. Ta den ut av kurset først, så kan den arkiveres.");
    const box = await dialog(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "test-results/1168-arkiver-sperret-390.png" });
  });
});
