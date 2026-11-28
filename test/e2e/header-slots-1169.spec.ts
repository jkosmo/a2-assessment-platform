import { expect, test, type Page, type Route } from "@playwright/test";
import { buildMockModuleExport, mockCommonApis } from "./admin-content-helpers.js";

// #1169 skive 2 (doc/DECISIONS.md, produkteier 26. og 28.11.2026, prototypen https://claude.ai/artifact/RuABRhvRBxfQwnzJ2jYMU8):
// hodet har faste plasser — Lagre/Avbryt · hovedhandlingen for tilstanden (fylt knapp) · (modul) innholdsverktøyene · «Mer», alltid,
// i fast rekkefølge (Eksporter · Erstatt fra fil · Forkast utkast · Avpubliser · Arkiver / Slett). På smal skjerm ligger modulens
// verktøy under «Mer», og menyen åpner mot høyre når den ellers ville gått ut av skjermen. Merkene: «Publisert · v2.1 · Nyere utkast».

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const nb = (page: Page) => page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ } });
const L3 = (text: string) => JSON.stringify({ nb: text, nn: text, "en-GB": text });

const actions = (page: Page) => page.locator(".form-page-actions .row-actions");
const primary = (page: Page) => actions(page).locator(":scope > .row-action-btn.is-primary");
const menu = (page: Page) => actions(page).locator(":scope > details.row-more .row-more-menu > .row-action-btn");
const visible = (page: Page) => actions(page).locator(":scope > .row-action-btn:not(.btn-save):not(.btn-cancel)");

async function openCourse(page: Page, course: Record<string, unknown>) {
  await mockCommonApis(page, { courses: [{ id: "course-1", title: "Informasjonssikkerhet", modules: [], ...course } as never] });
  await nb(page);
  await page.goto("/admin-content/courses/course-1");
  await page.locator("#title-nb").waitFor();
}

test.describe("#1169 — kursets hode", () => {
  test("publisert: ingen hovedhandling; «Mer» med Eksporter · Avpubliser · Arkiver", async ({ page }) => {
    await openCourse(page, { publishedAt: "2026-10-01T08:00:00.000Z", lifecycle: "published" });
    await expect(primary(page)).toHaveCount(0);
    await expect(visible(page)).toHaveCount(0);
    await expect(menu(page)).toHaveText(["Eksporter", "Avpubliser", "Arkiver"]);
  });

  test("arkivert: «Gjenopprett» som fylt knapp; «Mer» med Eksporter · Slett; ingen Lagre", async ({ page }) => {
    await openCourse(page, { publishedAt: null, archivedAt: "2026-10-05T08:00:00.000Z", lifecycle: "archived" });
    await expect(primary(page)).toHaveText(["Gjenopprett"]);
    await expect(menu(page)).toHaveText(["Eksporter", "Slett"]);
    await expect(page.locator("#formSaveBtn")).toHaveCount(0);
  });

  test("en annens kurs: bare «Mer» med Eksporter", async ({ page }) => {
    await openCourse(page, { publishedAt: "2026-10-01T08:00:00.000Z", lifecycle: "published", canManage: false });
    await expect(primary(page)).toHaveCount(0);
    await expect(menu(page)).toHaveText(["Eksporter"]);
  });

  test("et valg under «Mer» virker: Arkiver starter arkiveringen", async ({ page }) => {
    await openCourse(page, { publishedAt: "2026-10-01T08:00:00.000Z", lifecycle: "published" });
    await actions(page).locator("details.row-more > summary").click();
    // Arkiveringen kan spørre i nettleseren; svar nei, så testen ikke slutter med et åpent spørsmål.
    page.on("dialog", (d) => { void d.dismiss().catch(() => {}); });
    const archiving = page.waitForRequest((req) => req.url().includes("/courses/course-1/archive"));
    await actions(page).locator('.row-more-menu [data-action="archive"]').click();
    await archiving;
    // Menyen lukker seg etter et valg.
    await expect(actions(page).locator("details.row-more")).not.toHaveAttribute("open", "");
  });
});

async function openModule(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  const LIVE = { id: "v1", versionNo: 5, versionMajor: 2, versionMinor: 1, publishedAt: "2026-09-18T10:00:00.000Z" };
  const DRAFT = { id: "v2", versionNo: 6, versionMajor: null, versionMinor: null, publishedAt: null };
  const exp = buildMockModuleExport({ id: "m", title: "Phishing i praksis", moduleVersionId: "v2", activeVersionId: "v1" });
  Object.assign(exp.selectedConfiguration.moduleVersion, DRAFT);
  exp.versions.moduleVersions = [exp.selectedConfiguration.moduleVersion, { createdAt: "2026-09-18T09:00:00.000Z", ...LIVE }];
  await mockCommonApis(page, { modules: [{ id: "m", title: "Phishing i praksis" }], moduleExports: { m: exp } });
  await nb(page);
  await page.goto("/admin-content/module/m/conversation");
  await page.locator("#moduleFormHead .form-page-head").waitFor();
}

