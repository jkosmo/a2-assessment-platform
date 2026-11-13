import { expect, test } from "@playwright/test";
import type { Locator, Page, Route } from "@playwright/test";

import { buildMockModuleExport, localizedText, mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

// #1151 skive 3c: klienten sier det tjeneren håndhever (doc/design/CONTENT_LIFECYCLE.md G5, doc/FEATURE_SURFACE_MAP.md §33e).
// Lov på et arkivert element: lese, «Eksporter», «Gjenopprett», «Slett», eierpanelet. Alt annet tilbys ikke. Mønsteret er det
// arkiverte kurset (#1150 skive 2b): linja under merket, ingen Lagre/Avbryt, feltene i en `<fieldset disabled>`.
//
// Hver flate har en KONTROLL: samme side for et aktivt element viser alt som før. Uten den kunne en test være grønn fordi
// knappene var borte for alle.

const ARCHIVED_AT = "2026-11-10T12:00:00.000Z";
const SHOTS = "test-results/1151";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function locale(page: Page, value = "nb") {
  await page.addInitScript((loc) => { try { localStorage.setItem("participant.locale", loc); } catch { /* ignore */ } }, value);
}

/** Skrivende kall mot innholdet (eierpanelet og forhåndsvisningen av seksjonen er ikke skriving). */
function recordWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!WRITE_METHODS.has(request.method())) return;
    if (url.includes("/content-owners") || url.endsWith("/sections/preview") || url.includes("/intent-log")) return;
    writes.push(`${request.method()} ${new URL(url).pathname}`);
  });
  return writes;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function outsideDisabledFieldset(locator: Locator) {
  return locator.evaluate((el) => el.closest("fieldset[disabled]") === null);
}

// ---------------------------------------------------------------------------
// Modulsida
// ---------------------------------------------------------------------------

const MODULE_ID = "module-1";
const MODULE_PAGE = `/admin-content/module/${MODULE_ID}/conversation`;
const QUESTION = {
  stem: localizedText("Hva er riktig?"),
  options: [localizedText("Svar A"), localizedText("Svar B"), localizedText("Svar C")],
  correctAnswer: localizedText("Svar B"),
  rationale: localizedText("Fordi B stemmer."),
};

function moduleExport({ archived }: { archived: boolean }) {
  const bundle = buildMockModuleExport({
    id: MODULE_ID,
    title: "Arbeidsmiljø i praksis",
    moduleVersionId: "mv-2",
    activeVersionId: null,
    mcqQuestions: [QUESTION],
  });
  bundle.module.archivedAt = archived ? ARCHIVED_AT : null;
  // To lagrede versjoner: den eldre ville hatt «Gjenopprett»-knappen i versjonshistorikken.
  const current = bundle.selectedConfiguration.moduleVersion;
  bundle.versions.moduleVersions = [current, { ...current, id: "mv-1", versionNo: 1 }];
  current.versionNo = 2;
  return bundle;
}

async function openModule(page: Page, { archived }: { archived: boolean }) {
  await locale(page);
  const state = await mockCommonApis(page, {
    modules: [{ id: MODULE_ID, title: "Arbeidsmiljø i praksis" }],
    moduleExports: { [MODULE_ID]: moduleExport({ archived }) },
  });
  await page.route("**/api/admin/content-owners/**", (route: Route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ owners: [] }),
  }));
  return state;
}

