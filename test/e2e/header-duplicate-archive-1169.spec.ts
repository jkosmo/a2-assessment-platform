import { expect, test, type Page, type Route } from "@playwright/test";
import { buildMockModuleExport, mockCommonApis } from "./admin-content-helpers.js";

// #1169 skive 4 (doc/design/PLAN_1169_1171_HODER_OG_RADER.md § 2, «Nytt for modul: Arkiver og Dupliser i hodet»; «Nytt for
// seksjon: Dupliser i hodet»): handlingene som bare fantes i lista, står nå også i hodet, under «Mer». Kopien er den samme som fra
// lista (content-duplicate.js: eksportpakken med « (kopi)», importert som nytt, modulen upublisert), og hodet åpner kopien.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const nb = (page: Page) => page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ } });
const L3 = (text: string) => JSON.stringify({ nb: text, nn: text, "en-GB": text });
const actions = (page: Page) => page.locator(".form-page-actions .row-actions");
const menu = (page: Page) => actions(page).locator(":scope > details.row-more .row-more-menu > .row-action-btn");

async function openModule(page: Page, { canManage = true } = {}) {
  const LIVE = { id: "v1", versionNo: 5, versionMajor: 2, versionMinor: 1, publishedAt: "2026-09-18T10:00:00.000Z" };
  const exp = buildMockModuleExport({ id: "m", title: "Phishing i praksis", moduleVersionId: "v1", activeVersionId: "v1" });
  Object.assign(exp.selectedConfiguration.moduleVersion, LIVE);
  exp.versions.moduleVersions = [exp.selectedConfiguration.moduleVersion];
  (exp as unknown as { canManage?: boolean }).canManage = canManage;
  const state = await mockCommonApis(page, { modules: [{ id: "m", title: "Phishing i praksis" }], moduleExports: { m: exp } });
  await nb(page);
  return state;
}

test("modulens hode: «Dupliser» lager samme kopi som lista og åpner den", async ({ page }) => {
  await openModule(page);
  const envelope = { exportFormat: "a2-content-export/v1", module: { module: { title: { nb: "Phishing i praksis", nn: "Phishing i praksis", "en-GB": "Phishing in practice" } } } };
  await page.route("**/api/admin/content/modules/m/export-package**", (r: Route) => r.fulfill(json({ envelope })));
  let imported: Record<string, unknown> | null = null;
  await page.route("**/api/admin/content/modules/import", (r: Route) => { imported = r.request().postDataJSON(); return r.fulfill(json({ moduleId: "m-kopi" })); });
  await page.goto("/admin-content/module/m/conversation");
  await page.locator("#moduleFormHead .form-page-head").waitFor();
  await actions(page).locator("details.row-more > summary").click();
  await actions(page).locator('.row-more-menu [data-ws-key="duplicate"]').click();
  await page.waitForURL("**/admin-content/module/m-kopi/conversation");
  expect(imported).toMatchObject({ mode: "createNew", autoPublish: false, payload: { module: { module: { title: { nb: "Phishing i praksis (kopi)", "en-GB": "Phishing in practice (kopi)" } } } } });
});

test("modulens hode: «Arkiver» viser dialogen, arkiverer, og hodet viser den arkiverte modulen", async ({ page }) => {
  await openModule(page);
  const archived: string[] = [];
  page.on("request", (req) => { if (req.method() === "POST" && req.url().endsWith("/modules/m/archive")) archived.push("m"); });
  await page.goto("/admin-content/module/m/conversation");
  await page.locator("#moduleFormHead .form-page-head").waitFor();
  await actions(page).locator("details.row-more > summary").click();
  await actions(page).locator('.row-more-menu [data-ws-key="archive"]').click();
  await expect(page.locator("dialog[open]")).toBeVisible();
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  await expect.poll(() => archived).toEqual(["m"]);
  // Etter arkiveringen: Gjenopprett er hovedhandlingen, og verken Arkiver eller Dupliser står.
  await expect(actions(page).locator(':scope > [data-ws-key="restore"]')).toBeVisible();
  await expect(actions(page).locator('[data-ws-key="archive"], [data-ws-key="duplicate"]')).toHaveCount(0);
});