test.describe("#1169 — modulens hode", () => {
  test("publisert med nyere utkast, bred skjerm: «Publiser utkastet» fylt, verktøyene synlige, «Mer» i fast rekkefølge", async ({ page }) => {
    await openModule(page);
    await expect(primary(page)).toHaveText(["Publiser utkastet"]);
    await expect(actions(page).locator(':scope > [data-ws-key="generateContent"]')).toBeVisible();
    const items = await menu(page).allTextContents();
    expect(items.slice(0, 3)).toEqual(["Eksporter", "Erstatt fra fil", "Avpubliser"]);
    // Merkene: versjonen rett etter «Publisert», så «Nyere utkast».
    await expect(page.locator("#moduleFormHead .form-page-state")).toContainText(/Publisert\s*v2\.1\s*Nyere utkast/);
  });

  test("smal skjerm: verktøyene ligger først under «Mer», og menyen åpner innenfor skjermen", async ({ page }) => {
    await openModule(page, 390);
    await expect(primary(page)).toHaveText(["Publiser utkastet"]);
    await expect(actions(page).locator(':scope > [data-ws-key="generateContent"]')).toHaveCount(0);
    await expect(menu(page).first()).toHaveAttribute("data-ws-key", "generateContent");
    await actions(page).locator("details.row-more > summary").click();
    const box = await actions(page).locator(".row-more-menu").boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  });

  test("«Mer» brekker til en ny linje helt til venstre (320 px): menyen åpner mot høyre, innenfor skjermen", async ({ page }) => {
    await openModule(page, 320);
    const summary = actions(page).locator("details.row-more > summary");
    // Forutsetningen for tilfellet: «Mer» står så langt til venstre at en meny som henger fra høyre kant, ville gått ut.
    const sum = await summary.boundingBox();
    expect((sum?.x ?? 999) + (sum?.width ?? 0)).toBeLessThan(170);
    await summary.click();
    // Klassen settes når menyen åpnes (toggle-hendelsen); vent på den før menyen måles.
    await expect(actions(page).locator(".row-more-menu")).toHaveClass(/row-more-menu--start/);
    const box = await actions(page).locator(".row-more-menu").boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  });

  test("bredden endres: verktøyene flytter seg ut av «Mer» igjen", async ({ page }) => {
    await openModule(page, 390);
    await expect(actions(page).locator(':scope > [data-ws-key="generateContent"]')).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(actions(page).locator(':scope > [data-ws-key="generateContent"]')).toBeVisible();
  });
});

