import { expect, test, type Page, type Route } from "@playwright/test";
import { buildMockModuleExport, mockCommonApis } from "./admin-content-helpers.js";

// #1171 skive 1 (doc/design/PLAN_1169_1171_HODER_OG_RADER.md, «Merkene»):
//   - ett ord per tilstand: «Utkast», «Publisert», «Nyere utkast». «Live», «Live + utkast», «Arbeidsutkast», «Modulgrunnlag» og
//     «Åpen nå» viker;
//   - versjonen som egen brikke ved merket, likt for kurs, modul og seksjon, og ingen brikke før første publisering;
//   - «Alt lagret» bare når noe er lagret. En ny modul lagret med bare navnet har fortsatt noe ulagret: typen lagres med innholdet
//     (QA-porten 27.11.2026), så der skal «Ulagrede endringer» stå.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const nb = async (page: Page) => page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ } });

const LIVE = { id: "v1", versionNo: 5, versionMajor: 2, versionMinor: 1, publishedAt: "2026-09-18T10:00:00.000Z" };

async function openModule(page: Page, versions: Array<Record<string, unknown>>, activeVersionId: string | null, selected: string) {
  const moduleExport = buildMockModuleExport({ id: "m", title: "Modul", moduleVersionId: selected, activeVersionId });
  const current = moduleExport.selectedConfiguration.moduleVersion;
  Object.assign(current, versions.find((version) => version.id === selected) ?? {});
  moduleExport.versions.moduleVersions = versions.map((version) => (version.id === selected ? current : { createdAt: "2026-09-18T09:00:00.000Z", ...version }));
  await mockCommonApis(page, { modules: [{ id: "m", title: "Modul" }], moduleExports: { m: moduleExport } });
  await nb(page);
  await page.goto("/admin-content/module/m/conversation");
}

test.describe("#1171 — modulen", () => {
  test("hodet: «Publisert» og versjonen som egen brikke, ikke «Publisert v2.1» i ett merke", async ({ page }) => {
    await openModule(page, [LIVE], "v1", "v1");
    const hode = page.locator("#moduleFormHead");
    await expect(hode.locator(".status-badge--published")).toHaveText("Publisert");
    await expect(hode.locator(".version-chip.module-version-chip")).toHaveText("v2.1");
    await expect(hode).not.toContainText("Live");
  });

  test("versjonslista: «Publisert» og «Åpen», ikke «Live» og «Åpen nå»", async ({ page }) => {
    await openModule(page, [{ id: "v2", versionNo: 6, versionMajor: null, versionMinor: null, publishedAt: null }, LIVE], "v1", "v2");
    await page.locator("#formTab-settings").click();
    const items = page.locator(".version-list .version-item");
    await expect(items.nth(0).locator(".version-badge.current")).toHaveText("Åpen");
    await expect(items.nth(1).locator(".version-badge.live")).toHaveText("Publisert");
  });

  test("forhåndsvisningen: en lagret versjon nyere enn den publiserte heter «Nyere utkast», ikke «Live + utkast»", async ({ page }) => {
    await openModule(page, [{ id: "v2", versionNo: 6, versionMajor: null, versionMinor: null, publishedAt: null }, LIVE], "v1", "v2");
    await page.locator("#formTab-preview").click();
    await expect(page.locator(".module-status-badge")).toHaveText("Nyere utkast");
    // Samme form som merkene ellers (QA-porten 2.187.0), ikke en egen pille.
    await expect(page.locator(".module-status-badge")).toHaveClass(/status-badge--draft/);
  });

  test("forhåndsvisningen: et utkast som aldri er publisert, heter «Utkast»", async ({ page }) => {
    await openModule(page, [{ id: "v2", versionNo: 1, versionMajor: null, versionMinor: null, publishedAt: null }], null, "v2");
    await page.locator("#formTab-preview").click();
    await expect(page.locator(".module-status-badge")).toHaveText("Utkast");
  });

  test("ny modul: ingen «Alt lagret» før noe er lagret; etter Lagre med bare navnet står fortsatt «Ulagrede endringer» (typen)", async ({ page }) => {
    await mockCommonApis(page, {});
    await nb(page);
    await page.goto("/admin-content/module/new/conversation");
    const merke = page.locator("#formPageDirty");
    await expect(page.locator("#settingsNewName")).toBeVisible();
    await expect(merke).toBeHidden();
    // Plassholderen: ingen «Arbeidsutkast».
    await expect(page.locator("#moduleFormHead")).not.toContainText("Arbeidsutkast");

    await page.locator("#settingsNewName").fill("Prosjektøkonomi");
    await expect(merke).toHaveText("Ulagrede endringer");
    await page.locator("#formSaveBtn").click();
    await expect(page.getByText("Modulen er opprettet. Legg inn innholdet under Rediger.")).toBeVisible();
    // Typen er ikke lagret før innholdet er det — det skal ikke stå «Alt lagret» (da ville typen gått tapt uten varsel).
    await expect(merke).toHaveText("Ulagrede endringer");
    await expect(merke).toBeVisible();
  });

  test("avpublisert modul: «Utkast» og versjonen som brikke, ikke «Utkast v2.1» i ett merke", async ({ page }) => {
    await openModule(page, [LIVE], null, "v1");
    const hode = page.locator("#moduleFormHead");
    await expect(hode.locator(".status-badge--draft")).toHaveText("Utkast");
    await expect(hode.locator(".version-chip.module-version-chip")).toHaveText("v2.1");
    await expect(hode.locator(".status-badge--published")).toHaveCount(0);
  });
});