test("en annens modul: «Mer» med Dupliser · Eksporter", async ({ page }) => {
  await openModule(page, { canManage: false });
  await page.goto("/admin-content/module/m/conversation");
  await page.locator("#moduleFormHead .form-page-head").waitFor();
  await expect(menu(page)).toHaveText(["Dupliser", "Eksporter"]);
});

test("seksjonens hode: «Dupliser» lager kopien og åpner den; en arkivert seksjon har ikke Dupliser", async ({ page }) => {
  await nb(page);
  await page.route("**/participant/config", (r: Route) => r.fulfill(json({ authMode: "mock", navigation: { items: [], workspaceItems: [] }, identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } }, calibrationWorkspace: { accessRoles: [] } })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (r: Route) => r.fulfill(json({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/admin/content/sections/preview", (r: Route) => r.fulfill(json({ html: "<p>forhåndsvisning</p>" })));
  await page.route(/\/api\/admin\/content\/sections(\?.*)?$/, (r: Route) => r.fulfill(json({ sections: [] })));
  const sek = (id: string, extra: Record<string, unknown>) => ({ id, title: L3("Grunnleggende prinsipper"), bodyMarkdown: L3("Tekst"), activeVersionId: "v1", archivedAt: null, hasUnpublishedChanges: false, versionNo: 1, publishedVersionNo: 1, assets: [], canManage: true, courses: [], ...extra });
  await page.route("**/api/admin/content/sections/sec-x", (r: Route) => r.fulfill(json({ section: sek("sec-x", {}) })));
  await page.route("**/api/admin/content/sections/sec-kopi", (r: Route) => r.fulfill(json({ section: sek("sec-kopi", { title: L3("Grunnleggende prinsipper (kopi)"), activeVersionId: null, publishedVersionNo: null }) })));
  await page.route("**/api/admin/content/sections/sec-ark", (r: Route) => r.fulfill(json({ section: sek("sec-ark", { archivedAt: "2026-10-05T08:00:00.000Z", activeVersionId: null }) })));
  await page.route("**/api/admin/content/sections/sec-x/export-package", (r: Route) => r.fulfill(json({ envelope: { section: { title: { nb: "Grunnleggende prinsipper" } } } })));
  let imported: Record<string, unknown> | null = null;
  await page.route("**/api/admin/content/sections/import", (r: Route) => { imported = r.request().postDataJSON(); return r.fulfill(json({ sectionId: "sec-kopi" })); });

  await page.goto("/admin-content/sections?id=sec-x");
  await page.locator(".form-page-head").waitFor();
  await actions(page).locator("details.row-more > summary").click();
  await actions(page).locator('.row-more-menu [data-editor-action="duplicate"]').click();
  await page.waitForURL(/sections\?id=sec-kopi/);
  expect(imported).toMatchObject({ mode: "createNew", payload: { section: { title: { nb: "Grunnleggende prinsipper (kopi)" } } } });

  await page.goto("/admin-content/sections?id=sec-ark");
  await page.locator(".form-page-head").waitFor();
  await expect(actions(page).locator('[data-editor-action="duplicate"]')).toHaveCount(0);
});

// #1169 skive 4: «Publiser» / «Publiser utkastet» i lista åpner elementet med et flagg, og hodets publisering kjøres der — med
// spørsmålene og porten i hodet. Flagget fjernes fra adressen, så en omlasting ikke publiserer på nytt.
test("modullista: «Publiser» og «Publiser utkastet» er lenker til modulen med ?publish=1; et tomt grunnlag har ingen", async ({ page }) => {
  await mockCommonApis(page, { libraryModules: [
    { id: "m-utk", title: "Utkastmodul", status: "unpublished_draft", lifecycle: "draft", latestVersionNo: 1, activeVersionNo: null, activeVersionMajor: null, activeVersionMinor: null },
    { id: "m-ny", title: "Med nyere utkast", status: "published_with_draft", activeVersionNo: 3, activeVersionMajor: 1, activeVersionMinor: 2 },
    { id: "m-tom", title: "Tomt grunnlag", status: "ready", lifecycle: "draft", latestVersionNo: null, activeVersionNo: null, activeVersionMajor: null, activeVersionMinor: null },
  ] as never });
  await nb(page);
  await page.goto("/admin-content");
  const visible = (id: string) => page.locator(`tr[data-row-id="${id}"] .row-actions > .row-action-btn`);
  await expect(visible("m-utk")).toHaveText(["Åpne", "Publiser"]);
  await expect(visible("m-utk").nth(1)).toHaveAttribute("href", "/admin-content/module/m-utk/conversation?publish=1");
  await expect(visible("m-ny")).toHaveText(["Åpne", "Publiser utkastet"]);
  await expect(visible("m-tom")).toHaveText(["Åpne"]);
});

// QA 2.190.0: en adresse med flagget kan komme tilbake fra historikken eller et bokmerke. Sida spør først i sin egen dialog.
async function openWithPublishFlag(page: Page) {
  const bunt = buildMockModuleExport({ id: "module-1", title: "Frihet under ansvar", moduleVersionId: "v2", activeVersionId: "v1" });
  const lagring = { ...bunt.selectedConfiguration.moduleVersion!, id: "v2", versionNo: 2 };
  const publisert = { ...bunt.selectedConfiguration.moduleVersion!, id: "v1", versionNo: 1, versionMajor: 1, versionMinor: 0, publishedAt: "2026-11-13T08:00:00.000Z" };
  bunt.versions.moduleVersions = [lagring, publisert] as never;
  bunt.selectedConfiguration.moduleVersion = lagring as never;
  await mockCommonApis(page, { modules: [{ id: "module-1", title: "Frihet under ansvar", activeVersion: { versionNo: 1 } }], moduleExports: { "module-1": bunt } });
  await nb(page);
  await page.route("**/api/admin/content/modules/*/module-versions/*/publish-preview-versioned", (r: Route) =>
    r.fulfill(json({ moduleVersion: { id: "v2", versionMajor: null }, courses: [], currentMajor: 1, anyonePassed: false })));
  const published: string[] = [];
  await page.route("**/api/admin/content/modules/*/module-versions/*/publish-versioned", (r: Route) => {
    if (r.request().method() === "POST") published.push(r.request().url());
    return r.fulfill(json({}));
  });
  await page.goto("/admin-content/module/module-1/conversation?publish=1");
  return published;
}

test("modulsida med ?publish=1: sida spør først; ja kjører hodets publisering, og flagget forsvinner fra adressen", async ({ page }) => {
  const published = await openWithPublishFlag(page);
  await expect(page.locator("dialog[open]")).toContainText("Publisere «Frihet under ansvar");
  expect(new URL(page.url()).search).toBe("");
  expect(published).toEqual([]);
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  await expect.poll(() => published.length, { timeout: 10000 }).toBe(1);
});

test("modulsida med ?publish=1: Avbryt publiserer ingenting", async ({ page }) => {
  const published = await openWithPublishFlag(page);
  await expect(page.locator("dialog[open]")).toBeVisible();
  await page.locator("#moduleLifecycleDialogCancelBtn").click();
  await page.waitForTimeout(500);
  expect(published).toEqual([]);
});

test("modulsida med ?publish=1 og ingenting å publisere: sida sier det", async ({ page }) => {
  const LIVE = { id: "v1", versionNo: 5, versionMajor: 2, versionMinor: 1, publishedAt: "2026-09-18T10:00:00.000Z" };
  const exp = buildMockModuleExport({ id: "m", title: "Phishing i praksis", moduleVersionId: "v1", activeVersionId: "v1" });
  Object.assign(exp.selectedConfiguration.moduleVersion, LIVE);
  exp.versions.moduleVersions = [exp.selectedConfiguration.moduleVersion];
  await mockCommonApis(page, { modules: [{ id: "m", title: "Phishing i praksis" }], moduleExports: { m: exp } });
  await nb(page);
  await page.goto("/admin-content/module/m/conversation?publish=1");
  await expect(page.getByText("Ingenting å publisere: modulen har ingen lagret versjon som er nyere enn den publiserte.")).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("modullista: en annens modul har ingen Publiser-lenke", async ({ page }) => {
  await mockCommonApis(page, { libraryModules: [
    { id: "m-annen", title: "Andres utkast", status: "unpublished_draft", lifecycle: "draft", latestVersionNo: 1, activeVersionNo: null, activeVersionMajor: null, activeVersionMinor: null, canManage: false },
  ] as never });
  await nb(page);
  await page.goto("/admin-content");
  await expect(page.locator('tr[data-row-id="m-annen"] .row-actions > .row-action-btn')).toHaveText(["Åpne"]);
});

test("kurslista: «Publiser utkastet» for et publisert kurs med utkast er en lenke med ?publishDraft=1", async ({ page }) => {
  await mockCommonApis(page, {});
  await nb(page);
  await page.route("**/api/admin/content/courses", (r: Route) => r.fulfill(json({ courses: [
    { id: "k1", title: L3("Informasjonssikkerhet"), description: null, certificationLevel: "basic", enrollmentPolicy: "OPEN", moduleCount: 1, sortOrder: null, updatedAt: "2026-11-01T08:00:00.000Z", archivedAt: null, inProgressCount: 0, canManage: true, themes: [], publishedAt: "2026-10-01T08:00:00.000Z", lifecycle: "published_with_draft", versionMajor: 2, versionMinor: 1 },
  ] })));
  await page.goto("/admin-content/courses");
  const visible = page.locator('tr[data-row-id="k1"] .row-actions > .row-action-btn');
  await expect(visible).toHaveText(["Åpne", "Publiser utkastet"]);
  await expect(visible.nth(1)).toHaveAttribute("href", "/admin-content/courses/k1?publishDraft=1");
});

// QA-porten 2.190.0: kopien fra hodet lages av versjonen sida VISER (et nyere lagret utkast), ikke den publiserte; og etter
// «ja» til de ulagrede endringene spør ikke nettleseren en gang til når kopien åpnes.
test("modulens hode, publisert med nyere utkast og ulagrede endringer: kopien tas av utkastet, og nettleseren spør ikke igjen", async ({ page }) => {
  const LIVE = { id: "v1", versionNo: 5, versionMajor: 2, versionMinor: 1, publishedAt: "2026-09-18T10:00:00.000Z" };
  const DRAFT = { id: "v2", versionNo: 6, versionMajor: null, versionMinor: null, publishedAt: null };
  const exp = buildMockModuleExport({ id: "m", title: "Phishing i praksis", moduleVersionId: "v2", activeVersionId: "v1" });
  Object.assign(exp.selectedConfiguration.moduleVersion, DRAFT);
  exp.versions.moduleVersions = [exp.selectedConfiguration.moduleVersion, { createdAt: "2026-09-18T09:00:00.000Z", ...LIVE }];
  await mockCommonApis(page, { modules: [{ id: "m", title: "Phishing i praksis" }], moduleExports: { m: exp } });
  await nb(page);
  const exportUrls: string[] = [];
  await page.route("**/api/admin/content/modules/m/export-package**", (r: Route) => {
    exportUrls.push(r.request().url());
    return r.fulfill(json({ envelope: { exportFormat: "a2-content-export/v1", module: { module: { title: { nb: "Phishing i praksis" } } } } }));
  });
  await page.route("**/api/admin/content/modules/import", (r: Route) => r.fulfill(json({ moduleId: "m-kopi" })));
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.type()); void d.accept().catch(() => {}); });
  await page.goto("/admin-content/module/m/conversation");
  await page.locator("#previewEditTitle").fill("Phishing i praksis (endret)");
  await actions(page).locator("details.row-more > summary").click();
  await actions(page).locator('.row-more-menu [data-ws-key="duplicate"]').click();
  await page.waitForURL("**/admin-content/module/m-kopi/conversation");
  expect(exportUrls).toHaveLength(1);
  expect(new URL(exportUrls[0]).searchParams.get("moduleVersionId")).toBe("v2");
  // Ett spørsmål (sidas eget om de ulagrede endringene), ikke nettleserens «forlate sida?» i tillegg.
  expect(dialogs).toEqual(["confirm"]);
});