async function sectionBase(page: Page) {
  await nb(page);
  await page.route("**/participant/config", (r: Route) => r.fulfill(json({ authMode: "mock", navigation: { items: [], workspaceItems: [] }, identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } }, calibrationWorkspace: { accessRoles: [] } })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (r: Route) => r.fulfill(json({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/admin/content/sections/preview", (r: Route) => r.fulfill(json({ html: "<p>forhåndsvisning</p>" })));
  await page.route("**/api/admin/content/sections", (r: Route) => r.fulfill(json({ sections: [] })));
}

test.describe("#1169 — seksjonens hode", () => {
  test("publisert med nyere utkast: «Publiser utkastet» fylt; «Mer» med Eksporter · Erstatt fra fil · Avpubliser · Arkiver; Avpubliser virker", async ({ page }) => {
    await sectionBase(page);
    const sek = { id: "sec-x", title: L3("Grunnleggende prinsipper"), bodyMarkdown: L3("Tekst"), activeVersionId: "v1", archivedAt: null, hasUnpublishedChanges: true, versionNo: 2, publishedVersionNo: 1, assets: [], canManage: true, courses: [] };
    await page.route("**/api/admin/content/sections/sec-x", (r: Route) => r.fulfill(json({ section: sek })));
    const calls: string[] = [];
    await page.route("**/api/admin/content/sections/sec-x/unpublish", (r: Route) => { calls.push("unpublish"); return r.fulfill(json({ section: { ...sek, activeVersionId: null, hasUnpublishedChanges: false } })); });
    await page.goto("/admin-content/sections?id=sec-x");
    await expect(primary(page)).toHaveText(["Publiser utkastet"]);
    await expect(menu(page)).toHaveText(["Eksporter", "Erstatt fra fil", "Avpubliser", "Arkiver"]);
    await expect(page.locator(".form-page-state")).toContainText(/Publisert\s*v1\s*Nyere utkast/);
    page.on("dialog", (d) => d.accept());
    await actions(page).locator("details.row-more > summary").click();
    await page.locator("#sectionLifecycleBtn").click();
    await expect.poll(() => calls).toEqual(["unpublish"]);
  });

  test("aldri publisert: «Publiser» fylt", async ({ page }) => {
    await sectionBase(page);
    const sek = { id: "sec-y", title: L3("Ny seksjon"), bodyMarkdown: L3("Tekst"), activeVersionId: null, archivedAt: null, hasUnpublishedChanges: false, versionNo: 1, publishedVersionNo: null, assets: [], canManage: true, courses: [] };
    await page.route("**/api/admin/content/sections/sec-y", (r: Route) => r.fulfill(json({ section: sek })));
    await page.goto("/admin-content/sections?id=sec-y");
    await expect(primary(page)).toHaveText(["Publiser"]);
    await expect(menu(page)).toHaveText(["Eksporter", "Erstatt fra fil", "Arkiver"]);
  });
});

async function openClass(page: Page, klass: Record<string, unknown>) {
  await sectionBase(page);
  const k = { id: "cls-1", name: "Prosjektledere Bergen", description: null, isSystem: false, kind: "MANUAL", archivedAt: null, canManage: true, _count: { members: 0, courseAssignments: 0 }, ...klass };
  await page.route("**/api/admin/content/classes", (r: Route) => r.fulfill(json({ classes: [k] })));
  await page.route("**/api/admin/content/classes/*", (r: Route) => r.fulfill(json({ class: { ...k, lifecycle: k.archivedAt ? "archived" : "active" } })));
  await page.route("**/api/admin/content/classes/*/members**", (r: Route) => r.fulfill(json({ members: [] })));
  await page.route("**/api/admin/content/classes/*/courses**", (r: Route) => r.fulfill(json({ courses: [] })));
  await page.route("**/api/admin/content/courses", (r: Route) => r.fulfill(json({ courses: [] })));
  await page.route("**/api/admin/content-owners/CLASS/*", (r: Route) => r.fulfill(json({ owners: [], canManage: true })));
  await page.goto("/deltakere/klasser");
  // En arkivert klasse står under «Arkiverte» (lista viser «Aktive» først).
  if (k.archivedAt) await page.locator('.list-filter-btn[data-filter="archived"]').click();
  await page.locator('[data-action="open"][data-id="cls-1"]').click();
  await page.locator("#className").waitFor();
}

test.describe("#1169 — klassens hode", () => {
  test("aktiv: «Mer» med Arkiver, ingen hovedhandling", async ({ page }) => {
    await openClass(page, {});
    await expect(primary(page)).toHaveCount(0);
    await expect(menu(page)).toHaveText(["Arkiver"]);
  });

  // QA-porten 2.188.0: hodet tegnes på nytt når bredden krysser 700 px. Klassens lytter satt på det gamle elementet, så «Arkiver»
  // lukket menyen og gjorde ingenting etter at telefonen ble snudd.
  test("etter at bredden har krysset grensen, virker «Arkiver» under «Mer» fortsatt", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openClass(page, {});
    await page.setViewportSize({ width: 1280, height: 900 });
    await actions(page).locator("details.row-more > summary").click();
    await actions(page).locator('.row-more-menu [data-action="archive"]').click();
    // Arkiveringen spør først i en dialog på siden; at den åpnes, viser at klikket nådde fram.
    await expect(page.locator("dialog[open]")).toBeVisible();
  });

  test("arkivert: «Gjenopprett» fylt; «Mer» med Slett", async ({ page }) => {
    await openClass(page, { archivedAt: "2026-10-05T08:00:00.000Z" });
    await expect(primary(page)).toHaveText(["Gjenopprett"]);
    await expect(menu(page)).toHaveText(["Slett"]);
  });
});

test("listene: merkene står «Publisert · v2.1 · Nyere utkast»", async ({ page }) => {
  await mockCommonApis(page, {});
  await nb(page);
  await page.route("**/api/admin/content/courses", (r: Route) => r.fulfill(json({ courses: [
    { id: "k1", title: L3("Informasjonssikkerhet"), description: null, certificationLevel: "basic", enrollmentPolicy: "OPEN", moduleCount: 1, sortOrder: null, updatedAt: "2026-11-01T08:00:00.000Z", archivedAt: null, inProgressCount: 0, canManage: true, themes: [], publishedAt: "2026-10-01T08:00:00.000Z", lifecycle: "published_with_draft", versionMajor: 2, versionMinor: 1 },
  ] })));
  await page.goto("/admin-content/courses");
  await expect(page.locator('tr[data-row-id="k1"] td.col-status')).toContainText(/Publisert\s*v2\.1\s*Nyere utkast/);
});
