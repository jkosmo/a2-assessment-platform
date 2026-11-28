import { expect, test } from "@playwright/test";
import type { Locator, Page, Route } from "@playwright/test";

import { buildMockModuleExport, mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

// #1165 (produkteier 14.11.2026, «Produsenter bør kunne se hverandres innhold»): en produsent som ikke eier et kurs eller en
// modul, kan åpne det for å lese. Tjeneren sier `canManage` (kursdetaljen, modulens `/export`); sida bruker sperren fra det
// arkiverte innholdet (#1151): linja «Du kan lese, men bare eierne kan endre», ingen Lagre/Avbryt, feltene i en sperret
// `<fieldset>`, og i handlingsraden bare det som er lov (Eksporter). I listene står bare det brukeren kan gjøre.
//
// Hver flate har en KONTROLL: samme side for eieren viser alt som før.

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const NOTICE = "Du kan lese, men bare eierne kan endre.";

async function nb(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

function recordWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!WRITE_METHODS.has(request.method())) return;
    const url = request.url();
    // Eierpanelet, loggen og forhåndsvisningen av tekst (en tegning, ikke en skriving) er ikke skriving.
    if (url.includes("/content-owners") || url.includes("/intent-log") || url.endsWith("/sections/preview")) return;
    writes.push(`${request.method()} ${new URL(url).pathname}`);
  });
  return writes;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function ownersPanel(page: Page, canManage: boolean) {
  await page.route("**/api/admin/content-owners/**", (route: Route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ owners: [{ userId: "u-kari", name: "Kari Eier", email: "kari@x.test" }], canManage }),
  }));
}

const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];

// ---------------------------------------------------------------------------
// Kurs
// ---------------------------------------------------------------------------

const COURSE = {
  id: "course-1",
  title: { "en-GB": "Arbeidsmiljø", nb: "Arbeidsmiljø", nn: "Arbeidsmiljø" },
  description: null,
  certificationLevel: "basic",
  moduleCount: 1,
  updatedAt: "2026-11-13T12:00:00.000Z",
  publishedAt: "2026-11-01T12:00:00.000Z",
  archivedAt: null,
  lifecycle: "published",
  modules: [{ moduleId: "mod-a", sortOrder: 0, moduleTitle: "Modul A" }],
  contentRevision: 3,
};

async function courseSetup(page: Page, canManage: boolean) {
  await nb(page);
  await mockCommonApis(page, { courses: [{ ...COURSE, canManage } as never] });
  await ownersPanel(page, canManage);
  let pendingVersionsAsked = 0;
  await page.route("**/api/admin/content/courses/*/pending-versions", (route: Route) => {
    pendingVersionsAsked += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], publishable: true }) });
  });
  return { pendingVersionsAsked: () => pendingVersionsAsked };
}