const wsKeys = (page: Page) => page.locator("#moduleFormHead [data-ws-key]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.wsKey));

test.describe("#1151 skive 3c — modulsida", () => {
  test("arkivert: linja, ingen Lagre/Avbryt, bare Eksporter/Gjenopprett/Slett, sperrede felt i Rediger og Innstillinger, eierpanelet åpent", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openModule(page, { archived: true });
    const writes = recordWrites(page);
    await page.goto(MODULE_PAGE);
    await page.locator("#previewEditTitle").waitFor();

    await expect(page.locator("[data-module-archived-notice]")).toHaveText("Modulen er arkivert og kan ikke endres. Gjenopprett den for å endre den.");
    await expect(page.locator("#formSaveBtn")).toHaveCount(0);
    await expect(page.locator("#formCancelLink")).toHaveCount(0);
    await expect.poll(() => wsKeys(page)).toEqual(["export", "restore", "delete"]);

    // Rediger: feltene og knappene i skjemaet er sperret (fieldseten rundt innholdet).
    await expect(page.locator("#previewEditTitle")).toBeDisabled();
    await expect(page.locator("#previewEditTaskText")).toBeDisabled();
    await expect(page.locator("#previewEditMcqStem0")).toBeDisabled();
    await expect(page.locator("#previewEditAddQuestion")).toBeDisabled();
    await expect(page.locator('[data-remove-question="0"]')).toBeDisabled();
    await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
    // Ser sperret ut, ikke bare er det: samme bakgrunn som et sperret skjemafelt.
    const background = await page.locator("#previewEditTaskText").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).toBe("rgb(242, 241, 236)");
    await page.screenshot({ path: `${SHOTS}-modul-arkivert-rediger-1280.png`, fullPage: true });

    // Innstillinger: ingen Lagre, ingen «Gjenopprett» på en eldre versjon, instruksen lesbar og sperret.
    await page.locator("#formTab-settings").click();
    await page.locator("#settingsModuleType").waitFor();
    await expect(page.locator("#settingsModuleType")).toBeDisabled();
    await expect(page.locator("#settingsSave")).toHaveCount(0);
    await expect(page.locator("[data-restore-version]")).toHaveCount(0);
    await expect(page.locator("#settingsPromptToggle")).toHaveCount(0);
    await expect(page.locator("#settingsSchemaToggle")).toHaveCount(0);
    await expect(page.locator("#settingsPromptSystem")).toBeDisabled();
    await expect(page.locator("#settingsPromptSystem")).toHaveValue("You are an assessment assistant. (NB)");
    await expect(page.locator("#settingsSchemaLabel")).toBeDisabled();
    // «Redigerer på nb» sies ikke om noe som ikke kan redigeres.
    await expect(page.locator("#tabPanelSettings")).not.toContainText("Redigerer på");
    for (const button of await page.locator("#settingsCriteriaEditor button").all()) await expect(button).toBeDisabled();
    expect(await page.locator("#settingsCriteriaEditor button").count()).toBeGreaterThan(0);
    // Eierpanelet står utenfor sperren (det lagrer for seg).
    await expect(page.locator("#moduleOwnerPanelHost")).toBeVisible();
    expect(await outsideDisabledFieldset(page.locator("#moduleOwnerPanelHost"))).toBe(true);
    await page.screenshot({ path: `${SHOTS}-modul-arkivert-innstillinger-1280.png`, fullPage: true });

    // Forhåndsvisning går fortsatt, og er ikke sperret: forfatteren skal kunne prøve øvelsene som en deltaker (QA-porten 3c).
    await page.locator("#formTab-preview").click();
    await expect(page.locator("#previewContent")).toContainText("Hva er riktig?");
    await expect.poll(() => outsideDisabledFieldset(page.locator("#previewContent"))).toBe(true);
    // Tilbake i Rediger er feltene sperret igjen (boksen er felles for de to fanene).
    await page.locator("#formTab-edit").click();
    await expect(page.locator("#previewEditTitle")).toBeDisabled();
    expect(await outsideDisabledFieldset(page.locator("#previewEditTitle"))).toBe(false);
    expect(writes).toEqual([]);
  });

  test("KONTROLL: en aktiv modul er ikke sperret, og handlingsraden er som før", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openModule(page, { archived: false });
    await page.goto(MODULE_PAGE);
    await page.locator("#previewEditTitle").waitFor();

    await expect(page.locator("[data-module-archived-notice]")).toHaveCount(0);
    await expect(page.locator("#formSaveBtn")).toHaveCount(1);
    await expect(page.locator("#previewEditTitle")).toBeEnabled();
    await expect(page.locator("#previewEditAddQuestion")).toBeEnabled();
    const keys = await wsKeys(page);
    for (const key of ["publish", "generateContent", "resumeChatEdit", "generateMcq", "export", "import"]) expect(keys).toContain(key);
    expect(keys).not.toContain("restore");
    expect(keys).not.toContain("delete");
    expect(await page.locator("[data-module-archived-lock][disabled]").count()).toBe(0);

    await page.locator("#formTab-settings").click();
    await page.locator("#settingsModuleType").waitFor();
    await expect(page.locator("#settingsModuleType")).toBeEnabled();
    await expect(page.locator("#settingsSave")).toHaveCount(1);
    await expect(page.locator('[data-restore-version="mv-1"]')).toHaveCount(1);
    await expect(page.locator("#settingsPromptToggle")).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}-modul-aktiv-innstillinger-1280.png`, fullPage: true });
  });

  test("arkivert, åpnet med ?resumeEditing=1 (lenka fra kurset): ingen utkast, «Alt lagret», og ingen «klar for videre redigering»", async ({ page }) => {
    await openModule(page, { archived: true });
    await page.goto(`${MODULE_PAGE}?resumeEditing=1`);
    await page.locator("#previewEditTitle").waitFor();
    await expect(page.locator("[data-module-archived-notice]")).toBeVisible();
    await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
    await expect(page.locator(".toast", { hasText: "klart for videre redigering" })).toHaveCount(0);
  });

  test("KONTROLL: en aktiv modul med ?resumeEditing=1 åpnes som utkast", async ({ page }) => {
    await openModule(page, { archived: false });
    await page.goto(`${MODULE_PAGE}?resumeEditing=1`);
    await page.locator("#previewEditTitle").waitFor();
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
  });

  test("«Gjenopprett» i hodet gjenoppretter modulen, og sida blir redigerbar igjen", async ({ page }) => {
    await openModule(page, { archived: true });
    const restores: string[] = [];
    page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/restore")) restores.push(request.url()); });
    await page.goto(MODULE_PAGE);
    await page.locator("#previewEditTitle").waitFor();
    await (await revealRowAction(page, page.locator('#moduleFormHead [data-ws-key="restore"]'))).click();

    await expect.poll(() => restores.length).toBe(1);
    await expect(page.locator("[data-module-archived-notice]")).toHaveCount(0);
    await expect(page.locator("#previewEditTitle")).toBeEnabled();
    await expect(page.locator("#formSaveBtn")).toHaveCount(1);
    await expect.poll(() => wsKeys(page)).toContain("publish");
  });

  test("«Slett» i hodet spør, sletter og går til lista", async ({ page }) => {
    await openModule(page, { archived: true });
    const deletes: string[] = [];
    await page.route(`**/api/admin/content/modules/${MODULE_ID}`, async (route: Route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      deletes.push(route.request().url());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ moduleId: MODULE_ID }) });
    });
    const questions: string[] = [];
    page.on("dialog", (dialog) => { questions.push(dialog.message()); void dialog.accept(); });
    await page.goto(MODULE_PAGE);
    await page.locator("#previewEditTitle").waitFor();
    await (await revealRowAction(page, page.locator('#moduleFormHead [data-ws-key="delete"]'))).click();

    await expect.poll(() => deletes.length).toBe(1);
    expect(questions[0]).toContain("Slette modulen «Arbeidsmiljø i praksis (NB)» for godt?");
    await expect(page).toHaveURL(/\/admin-content$/);
  });

  test("390 px: linja og handlingsraden passer, ingen vannrett rulling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openModule(page, { archived: true });
    await page.goto(MODULE_PAGE);
    await page.locator("#previewEditTitle").waitFor();
    const notice = page.locator("[data-module-archived-notice]");
    await expect(notice).toBeVisible();
    const box = await notice.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}-modul-arkivert-rediger-390.png`, fullPage: true });
    await page.locator("#formTab-settings").click();
    await page.locator("#settingsModuleType").waitFor();
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}-modul-arkivert-innstillinger-390.png`, fullPage: true });
  });
});

// ---------------------------------------------------------------------------
// Lagringen i flere steg: 503 content_busy og module_archived (kriteriene tas under innholdslåsen fra #1151)
// ---------------------------------------------------------------------------

test.describe("#1151 skive 3c — feilene fra lagringen vises på brukerens språk", () => {
  async function saveWithEnsureAnswer(page: Page, answer: { status: number; body: unknown }) {
    await openModule(page, { archived: false });
    await page.route("**/api/admin/content/modules/*/rubric-versions/ensure", (route: Route) => route.fulfill({
      status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body),
    }));
    await page.goto(MODULE_PAGE);
    await page.locator("#previewEditTaskText").fill("Ny oppgavetekst som skal lagres.");
    await page.locator("#formSaveBtn").click();
  }

  test("503 content_busy fra kriteriene: meldingen er oversatt, «Prøv igjen» tilbys, og det skrevne er ikke lagret bort", async ({ page }) => {
    await saveWithEnsureAnswer(page, { status: 503, body: { error: "content_busy", message: "Content is busy." } });
    const dialog = page.locator("#dialogChoice");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#dialogChoiceBody")).toHaveText("Lagring feilet: Noen andre endrer innhold akkurat nå. Prøv igjen om et øyeblikk.");
    await expect(page.locator("#dialogChoiceActions button", { hasText: "Prøv igjen" })).toHaveCount(1);
    await page.locator("#dialogChoiceActions button", { hasText: "Avbryt" }).click();
    // Det som ble skrevet, står som ulagret, og kan lagres igjen.
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
    await expect(page.locator("#formSaveBtn")).toBeEnabled();
  });

  test("«Gjenopprett» på en eldre versjon avvist med module_archived: meldingen står alene, uten «Prøv igjen»", async ({ page }) => {
    await openModule(page, { archived: false });
    await page.route("**/api/admin/content/modules/*/module-versions/*/restore", (route: Route) => route.fulfill({
      status: 400, contentType: "application/json", body: JSON.stringify({ error: "module_archived", message: "Module is archived." }),
    }));
    await page.goto(`${MODULE_PAGE}?tab=settings`);
    await page.locator('[data-restore-version="mv-1"]').click();
    await expect(page.locator(".toast--error .toast__message").first()).toHaveText("Gjenoppretting feilet: Modulen er arkivert og kan ikke endres. Gjenopprett den først.");
    await expect(page.locator("#dialogChoice")).not.toBeVisible();
  });

  test("module_archived (arkivert i en annen fane): meldingen er oversatt, og «Prøv igjen» tilbys ikke", async ({ page }) => {
    await saveWithEnsureAnswer(page, { status: 400, body: { error: "module_archived", message: "Module is archived." } });
    await expect(page.locator(".toast--error .toast__message").first()).toHaveText("Lagring feilet: Modulen er arkivert og kan ikke endres. Gjenopprett den først.");
    await expect(page.locator("#dialogChoice")).not.toBeVisible();
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
  });
});

// ---------------------------------------------------------------------------
// Seksjonsredigereren og seksjonslista
// ---------------------------------------------------------------------------

type SectionFixture = Record<string, unknown> & { id: string; archivedAt: string | null };

function section(id: string, overrides: Partial<SectionFixture> = {}): SectionFixture {
  return {
    id,
    title: JSON.stringify({ nb: `Seksjon ${id}`, nn: `Seksjon ${id}`, "en-GB": `Section ${id}` }),
    bodyMarkdown: JSON.stringify({ nb: "# Innhold", nn: "# Innhald", "en-GB": "# Content" }),
    activeVersionId: "sv-1",
    versionNo: 2,
    hasUnpublishedChanges: false,
    updatedAt: "2026-11-01T08:00:00.000Z",
    archivedAt: null,
    canManage: true,
    courseCount: 0,
    courses: [],
    titleLocales: ["nb", "nn", "en-GB"],
    lifecycle: "published",
    ...overrides,
  };
}

async function mockSections(page: Page, sections: SectionFixture[]) {
  await locale(page);
  await mockCommonApis(page, {});
  const byId = new Map(sections.map((s) => [s.id, s]));
  await page.route("**/api/admin/content-owners/**", (route: Route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ owners: [] }),
  }));
  await page.route("**/api/admin/content/sections/preview", (route: Route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>Innhold</p>" }),
  }));
  await page.route(/\/api\/admin\/content\/sections(\/[^/?]+)?(\/(restore|archive))?(\?.*)?$/, async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    const match = /\/sections(?:\/([^/]+))?(?:\/(restore|archive))?$/.exec(path);
    const id = match?.[1] ?? null;
    const action = match?.[2] ?? null;
    if (!id) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [...byId.values()] }) });
    }
    if (id === "preview" || id === "localize" || id === "import") return route.fallback();
    const target = byId.get(id);
    if (!target) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
    if (action === "restore") {
      target.archivedAt = null;
      target.lifecycle = "draft";
      target.activeVersionId = null;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: target }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: target }) });
  });
}

const headerAction = (page: Page, action: string) => page.locator(`.form-page-actions [data-editor-action="${action}"]`);

test.describe("#1151 skive 3c — seksjonsredigereren", () => {
  test("arkivert og eid: linja, sperrede felt, ingen Lagre/Oversett/Erstatt/Last opp bilde; Gjenopprett, Slett og Eksporter står", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await mockSections(page, [section("sec-1", { archivedAt: ARCHIVED_AT, activeVersionId: null, lifecycle: "archived" })]);
    const writes = recordWrites(page);
    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#titleInput").waitFor();

    await expect(page.locator("[data-section-archived-notice]")).toHaveText("Seksjonen er arkivert og kan ikke endres. Gjenopprett den for å endre den.");
    await expect(page.locator("#formSaveBtn")).toHaveCount(0);
    await expect(page.locator("#translateBtn")).toHaveCount(0);
    await expect(page.locator("#replaceFromFileBtn")).toHaveCount(0);
    await expect(page.locator("#uploadImageBtn")).toHaveCount(0);
    await expect(page.locator("#titleInput")).toBeDisabled();
    await expect(page.locator("#markdownInput")).toBeDisabled();
    await expect(headerAction(page, "restore")).toHaveCount(1);
    await expect(headerAction(page, "delete")).toHaveCount(1);
    await expect(headerAction(page, "export")).toHaveCount(1);
    await expect(headerAction(page, "publish")).toHaveCount(0);
    await expect(headerAction(page, "archive")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}-seksjon-arkivert-1280.png`, fullPage: true });

    await page.locator("#formTab-innstillinger").click();
    await expect(page.locator("#ownerPanelHost")).toBeVisible();
    expect(await outsideDisabledFieldset(page.locator("#ownerPanelHost"))).toBe(true);
    expect(writes).toEqual([]);
  });

  test("KONTROLL: en aktiv seksjon har Lagre, Oversett, Erstatt fra fil og Last opp bilde, og feltene er åpne", async ({ page }) => {
    await mockSections(page, [section("sec-1")]);
    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#titleInput").waitFor();
    await expect(page.locator("[data-section-archived-notice]")).toHaveCount(0);
    await expect(page.locator("#formSaveBtn")).toHaveCount(1);
    await expect(page.locator("#translateBtn")).toHaveCount(1);
    await expect(page.locator("#replaceFromFileBtn")).toHaveCount(1);
    await expect(page.locator("#uploadImageBtn")).toHaveCount(1);
    await expect(page.locator("#titleInput")).toBeEnabled();
    await expect(page.locator("[data-section-archived-lock]")).toHaveCount(0);
    await expect(headerAction(page, "archive")).toHaveCount(1);
  });

  test("KONTROLL: en arkivert seksjon forfatteren ikke eier, har verken Gjenopprett eller Slett", async ({ page }) => {
    await mockSections(page, [section("sec-1", { archivedAt: ARCHIVED_AT, lifecycle: "archived", canManage: false })]);
    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#titleInput").waitFor();
    await expect(headerAction(page, "export")).toHaveCount(1);
    await expect(headerAction(page, "restore")).toHaveCount(0);
    await expect(headerAction(page, "delete")).toHaveCount(0);
  });

  test("«Gjenopprett» i redigereren: seksjonen hentes på nytt og kan redigeres", async ({ page }) => {
    await mockSections(page, [section("sec-1", { archivedAt: ARCHIVED_AT, activeVersionId: null, lifecycle: "archived" })]);
    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#titleInput").waitFor();
    await (await revealRowAction(page, headerAction(page, "restore"))).click();
    await expect(page.locator("[data-section-archived-notice]")).toHaveCount(0);
    await expect(page.locator("#titleInput")).toBeEnabled();
    await expect(page.locator("#formSaveBtn")).toHaveCount(1);
    await expect(page.locator("#translateBtn")).toHaveCount(1);
  });

  test("390 px: den arkiverte seksjonen passer, ingen vannrett rulling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSections(page, [section("sec-1", { archivedAt: ARCHIVED_AT, activeVersionId: null, lifecycle: "archived" })]);
    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#titleInput").waitFor();
    const box = await page.locator("[data-section-archived-notice]").boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}-seksjon-arkivert-390.png`, fullPage: true });
  });
});

test.describe("#1151 skive 3c — seksjonslista", () => {
  const SECTIONS = () => [
    section("sec-aktiv", { titleLocales: ["nb"], title: "Aktiv seksjon" }),
    section("sec-arkiv", { titleLocales: ["nb"], title: "Arkivert seksjon", archivedAt: ARCHIVED_AT, activeVersionId: null, lifecycle: "archived" }),
  ];
  const row = (page: Page, id: string) => page.locator(`tr[data-row-id="${id}"]`);

  test("arkivert rad: «Åpne» står, ingen «Døp om» eller «Dupliser»; den aktive har alt; masseoversettingen teller og tar bare den aktive", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSections(page, SECTIONS());
    const translated: string[] = [];
    const patched: string[] = [];
    await page.route("**/api/admin/content/titles/localize", (route: Route) => {
      translated.push(JSON.parse(route.request().postData() ?? "{}").title);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: { nn: "nn", "en-GB": "en" }, failedLocales: [] }) });
    });
    await page.route("**/api/admin/content/sections/*/title", (route: Route) => {
      patched.push(new URL(route.request().url()).pathname);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: {} }) });
    });
    await page.goto("/admin-content/sections");
    await page.locator('.list-filters [data-filter="all"]').click();
    await expect(row(page, "sec-arkiv")).toBeVisible();

    const archived = row(page, "sec-arkiv");
    await revealRowAction(page, archived.locator('[data-action="edit"]'));
    await expect(archived.locator('[data-action="edit"]')).toHaveText("Åpne");
    await expect(archived.locator('[data-action="rename"]')).toHaveCount(0);
    await expect(archived.locator('[data-action="duplicate"]')).toHaveCount(0);
    await expect(archived.locator('[data-action="restore"]')).toHaveCount(1);
    await expect(archived.locator('[data-action="export"]')).toHaveCount(1);
    // KONTROLL i samme liste.
    const active = row(page, "sec-aktiv");
    await expect(active.locator('[data-action="rename"]')).toHaveCount(1);
    await expect(active.locator('[data-action="duplicate"]')).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}-seksjonslista-1280.png`, fullPage: true });

    const button = page.locator("#translateGapsBtn");
    await expect(button).toHaveText("Oversett det som mangler (1)");
    await button.click();
    await expect.poll(() => patched.length).toBe(1);
    expect(patched[0]).toContain("/sections/sec-aktiv/title");
    expect(translated).toEqual(["Aktiv seksjon"]);
  });
});

