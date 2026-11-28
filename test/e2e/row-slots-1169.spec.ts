import { expect, test, type Page, type Route } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #1169 skive 3 (doc/DECISIONS.md, produkteier 26. og 28.11.2026; prototypen https://claude.ai/artifact/RuABRhvRBxfQwnzJ2jYMU8):
// radene i de fire listene har hodets regel — Åpne · hovedhandlingen for tilstanden (Publiser, Publiser utkastet, Gjenopprett) ·
// «Mer» i fast rekkefølge (Døp om · Dupliser · Eksporter · Avpubliser · Arkiver / Slett) · «Kun for eier». «Slett» står nå også i
// seksjonslista for en arkivert seksjon, og heter «Slett» som ellers. En klasse leseren ikke eier, har ingen «Mer».

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const nb = (page: Page) => page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ } });
const L3 = (text: string) => JSON.stringify({ nb: text, nn: text, "en-GB": text });

const row = (page: Page, id: string) => page.locator(`tr[data-row-id="${id}"] .row-actions`);
const visible = (page: Page, id: string) => row(page, id).locator(":scope > .row-action-btn");
const menu = (page: Page, id: string) => row(page, id).locator(":scope > details.row-more .row-more-menu > .row-action-btn");

async function base(page: Page) {
  await nb(page);
  await page.route("**/participant/config", (r: Route) => r.fulfill(json({ authMode: "mock", navigation: { items: [], workspaceItems: [] }, identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } }, calibrationWorkspace: { accessRoles: [] } })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (r: Route) => r.fulfill(json({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } })));
}

test("kurslista: Åpne · hovedhandlingen · «Mer» i fast rekkefølge", async ({ page }) => {
  await mockCommonApis(page, {});
  await nb(page);
  const k = (id: string, navn: string, extra: Record<string, unknown>) => ({ id, title: L3(navn), description: null, certificationLevel: "basic", enrollmentPolicy: "OPEN", moduleCount: 2, sortOrder: null, updatedAt: "2026-11-01T08:00:00.000Z", archivedAt: null, inProgressCount: 0, canManage: true, themes: [], versionMajor: 2, versionMinor: 1, ...extra });
  await page.route("**/api/admin/content/courses", (r: Route) => r.fulfill(json({ courses: [
    k("k-pub", "Publisert kurs", { publishedAt: "2026-10-01T08:00:00.000Z", lifecycle: "published" }),
    k("k-utk", "Utkastkurs", { publishedAt: null, lifecycle: "draft", versionMajor: 1, versionMinor: 0 }),
    k("k-annen", "Andres kurs", { publishedAt: "2026-10-01T08:00:00.000Z", lifecycle: "published", canManage: false }),
  ] })));
  await page.goto("/admin-content/courses");
  await expect(visible(page, "k-pub")).toHaveText(["Åpne"]);
  await expect(menu(page, "k-pub")).toHaveText(["Dupliser", "Eksporter", "Avpubliser", "Arkiver"]);
  await expect(visible(page, "k-utk")).toHaveText(["Åpne", "Publiser"]);
  await expect(menu(page, "k-utk")).toHaveText(["Dupliser", "Eksporter", "Arkiver"]);
  await expect(visible(page, "k-annen")).toHaveText(["Åpne"]);
  await expect(menu(page, "k-annen")).toHaveText(["Dupliser", "Eksporter"]);
  await expect(row(page, "k-annen").locator(":scope > .row-readonly-note")).toHaveText("Kun for eier");
  // Hovedhandlingen i en rad er ikke fylt (prototypen): en fylt knapp i hver rad ville ikke skilt noe ut.
  await expect(page.locator(".list-table .row-action-btn.is-primary")).toHaveCount(0);
});

test("kurslista, arkivert: Åpne · Gjenopprett; «Mer» med Eksporter · Slett", async ({ page }) => {
  await mockCommonApis(page, {});
  await nb(page);
  const course = { id: "k-ark", title: L3("Arkivert kurs"), description: null, certificationLevel: "basic", enrollmentPolicy: "OPEN", moduleCount: 2, sortOrder: null, updatedAt: "2026-11-01T08:00:00.000Z", archivedAt: "2026-10-05T08:00:00.000Z", inProgressCount: 0, canManage: true, themes: [], publishedAt: null, lifecycle: "archived", versionMajor: 2, versionMinor: 1 };
  await page.route(/\/api\/admin\/content\/courses(\?.*)?$/, (r: Route) => r.fulfill(json({ courses: [course] })));
  await page.goto("/admin-content/courses");
  await page.locator('.list-filter-btn[data-filter="archived"]').click();
  await expect(visible(page, "k-ark")).toHaveText(["Åpne", "Gjenopprett"]);
  await expect(menu(page, "k-ark")).toHaveText(["Eksporter", "Slett"]);
});

