import { test, expect, type Page, type Route } from "@playwright/test";
import { mockCommonApis, buildMockModuleExport } from "./admin-content-helpers.js";

// #787 QA round 2: the owner-management panel must render on EVERY content surface, not just the course
// detail. Round 1 shipped the panel into the conversational shell's state rail, but three surfaces run
// DIFFERENT front-end files and were missed:
//   - modul-avansert  → admin-content.js         (its own updateStateRail, no owner wiring) — QA #1
//   - klasse-detalj   → admin-content-classes.js (openClass detail)                          — QA #2
//   - seksjon-editor  → admin-content-sections.js(renderEditorView, existing section only)   — QA #3
// These tests drive the REAL front-end JS for each page (static server + mocked APIs) and assert the
// panel renders with its owner — the client-layer proof that would have caught the missed surfaces.

const OWNERS = [{ userId: "u1", name: "Alice Owner", email: "alice@x.no", addedAt: "2026-07-19T00:00:00.000Z" }];

/** Mock the two-verb owner API for one (type,id) so the panel loads with a manageable owner set. */
async function mockOwnerApi(page: Page, contentType: string, contentId: string) {
  let owners = [...OWNERS];
  await page.route(`**/api/admin/content-owners/${contentType}/${contentId}`, async (route: Route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners, canManage: true }) });
    }
    if (route.request().method() === "POST") {
      const { userId } = JSON.parse(route.request().postData() ?? "{}");
      owners = [...owners, { userId, name: "Bob New", email: "bob@x.no", addedAt: "2026-07-19T01:00:00.000Z" }];
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ owners }) });
    }
    return route.fallback();
  });
  await page.route(`**/api/admin/content-owners/${contentType}/${contentId}/*`, async (route: Route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const removed = decodeURIComponent(route.request().url().split("/").pop() ?? "");
    owners = owners.filter((o) => o.userId !== removed);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners }) });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
});

// QA #1 — the Avansert editor (admin-content.js) is a separate surface from the conversational shell.
test("modul-avansert: owner panel renders in the module state-rail host", async ({ page }) => {
  await mockCommonApis(page, {
    modules: [{ id: "module-1", title: "Trade unions" }],
    moduleExports: { "module-1": buildMockModuleExport({ id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1" }) },
  });
  await mockOwnerApi(page, "MODULE", "module-1");

  await page.goto("/admin-content/module/module-1/advanced");

  const panel = page.locator("#moduleOwnerPanelHost .owner-panel");
  await expect(panel).toBeVisible();
  // QA r4: compact by default — owner name shown inline, full list only after expanding.
  await expect(panel.locator(".owner-compact-names")).toContainText("Alice Owner");
  await panel.locator(".owner-edit-toggle").click();
  await expect(panel.locator(".owner-row")).toHaveCount(1);
  await expect(panel.locator(".owner-name").first()).toHaveText("Alice Owner");

  // QA r3 #3: the Avansert editor shows the same content-area sub-nav as Kurs/Seksjoner, with Moduler active.
  const nav = page.locator("#contentAreaNav");
  await expect(nav.locator("#navModuler")).toHaveClass(/active/);
  await expect(nav.locator("#navKurs")).toBeVisible();
  await expect(nav.locator("#navSeksjoner")).toBeVisible();
  // QA r3 #1/#2: the page title is now "Modul", not the old vague workspace label.
  await expect(page.locator("#moduleWorkspaceTitle")).toHaveText("Modul");
});

// QA #2 — classes were never wired for ownership; the panel goes in the openClass detail view.
test("klasse: owner panel renders in the class detail view", async ({ page }) => {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authMode: "mock", navigation: { items: [], workspaceItems: [] }, identityDefaults: { userId: "c1", email: "c@x.no", name: "C", roles: ["ADMINISTRATOR"] } }) }));
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "e2e" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "c1", email: "c@x.no", name: "C", roles: ["ADMINISTRATOR"] }, consent: { accepted: true }, pendingDeletion: null }) }));
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [{ id: "cls-1", name: "Kull 2026", isSystem: false, _count: { members: 0, courseAssignments: 0 } }] }) }));
  await page.route("**/api/admin/content/classes/*/members", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ members: [] }) }));
  await page.route("**/api/admin/content/classes/*/courses", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [] }) }));
  await page.route("**/api/admin/content/courses", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [] }) }));
  await mockOwnerApi(page, "CLASS", "cls-1");

  await page.goto("/deltakere/klasser");
  await page.locator('[data-action="open"][data-id="cls-1"]').click();

  const panel = page.locator("#classOwnerPanelHost .owner-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".owner-compact-names")).toContainText("Alice Owner");
});

// QA #3 — the standalone section editor (admin-content-sections.js), reachable directly via ?id=.
test("seksjon: owner panel renders in the section editor for an existing section", async ({ page }) => {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authMode: "mock", navigation: { items: [], workspaceItems: [] }, identityDefaults: { userId: "c1", email: "c@x.no", name: "C", roles: ["SUBJECT_MATTER_OWNER"] } }) }));
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "e2e" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "c1", email: "c@x.no", name: "C", roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true }, pendingDeletion: null }) }));
  await page.route("**/api/admin/content/sections/preview", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>preview</p>" }) }));
  await page.route("**/api/admin/content/sections/sec-1", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id: "sec-1", title: { nb: "Innledning", nn: "", "en-GB": "" }, bodyMarkdown: { nb: "Tekst", nn: "", "en-GB": "" }, activeVersionId: "v1", archivedAt: null } }) }));
  await mockOwnerApi(page, "SECTION", "sec-1");

  await page.goto("/admin-content/sections?id=sec-1");

  const panel = page.locator("#ownerPanelHost .owner-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".owner-compact-names")).toContainText("Alice Owner");
});