// ---------------------------------------------------------------------------
// Modulbiblioteket
// ---------------------------------------------------------------------------

test.describe("#1151 skive 3c — modulbiblioteket", () => {
  const MODULES = [
    { id: "mod-aktiv", title: "Aktiv modul", titleLocales: ["nb"], status: "published", courseCount: 0 },
    { id: "mod-arkiv", title: "Arkivert modul", titleLocales: ["nb"], status: "archived", archivedAt: ARCHIVED_AT, courseCount: 0 },
  ];
  const row = (page: Page, id: string) => page.locator(`tr[data-row-id="${id}"]`);

  test("arkivert rad: ingen «Døp om» eller «Dupliser»; «Åpne» fører til den skrivebeskyttede sida; masseoversettingen hopper over den", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await locale(page);
    await mockCommonApis(page, { libraryModules: MODULES as never });
    const translated: string[] = [];
    await page.route("**/api/admin/content/titles/localize", (route: Route) => {
      translated.push(JSON.parse(route.request().postData() ?? "{}").title);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: { nn: "nn", "en-GB": "en" }, failedLocales: [] }) });
    });
    const patched: string[] = [];
    await page.route("**/api/admin/content/modules/*/title", (route: Route) => {
      patched.push(new URL(route.request().url()).pathname);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ module: {} }) });
    });
    await page.goto("/admin-content");
    await page.locator('.list-filters [data-filter="all"]').click();
    const archived = row(page, "mod-arkiv");
    await expect(archived).toBeVisible();
    await expect(page.locator('.list-filters [data-filter="all"]')).toHaveClass(/active/);

    await expect(archived.locator('[data-action="rename"]')).toHaveCount(0);
    await expect(archived.locator('[data-action="duplicate"]')).toHaveCount(0);
    await expect(archived.locator('[data-action="restore"]')).toHaveCount(1);
    await expect(archived.locator('[data-action="export"]')).toHaveCount(1);
    await expect(archived.locator('a[href="/admin-content/module/mod-arkiv/conversation"]')).toHaveCount(1);
    // KONTROLL i samme liste.
    const active = row(page, "mod-aktiv");
    await expect(active.locator('[data-action="rename"]')).toHaveCount(1);
    await expect(active.locator('[data-action="duplicate"]')).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}-modulbiblioteket-1280.png`, fullPage: true });

    const button = page.locator("#translateGapsBtn");
    await expect(button).toHaveText("Oversett det som mangler (1)");
    await button.click();
    await expect.poll(() => patched.length).toBe(1);
    expect(patched[0]).toContain("/modules/mod-aktiv/title");
    expect(translated).toEqual(["Aktiv modul"]);
  });
});

// ---------------------------------------------------------------------------
// Kurslista og kursimporten
// ---------------------------------------------------------------------------

function course(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: { nb: title, nn: title, "en-GB": title },
    description: null,
    certificationLevel: "basic",
    moduleCount: 1,
    updatedAt: "2026-11-01T12:00:00.000Z",
    publishedAt: "2026-11-01T12:00:00.000Z",
    archivedAt: null,
    modules: [],
    ...overrides,
  };
}

test.describe("#1151 skive 3c — kurslista", () => {
  test("«Slett med innhold» bare på det arkiverte kurset — i lista og i det åpnede kurset", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await locale(page);
    await mockCommonApis(page, {
      courses: [course("course-aktiv", "Aktivt kurs"), course("course-arkiv", "Arkivert kurs", { archivedAt: ARCHIVED_AT, publishedAt: null })] as never,
      meRoles: ["ADMINISTRATOR"],
    });
    await page.goto("/admin-content/courses");
    await page.locator('.list-filters [data-filter="all"]').click();
    const archived = page.locator('tr[data-row-id="course-arkiv"]');
    const active = page.locator('tr[data-row-id="course-aktiv"]');
    await expect(archived).toBeVisible();
    await revealRowAction(page, archived.locator('[data-action="cascade-delete"]'));
    await expect(archived.locator('[data-action="cascade-delete"]')).toHaveCount(1);
    await expect(active.locator('[data-action="cascade-delete"]')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}-kurslista-1280.png`, fullPage: true });

    await page.goto("/admin-content/courses/course-arkiv");
    await expect(page.locator('.form-page-actions [data-action="cascade-delete"]')).toHaveCount(1);
    await page.goto("/admin-content/courses/course-aktiv");
    await page.locator("#title-nb").waitFor();
    await expect(page.locator('.form-page-actions [data-action="cascade-delete"]')).toHaveCount(0);
  });
});