test.describe("#1171 — listene", () => {
  async function base(page: Page) {
    await nb(page);
    await page.route("**/participant/config", (route: Route) => route.fulfill(json({
      authMode: "mock", navigation: { items: [], workspaceItems: [] },
      identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } },
      calibrationWorkspace: { accessRoles: [] },
    })));
    await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
    await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  }

  test("seksjonslista: versjonen som brikke ved merket, bare for en publisert seksjon; ingen egen versjonskolonne", async ({ page }) => {
    await base(page);
    const title = (text: string) => JSON.stringify({ nb: text, nn: text, "en-GB": text });
    await page.route("**/api/admin/content/sections", (route: Route) => route.fulfill(json({ sections: [
      { id: "s-pub", title: title("Publisert seksjon"), activeVersionId: "v5", versionNo: 5, latestVersionNo: 5, archivedAt: null, courseCount: 0, courses: [], updatedAt: "2026-11-01T08:00:00.000Z", lifecycle: "published", canManage: true },
      { id: "s-utk", title: title("Utkastseksjon"), activeVersionId: null, versionNo: null, latestVersionNo: 1, archivedAt: null, courseCount: 0, courses: [], updatedAt: "2026-11-01T08:00:00.000Z", lifecycle: "draft", canManage: true },
    ] })));
    await page.goto("/admin-content/sections");
    const rad = (tekst: string) => page.locator(".list-table tr", { hasText: tekst });
    await expect(rad("Publisert seksjon").locator(".version-chip")).toHaveText("v5");
    await expect(rad("Utkastseksjon").locator(".status-badge--draft")).toHaveText("Utkast");
    await expect(rad("Utkastseksjon").locator(".version-chip")).toHaveCount(0);
    await expect(rad("Utkastseksjon")).not.toContainText("v1");
    await expect(page.locator(".list-table th", { hasText: "Versjon" })).toHaveCount(0);
  });

  test("kurslista: et kurs som aldri er publisert, har ingen versjonsbrikke; et publisert har «v3.2»", async ({ page }) => {
    await mockCommonApis(page, {});
    await nb(page);
    const title = (text: string) => JSON.stringify({ nb: text, nn: text, "en-GB": text });
    const kurs = (id: string, navn: string, extra: Record<string, unknown>) => ({
      id, title: title(navn), description: null, certificationLevel: "basic", enrollmentPolicy: "OPEN", moduleCount: 0, sortOrder: null,
      updatedAt: "2026-11-01T08:00:00.000Z", archivedAt: null, inProgressCount: 0, canManage: true, themes: [], ...extra,
    });
    await page.route("**/api/admin/content/courses", (route: Route) => route.fulfill(json({ courses: [
      kurs("k-ny", "Aldri publisert", { publishedAt: null, lifecycle: "draft", versionMajor: 1, versionMinor: 0 }),
      kurs("k-pub", "Publisert kurs", { publishedAt: "2026-10-01T08:00:00.000Z", lifecycle: "published", versionMajor: 3, versionMinor: 2 }),
      // Arkivert på v1.0 uten publishedAt: kan ha vært publisert, så brikken står som før (stage-data 28.11.2026).
      kurs("k-ark", "Arkivert kurs", { publishedAt: null, archivedAt: "2026-10-05T08:00:00.000Z", lifecycle: "archived", versionMajor: 1, versionMinor: 0 }),
    ] })));
    await page.goto("/admin-content/courses");
    const rad = (tekst: string) => page.locator(".list-table tr", { hasText: tekst });
    await expect(rad("Publisert kurs").locator(".course-version-chip")).toHaveText("v3.2");
    await expect(rad("Aldri publisert").locator(".status-badge--draft")).toHaveText("Utkast");
    await expect(rad("Aldri publisert").locator(".course-version-chip")).toHaveCount(0);
    await page.locator('.list-filter-btn[data-filter="archived"], [data-list-filter="archived"]').first().click();
    await expect(rad("Arkivert kurs").locator(".course-version-chip")).toHaveText("v1.0");
  });
});

test.describe("#1171 — «Alt lagret» bare når noe er lagret", () => {
  test("nytt kurs: ingenting står før man skriver; så «Ulagrede endringer»", async ({ page }) => {
    await mockCommonApis(page, {});
    await nb(page);
    await page.goto("/admin-content/courses/new");
    const merke = page.locator("#formPageDirty");
    await expect(page.locator("#title-nb")).toBeVisible();
    await expect(merke).toBeHidden();
    await page.locator("#title-nb").fill("Nytt kurs");
    await expect(merke).toBeVisible();
    await expect(merke).toHaveText("Ulagrede endringer");
  });

  test("kontroll: et lagret kurs viser «Alt lagret»", async ({ page }) => {
    await mockCommonApis(page, { courses: [{ id: "course-1", title: "Kurs", modules: [] } as never] });
    await nb(page);
    await page.goto("/admin-content/courses/course-1");
    await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
    await expect(page.locator("#formPageDirty")).toBeVisible();
  });
});