const headerActions = (page: Page) =>
  page.locator(".form-page-actions [data-action]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.action));

for (const viewport of VIEWPORTS) {
  test.describe(`#1165 kurset, en annens (${viewport.width} px)`, () => {
    test.use({ viewport });

    test("skrivebeskyttet: linja, ingen Lagre/Avbryt, bare Eksporter, sperrede felt i begge faner, eierpanelet leses", async ({ page }) => {
      const { pendingVersionsAsked } = await courseSetup(page, false);
      const writes = recordWrites(page);
      await page.goto("/admin-content/courses/course-1");
      await expect(page.locator("[data-course-readonly-notice]")).toHaveText(NOTICE);
      await expect(page.locator("[data-course-archived-notice]")).toHaveCount(0);
      await expect(page.locator("#formSaveBtn")).toHaveCount(0);
      await expect(page.locator("#formCancelLink")).toHaveCount(0);
      // #1169 skive 4b: Dupliser også (kopien er hens egen).
      await expect.poll(() => headerActions(page)).toEqual(["duplicate", "export"]);
      await expect(page.locator("#title-nb")).toBeDisabled();
      await expect(page.locator("#certLevel")).toBeDisabled();
      await expect(page.locator("#comboboxInput")).toBeDisabled();
      await expect(page.locator('#moduleList [data-remove="0"]')).toBeDisabled();
      // «Åpne» på elementet står (en lenke, ikke en skrivehandling).
      await expect(page.locator("#moduleList a.row-action-btn").first()).toBeVisible();
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/1165-kurs-annens-${viewport.width}.png`, fullPage: true });

      await page.locator("#formTab-innstillinger").click();
      await expect(page.locator("#enrollmentPolicy")).toBeDisabled();
      await expect(page.locator("#discussionsEnabled")).toBeDisabled();
      await expect(page.locator("#ownerPanelHost")).toContainText("Kari Eier");
      expect(pendingVersionsAsked(), "«Publiser nye versjoner» er eiernes; ruta spørres ikke").toBe(0);
      expect(writes).toEqual([]);
    });

    test("KONTROLL: eieren har Lagre, Publiser/Avpubliser og Arkiver, og feltene er åpne", async ({ page }) => {
      await courseSetup(page, true);
      await page.goto("/admin-content/courses/course-1");
      await expect(page.locator("#title-nb")).toBeEnabled();
      await expect(page.locator("#formSaveBtn")).toHaveCount(1);
      await expect(page.locator("[data-course-readonly-notice]")).toHaveCount(0);
      await expect.poll(() => headerActions(page)).toEqual(expect.arrayContaining(["export", "unpublish", "archive"]));
    });
  });
}

test.describe("#1165 kurslista", () => {
  test("en annens kurs: «Åpne», «Eksporter» og merket; ingen livssyklushandlinger. Eierens rad har dem (kontroll)", async ({ page }) => {
    await nb(page);
    await mockCommonApis(page, {
      courses: [
        { ...COURSE, canManage: false } as never,
        { ...COURSE, id: "course-2", title: { "en-GB": "Eget kurs", nb: "Eget kurs", nn: "Eget kurs" }, canManage: true } as never,
      ],
    });
    await page.goto("/admin-content/courses");
    const others = page.locator("#coursesTableBody tr").filter({ hasText: "Arbeidsmiljø" });
    await expect(others.locator("a.row-action-btn", { hasText: "Åpne" })).toHaveAttribute("href", "/admin-content/courses/course-1");
    await expect(others.locator('[data-action="export"]')).toHaveCount(1);
    await expect(others.locator(".row-readonly-note")).toHaveText("Kun for eier");
    await expect(others.locator(".row-readonly-note")).toHaveAttribute("title", /kan endre dette kurset\. Du kan åpne det for å lese\./);
    for (const action of ["publish", "unpublish", "archive", "restore", "delete", "cascade-delete"]) {
      await expect(others.locator(`[data-action="${action}"]`), action).toHaveCount(0);
    }
    const mine = page.locator("#coursesTableBody tr").filter({ hasText: "Eget kurs" });
    await expect(await revealRowAction(page, mine.locator('[data-action="archive"]'))).toBeVisible();
    await expect(mine.locator(".row-readonly-note")).toHaveCount(0);

    // «Åpne» fører til kurset.
    await others.locator("a.row-action-btn", { hasText: "Åpne" }).click();
    await expect(page).toHaveURL(/\/admin-content\/courses\/course-1$/);
  });

  test("importen av en fil fra en annens kurs spør ikke om å oppdatere det, men importerer som nytt", async ({ page }) => {
    await nb(page);
    await mockCommonApis(page, { courses: [{ ...COURSE, canManage: false } as never] });
    const imports: unknown[] = [];
    await page.route("**/api/admin/content/courses/import", async (route: Route) => {
      imports.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ courseId: "course-new", moduleIds: [] }) });
    });
    await page.goto("/admin-content/courses");
    const payload = { exportFormat: "a2-content-export/v1", course: { course: { origin: { courseId: "course-1" } } } };
    await page.locator("#importCoursePackageFile").setInputFiles({ name: "kurs.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)) });
    await expect.poll(() => imports.length).toBe(1);
    await expect(page.locator("#courseImportChoiceDialog")).toBeHidden();
    expect(imports[0]).toMatchObject({ mode: "createNew" });
  });
});

// ---------------------------------------------------------------------------
// Moduler
// ---------------------------------------------------------------------------

const MODULE_ID = "module-1";

async function moduleSetup(page: Page, canManage: boolean) {
  await nb(page);
  const bundle = buildMockModuleExport({ id: MODULE_ID, title: "Arbeidsmiljø i praksis", moduleVersionId: "mv-2", activeVersionId: "mv-2" });
  bundle.canManage = canManage;
  const current = bundle.selectedConfiguration.moduleVersion;
  bundle.versions.moduleVersions = [current, { ...current, id: "mv-1", versionNo: 1 }];
  current.versionNo = 2;
  await mockCommonApis(page, { modules: [{ id: MODULE_ID, title: "Arbeidsmiljø i praksis" }], moduleExports: { [MODULE_ID]: bundle } });
  await ownersPanel(page, canManage);
}

const wsKeys = (page: Page) => page.locator("#moduleFormHead [data-ws-key]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.wsKey));

async function outsideDisabledFieldset(locator: Locator) {
  return locator.evaluate((el) => el.closest("fieldset[disabled]") === null);
}

for (const viewport of VIEWPORTS) {
  test.describe(`#1165 modulen, en annens (${viewport.width} px)`, () => {
    test.use({ viewport });

    test("skrivebeskyttet: linja, ingen Lagre/Avbryt, bare Dupliser og Eksporter, sperrede felt i Rediger og Innstillinger", async ({ page }) => {
      await moduleSetup(page, false);
      const writes = recordWrites(page);
      await page.goto(`/admin-content/module/${MODULE_ID}/conversation`);
      await page.locator("#previewEditTitle").waitFor();
      await expect(page.locator("[data-module-readonly-notice]")).toHaveText(NOTICE);
      await expect(page.locator("[data-module-archived-notice]")).toHaveCount(0);
      await expect(page.locator("#formSaveBtn")).toHaveCount(0);
      await expect(page.locator("#formCancelLink")).toHaveCount(0);
      // #1169 skive 4: Dupliser også (lesing og kopi), som i lista; kopien er hens egen.
      await expect.poll(() => wsKeys(page)).toEqual(["duplicate", "export"]);
      await expect(page.locator("#previewEditTitle")).toBeDisabled();
      await expect(page.locator("#previewEditTaskText")).toBeDisabled();
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/1165-modul-annens-${viewport.width}.png`, fullPage: true });

      await page.locator("#formTab-settings").click();
      await page.locator("#settingsModuleType").waitFor();
      await expect(page.locator("#settingsModuleType")).toBeDisabled();
      await expect(page.locator("#settingsSave")).toHaveCount(0);
      await expect(page.locator("[data-restore-version]")).toHaveCount(0);
      expect(await outsideDisabledFieldset(page.locator("#moduleOwnerPanelHost"))).toBe(true);
      expect(writes).toEqual([]);
    });

    test("KONTROLL: eieren har Lagre og Publiser/Avpubliser, og feltene er åpne", async ({ page }) => {
      await moduleSetup(page, true);
      await page.goto(`/admin-content/module/${MODULE_ID}/conversation`);
      await page.locator("#previewEditTitle").waitFor();
      await expect(page.locator("#previewEditTitle")).toBeEnabled();
      await expect(page.locator("[data-module-readonly-notice]")).toHaveCount(0);
      await expect.poll(() => wsKeys(page)).toEqual(expect.arrayContaining(["export", "import"]));
      expect(await wsKeys(page)).not.toEqual(["export"]);
    });
  });
}

test.describe("#1165 modullista", () => {
  test("en annens modul: «Åpne», «Dupliser», «Eksporter» og merket; ingen omdøping eller livssyklus. Eierens rad har dem (kontroll)", async ({ page }) => {
    await nb(page);
    await mockCommonApis(page, {
      libraryModules: [
        { id: "module-1", title: "Annens modul", status: "published", lifecycle: "published", canManage: false } as never,
        { id: "module-2", title: "Egen modul", status: "published", lifecycle: "published", canManage: true } as never,
      ],
    });
    await page.goto("/admin-content");
    const others = page.locator("#libraryTableBody tr").filter({ hasText: "Annens modul" });
    await expect(others.locator("a.row-action-btn", { hasText: "Åpne" })).toHaveAttribute("href", "/admin-content/module/module-1/conversation");
    await expect(others.locator('[data-action="duplicate"]')).toHaveCount(1);
    await expect(others.locator('[data-action="export"]')).toHaveCount(1);
    await expect(others.locator(".row-readonly-note")).toHaveAttribute("title", /kan endre denne modulen\. Du kan åpne den for å lese\./);
    for (const action of ["rename", "unpublish", "archive", "restore", "delete"]) {
      await expect(others.locator(`[data-action="${action}"]`), action).toHaveCount(0);
    }
    const mine = page.locator("#libraryTableBody tr").filter({ hasText: "Egen modul" });
    await expect(mine.locator('[data-action="rename"]')).toHaveCount(1);
    await expect(mine.locator(".row-readonly-note")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Seksjoner (#1180, produkteier 21.11.2026: seksjoner følger kursets og modulens eierregel)
// ---------------------------------------------------------------------------

type SectionFixture = Record<string, unknown> & { id: string };

function sectionFixture(id: string, title: string, canManage: boolean): SectionFixture {
  return {
    id,
    title: JSON.stringify({ nb: title, nn: title, "en-GB": title }),
    bodyMarkdown: JSON.stringify({ nb: "# Innhold", nn: "# Innhald", "en-GB": "# Content" }),
    activeVersionId: "sv-1",
    versionNo: 2,
    latestVersionNo: 2,
    hasUnpublishedChanges: false,
    updatedAt: "2026-11-01T08:00:00.000Z",
    archivedAt: null,
    canManage,
    courseCount: 0,
    courses: [],
    titleLocales: ["nb", "nn", "en-GB"],
    lifecycle: "published",
  };
}

async function sectionSetup(page: Page, sections: SectionFixture[], ownerPanelCanManage: boolean) {
  await nb(page);
  await mockCommonApis(page, {});
  await ownersPanel(page, ownerPanelCanManage);
  await page.route("**/api/admin/content/sections/preview", (route: Route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>Innhold</p>" }),
  }));
  const byId = new Map(sections.map((s) => [s.id, s]));
  await page.route(/\/api\/admin\/content\/sections(\/[^/?]+)?(\?.*)?$/, (route: Route) => {
    const id = /\/sections(?:\/([^/?]+))?/.exec(new URL(route.request().url()).pathname)?.[1] ?? null;
    if (!id) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [...byId.values()] }) });
    if (id === "preview" || id === "localize" || id === "import") return route.fallback();
    const target = byId.get(id);
    if (!target) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: target }) });
  });
}

const sectionHeaderActions = (page: Page) =>
  page.locator(".form-page-actions [data-editor-action]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.editorAction));

for (const viewport of VIEWPORTS) {
  test.describe(`#1180 seksjonen, en annens (${viewport.width} px)`, () => {
    test.use({ viewport });

    test("skrivebeskyttet: linja, ingen Lagre/Avbryt, bare Dupliser og Eksporter, sperrede felt, Forhåndsvisning og eierpanelet leses", async ({ page }) => {
      await sectionSetup(page, [sectionFixture("sec-1", "Annens seksjon", false)], false);
      const writes = recordWrites(page);
      await page.goto("/admin-content/sections?id=sec-1");
      await page.locator("#titleInput").waitFor();
      await expect(page.locator("[data-section-readonly-notice]")).toHaveText(NOTICE);
      await expect(page.locator("[data-section-archived-notice]")).toHaveCount(0);
      await expect(page.locator("#formSaveBtn")).toHaveCount(0);
      await expect(page.locator("#formCancelLink")).toHaveCount(0);
      // #1169 skive 4: Dupliser også, som i lista.
      await expect.poll(() => sectionHeaderActions(page)).toEqual(["duplicate", "export"]);
      await expect(page.locator("#titleInput")).toBeDisabled();
      await expect(page.locator("#markdownInput")).toBeDisabled();
      await expect(page.locator("#titleInput")).toHaveValue("Annens seksjon");
      await expect(page.locator("#uploadImageBtn")).toHaveCount(0);
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/1180-seksjon-annens-${viewport.width}.png`, fullPage: true });

      await page.locator("#formTab-forhandsvisning").click();
      await expect(page.locator("#previewPane")).toContainText("Innhold");
      await page.locator("#formTab-innstillinger").click();
      await expect(page.locator("#ownerPanelHost")).toContainText("Kari Eier");
      expect(await outsideDisabledFieldset(page.locator("#ownerPanelHost"))).toBe(true);
      expect(writes).toEqual([]);
    });

    test("KONTROLL: eieren har Lagre, Avpubliser og Arkiver, og feltene er åpne", async ({ page }) => {
      await sectionSetup(page, [sectionFixture("sec-1", "Egen seksjon", true)], true);
      await page.goto("/admin-content/sections?id=sec-1");
      await page.locator("#titleInput").waitFor();
      await expect(page.locator("#titleInput")).toBeEnabled();
      await expect(page.locator("#markdownInput")).toBeEnabled();
      await expect(page.locator("#formSaveBtn")).toHaveCount(1);
      await expect(page.locator("[data-section-readonly-notice]")).toHaveCount(0);
      await expect(page.locator("[data-section-archived-lock]")).toHaveCount(0);
      await expect.poll(() => sectionHeaderActions(page)).toEqual(expect.arrayContaining(["export", "unpublish", "archive"]));
    });
  });
}

test.describe("#1180 seksjonslista", () => {
  test("en annens seksjon: «Åpne», «Dupliser», «Eksporter» og merket; ingen omdøping eller livssyklus. Eierens rad har dem (kontroll)", async ({ page }) => {
    await sectionSetup(page, [sectionFixture("sec-theirs", "Annens seksjon", false), sectionFixture("sec-mine", "Egen seksjon", true)], false);
    await page.goto("/admin-content/sections");
    const others = page.locator("tr").filter({ hasText: "Annens seksjon" });
    await expect(others.locator('[data-action="edit"]')).toHaveText("Åpne");
    await expect(others.locator('[data-action="duplicate"]')).toHaveCount(1);
    await expect(others.locator('[data-action="export"]')).toHaveCount(1);
    await expect(others.locator(".row-readonly-note")).toHaveText("Kun for eier");
    await expect(others.locator(".row-readonly-note")).toHaveAttribute("title", /kan endre denne seksjonen\. Du kan åpne den for å lese\./);
    for (const action of ["rename", "publish", "publish-new", "unpublish", "archive", "restore"]) {
      await expect(others.locator(`[data-action="${action}"]`), action).toHaveCount(0);
    }
    const mine = page.locator("tr").filter({ hasText: "Egen seksjon" });
    await expect(mine.locator('[data-action="rename"]')).toHaveCount(1);
    await expect(mine.locator(".row-readonly-note")).toHaveCount(0);

    // «Åpne» fører til seksjonen, skrivebeskyttet.
    await others.locator('[data-action="edit"]').click();
    await expect(page).toHaveURL(/\/admin-content\/sections\?id=sec-theirs$/);
    await expect(page.locator("[data-section-readonly-notice]")).toHaveText(NOTICE);
  });
});