test.describe("#1151 skive 3c — kursimporten mot et arkivert kurs", () => {
  function pakke(courseId: string) {
    return {
      exportFormat: "a2-content-export/v1",
      exportedAt: "2026-11-12T08:00:00.000Z",
      scope: "course",
      course: { course: { title: { nb: "Fil", nn: "Fil", "en-GB": "File" }, description: null, certificationLevel: null, origin: { courseId }, audit: {}, items: [] } },
    };
  }

  async function upload(page: Page, courseId: string) {
    await page.setInputFiles("#importCoursePackageFile", { name: "kurs.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pakke(courseId))) });
  }

  test("målkurset er arkivert: dialogen sier det, «Oppdater dette kurset» finnes ikke, og «Importer som nytt kurs» går", async ({ page }) => {
    await locale(page);
    await mockCommonApis(page, { courses: [course("course-arkiv", "Arkivert kurs", { archivedAt: ARCHIVED_AT, publishedAt: null })] as never });
    const sent: Array<{ mode?: string }> = [];
    await page.route("**/api/admin/content/courses/import", (route: Route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ courseId: "course-ny", moduleIds: [] }) });
    });
    await page.goto("/admin-content/courses");
    await upload(page, "course-arkiv");
    const dialog = page.locator("#courseImportChoiceDialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#courseImportChoiceTitle")).toHaveText("Kurset er arkivert");
    await expect(page.locator("#courseImportChoiceText")).toContainText("gjenopprett kurset først, eller importer fila som et nytt kurs");
    await expect(page.locator("#courseImportUpdateBtn")).toBeHidden();
    await expect(page.locator("#courseImportCreateBtn")).toBeVisible();
    await page.locator("#courseImportCreateBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].mode).toBe("createNew");
  });

  test("KONTROLL: et aktivt målkurs har «Oppdater dette kurset» og den vanlige tittelen", async ({ page }) => {
    await locale(page);
    await mockCommonApis(page, { courses: [course("course-aktiv", "Aktivt kurs")] as never });
    await page.goto("/admin-content/courses");
    await upload(page, "course-aktiv");
    await expect(page.locator("#courseImportChoiceDialog")).toBeVisible();
    await expect(page.locator("#courseImportChoiceTitle")).toHaveText("Oppdatere kurset?");
    await expect(page.locator("#courseImportUpdateBtn")).toBeVisible();
    await expect(page.locator("#courseImportChoiceText")).not.toContainText("arkiverte moduler");
  });

  test("aktivt kurs med en arkivert modul: dialogen sier at oppdateringen kan bli avvist", async ({ page }) => {
    await locale(page);
    await mockCommonApis(page, { courses: [course("course-aktiv", "Aktivt kurs", { modules: [{ moduleId: "mod-a", sortOrder: 0, moduleTitle: "A", moduleArchivedAt: ARCHIVED_AT }] })] as never });
    await page.goto("/admin-content/courses");
    await upload(page, "course-aktiv");
    await expect(page.locator("#courseImportChoiceText")).toContainText("Kurset har arkiverte moduler.");
    await expect(page.locator("#courseImportUpdateBtn")).toBeVisible();
  });

  for (const [code, text] of [
    ["course_archived", "Kurset fila hører til, er arkivert og kan ikke oppdateres. Gjenopprett kurset, eller importer fila som et nytt kurs."],
    ["section_archived", "Fila endrer en modul eller seksjon som er arkivert, så kurset ble ikke oppdatert. Gjenopprett den først, eller importer fila som et nytt kurs."],
  ] as const) {
    test(`«Oppdater» avvist med ${code}: meldingen sier hva som går`, async ({ page }) => {
      await locale(page);
      await mockCommonApis(page, { courses: [course("course-aktiv", "Aktivt kurs")] as never });
      await page.route("**/api/admin/content/courses/import", (route: Route) => route.fulfill({
        status: 400, contentType: "application/json", body: JSON.stringify({ error: code, message: "archived" }),
      }));
      await page.goto("/admin-content/courses");
      await upload(page, "course-aktiv");
      await page.locator("#courseImportUpdateBtn").click();
      await expect(page.locator(".toast--error .toast__message").first()).toHaveText(text);
    });
  }
});
