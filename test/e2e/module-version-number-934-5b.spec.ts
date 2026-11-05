import { expect, test, type Page, type Route } from "@playwright/test";
import { buildMockModuleExport, mockCommonApis } from "./admin-content-helpers.js";

// #934 skive 5b: versjonsnummeret. Lista viser «v2.1» der den viste «v5», og `versionNo` står i API-et som før.
// Serveren uten nummer (eller en versjon som aldri er publisert) må ikke gi «vnull» eller et tomt merke.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

test.describe("#934 skive 5b — modullista for forfatteren", () => {
  test("viser versjonen som er ute; en modul uten aktiv versjon har ikke noe merke; eldre svar viser det de alltid har vist", async ({ page }) => {
    await mockCommonApis(page, {
      libraryModules: [
        { id: "ute", title: "Modul ute", status: "published", activeVersionNo: 5, activeVersionMajor: 2, activeVersionMinor: 1 } as never,
        { id: "utkast", title: "Modul utkast", status: "unpublished_draft", activeVersionNo: null, activeVersionMajor: null, activeVersionMinor: null } as never,
        { id: "gammel", title: "Modul gammel", status: "published", activeVersionNo: 7, activeVersionMajor: null, activeVersionMinor: null } as never,
      ],
    });
    await page.goto("/admin-content");
    const rad = (tittel: string) => page.locator(".list-table tr", { hasText: tittel });
    await expect(rad("Modul ute").locator(".module-version-chip")).toHaveText("v2.1");
    await expect(rad("Modul utkast").locator(".module-version-chip")).toHaveCount(0);
    await expect(rad("Modul gammel").locator(".module-version-chip")).toHaveText("v7");
  });
});

test.describe("#934 skive 5b — modulsiden", () => {
  async function open(page: Page, versions: Array<Record<string, unknown>>, activeVersionId: string | null, selected: string) {
    const moduleExport = buildMockModuleExport({ id: "m", title: "Modul", moduleVersionId: selected, activeVersionId });
    const current = moduleExport.selectedConfiguration.moduleVersion;
    const own = versions.find((version) => version.id === selected) ?? {};
    Object.assign(current, own);
    moduleExport.versions.moduleVersions = versions.map((version) => (version.id === selected ? current : { createdAt: "2026-09-18T09:00:00.000Z", ...version }));
    await mockCommonApis(page, { modules: [{ id: "m", title: "Modul" }], moduleExports: { m: moduleExport } });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.goto("/admin-content/module/m/conversation");
  }

  const LIVE = { id: "v1", versionNo: 5, versionMajor: 2, versionMinor: 1, publishedAt: "2026-09-18T10:00:00.000Z" };

  test("hodet viser «Publisert v2.1», og et utkast uten nummer er bare et utkast", async ({ page }) => {
    await open(page, [{ id: "v2", versionNo: 6, versionMajor: null, versionMinor: null, publishedAt: null }, LIVE], "v1", "v2");
    const hode = page.locator("#moduleFormHead");
    await expect(hode).toContainText("Publisert v2.1");
    await expect(hode).toContainText("Utkast");
    await expect(hode).not.toContainText("v6");
  });

  test("versjonshistorikken viser nummeret, og et utkast sier at det er et utkast", async ({ page }) => {
    await open(page, [{ id: "v2", versionNo: 6, versionMajor: null, versionMinor: null, publishedAt: null }, LIVE], "v1", "v2");
    await page.locator("#formTab-settings").click();
    const items = page.locator(".version-list .version-item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).locator(".version-no")).toHaveText("Utkast (lagring 6)");
    await expect(items.nth(1).locator(".version-no")).toHaveText("Versjon 2.1");
    await expect(items.nth(1).locator(".version-restore")).toHaveAttribute("aria-label", "Gjenopprett versjon 2.1");
  });

  test("eldre svar uten nummer: hodet viser det det alltid har vist", async ({ page }) => {
    await open(page, [{ id: "v1", versionNo: 5, publishedAt: "2026-09-18T10:00:00.000Z" }], "v1", "v1");
    await expect(page.locator("#moduleFormHead")).toContainText("Publisert v5");
  });
});

test.describe("#934 skive 5b — modullista for deltakeren", () => {
  async function participant(page: Page, activeVersion: Record<string, unknown>) {
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.route("**/participant/config", (route: Route) => route.fulfill(json({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
      calibrationWorkspace: { accessRoles: [] },
      flow: {},
      output: {},
    })));
    await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
    await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
    await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
    await page.route("**/api/courses", (route: Route) => route.fulfill(json({ courses: [] })));
    await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
    await page.route("**/api/courses/enrollments", (route: Route) => route.fulfill(json({ enrollments: [] })));
    await page.route("**/api/modules**", (route: Route) => route.fulfill(json({
      modules: [{ id: "m-1", title: "Modulen", description: null, assessmentMode: "MCQ_ONLY", submissionSchema: null, assessmentPolicy: null, taskText: null, activeVersion, participantStatus: null }],
    })));
    await page.goto("/participant");
    await page.locator("#loadModules").click();
  }

  test("viser «v2.1»", async ({ page }) => {
    await participant(page, { id: "mv", versionNo: 5, versionMajor: 2, versionMinor: 1, publishedAt: "2026-09-18T10:00:00.000Z" });
    await expect(page.locator(".module-version-tag").first()).toHaveText(" · v2.1");
  });

  test("eldre svar uten nummer: «v5»", async ({ page }) => {
    await participant(page, { id: "mv", versionNo: 5 });
    await expect(page.locator(".module-version-tag").first()).toHaveText(" · v5");
  });
});