test("modullista: Åpne; «Mer» med Døp om · Dupliser · Eksporter · Avpubliser · Arkiver; en annens modul har Dupliser · Eksporter og «Kun for eier»", async ({ page }) => {
  await mockCommonApis(page, { libraryModules: [
    { id: "m-pub", title: "Phishing i praksis", status: "published", activeVersionNo: 3, activeVersionMajor: 1, activeVersionMinor: 2 },
    { id: "m-annen", title: "Hendelseshåndtering", status: "published", activeVersionNo: 2, activeVersionMajor: 1, activeVersionMinor: 0, canManage: false },
  ] as never });
  await nb(page);
  await page.goto("/admin-content");
  await expect(visible(page, "m-pub")).toHaveText(["Åpne"]);
  await expect(menu(page, "m-pub")).toHaveText(["Døp om", "Dupliser", "Eksporter", "Avpubliser", "Arkiver"]);
  await expect(visible(page, "m-annen")).toHaveText(["Åpne"]);
  await expect(menu(page, "m-annen")).toHaveText(["Dupliser", "Eksporter"]);
  await expect(row(page, "m-annen").locator(":scope > .row-readonly-note")).toHaveText("Kun for eier");
});

test("seksjonslista: «Publiser utkastet» og «Publiser» ved Åpne; resten under «Mer»", async ({ page }) => {
  await base(page);
  const s = (id: string, navn: string, extra: Record<string, unknown>) => ({ id, title: L3(navn), activeVersionId: "v5", versionNo: 5, latestVersionNo: 5, archivedAt: null, courseCount: 0, courses: [], updatedAt: "2026-11-01T08:00:00.000Z", canManage: true, ...extra });
  await page.route("**/api/admin/content/sections", (r: Route) => r.fulfill(json({ sections: [
    s("s-ny", "Med nyere utkast", { lifecycle: "published_with_draft", latestVersionNo: 6 }),
    s("s-pub", "Publisert", { lifecycle: "published" }),
    s("s-utk", "Utkast", { lifecycle: "draft", activeVersionId: null, versionNo: null, latestVersionNo: 1 }),
  ] })));
  await page.goto("/admin-content/sections");
  await expect(visible(page, "s-ny")).toHaveText(["Åpne", "Publiser utkastet"]);
  await expect(menu(page, "s-ny")).toHaveText(["Døp om", "Dupliser", "Eksporter", "Avpubliser", "Arkiver"]);
  await expect(visible(page, "s-pub")).toHaveText(["Åpne"]);
  await expect(visible(page, "s-utk")).toHaveText(["Åpne", "Publiser"]);
  await expect(menu(page, "s-utk")).toHaveText(["Døp om", "Dupliser", "Eksporter", "Arkiver"]);
});

test("seksjonslista, arkivert: Gjenopprett ved Åpne, og «Slett» under «Mer» sletter etter bekreftelsen", async ({ page }) => {
  await base(page);
  let sections = [{ id: "s-ark", title: L3("Arkivert seksjon"), activeVersionId: null, versionNo: null, latestVersionNo: 2, archivedAt: "2026-10-05T08:00:00.000Z", courseCount: 0, courses: [], updatedAt: "2026-11-01T08:00:00.000Z", canManage: true, lifecycle: "archived" }];
  await page.route(/\/api\/admin\/content\/sections(\?.*)?$/, (r: Route) => r.fulfill(json({ sections })));
  const deleted: string[] = [];
  await page.route("**/api/admin/content/sections/s-ark", (r: Route) => {
    if (r.request().method() === "DELETE") { deleted.push("s-ark"); sections = []; return r.fulfill(json({ ok: true })); }
    return r.fallback();
  });
  await page.goto("/admin-content/sections");
  await page.locator('.list-filter-btn[data-filter="archived"]').click();
  await expect(visible(page, "s-ark")).toHaveText(["Åpne", "Gjenopprett"]);
  await expect(menu(page, "s-ark")).toHaveText(["Eksporter", "Slett"]);
  await row(page, "s-ark").locator("details.row-more > summary").click();
  await row(page, "s-ark").locator('.row-more-menu [data-action="delete"]').click();
  // Bekreftelsen nevner seksjonen ved navn (fra raden, ikke fra en redigerer som ikke er åpen).
  await expect(page.locator("dialog[open]")).toContainText("Arkivert seksjon");
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  await expect.poll(() => deleted).toEqual(["s-ark"]);
});

test("klasselista: Åpne; «Mer» med Arkiver; en annens klasse har ingen «Mer»", async ({ page }) => {
  await base(page);
  const c = (id: string, name: string, extra: Record<string, unknown>) => ({ id, name, description: null, isSystem: false, kind: "MANUAL", archivedAt: null, canManage: true, _count: { members: 3, courseAssignments: 1 }, ...extra });
  await page.route("**/api/admin/content/classes", (r: Route) => r.fulfill(json({ classes: [c("c-egen", "Egen klasse", {}), c("c-annen", "Andres klasse", { canManage: false })] })));
  await page.goto("/deltakere/klasser");
  await expect(visible(page, "c-egen")).toHaveText(["Åpne"]);
  await expect(menu(page, "c-egen")).toHaveText(["Arkiver"]);
  await expect(visible(page, "c-annen")).toHaveText(["Åpne"]);
  await expect(row(page, "c-annen").locator("details.row-more")).toHaveCount(0);
  await expect(row(page, "c-annen").locator(":scope > .row-readonly-note")).toHaveText("Kun for eier");
});

// QA-porten 2.189.0: tre ting rundt den nye «Mer»-stien.
test("Escape fra et valg i «Mer»: menyen lukkes, og «Mer» får fokuset", async ({ page }) => {
  await base(page);
  await page.route("**/api/admin/content/classes", (r: Route) => r.fulfill(json({ classes: [{ id: "c-egen", name: "Egen klasse", description: null, isSystem: false, kind: "MANUAL", archivedAt: null, canManage: true, _count: { members: 3, courseAssignments: 1 } }] })));
  await page.goto("/deltakere/klasser");
  const summary = row(page, "c-egen").locator("details.row-more > summary");
  await summary.click();
  await row(page, "c-egen").locator('.row-more-menu [data-action="archive"]').focus();
  await page.keyboard.press("Escape");
  await expect(row(page, "c-egen").locator("details.row-more")).not.toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
});

test("kurslista: avbrutt sletting gir fokuset tilbake til «Mer»", async ({ page }) => {
  await mockCommonApis(page, {});
  await nb(page);
  const course = { id: "k-ark", title: L3("Arkivert kurs"), description: null, certificationLevel: "basic", enrollmentPolicy: "OPEN", moduleCount: 2, sortOrder: null, updatedAt: "2026-11-01T08:00:00.000Z", archivedAt: "2026-10-05T08:00:00.000Z", inProgressCount: 0, canManage: true, themes: [], publishedAt: null, lifecycle: "archived", versionMajor: 2, versionMinor: 1 };
  await page.route(/\/api\/admin\/content\/courses(\?.*)?$/, (r: Route) => r.fulfill(json({ courses: [course] })));
  await page.goto("/admin-content/courses");
  await page.locator('.list-filter-btn[data-filter="archived"]').click();
  const summary = row(page, "k-ark").locator("details.row-more > summary");
  await summary.click();
  await row(page, "k-ark").locator('.row-more-menu [data-action="delete"]').click();
  await expect(page.locator("#deleteDialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#deleteDialog")).toBeHidden();
  await expect(summary).toBeFocused();
});

test("seksjonslista: sletting fra lista legger ikke lista i historikken en gang til", async ({ page }) => {
  await base(page);
  let sections = [{ id: "s-ark", title: L3("Arkivert seksjon"), activeVersionId: null, versionNo: null, latestVersionNo: 2, archivedAt: "2026-10-05T08:00:00.000Z", courseCount: 0, courses: [], updatedAt: "2026-11-01T08:00:00.000Z", canManage: true, lifecycle: "archived" }];
  await page.route(/\/api\/admin\/content\/sections(\?.*)?$/, (r: Route) => r.fulfill(json({ sections })));
  await page.route("**/api/admin/content/sections/s-ark", (r: Route) => {
    if (r.request().method() === "DELETE") { sections = []; return r.fulfill(json({ ok: true })); }
    return r.fallback();
  });
  await page.goto("/admin-content/sections");
  await page.locator('.list-filter-btn[data-filter="archived"]').click();
  const before = await page.evaluate(() => history.length);
  await row(page, "s-ark").locator("details.row-more > summary").click();
  await row(page, "s-ark").locator('.row-more-menu [data-action="delete"]').click();
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  await expect(page.locator('tr[data-row-id="s-ark"]')).toHaveCount(0);
  expect(await page.evaluate(() => history.length)).toBe(before);
});
