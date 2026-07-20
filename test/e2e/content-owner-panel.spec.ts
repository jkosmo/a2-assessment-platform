import { test, expect, type Route } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #787 slice 5: the owner-management panel on the course detail page. Runs the real owner-panel.js
// against mocked owner + user-search APIs — load → render → search-add → remove.
test("course owner panel: lists, adds via search, and removes owners", async ({ page }) => {
  await mockCommonApis(page, {
    courses: [{ id: "course-1", title: { nb: "Kurs" }, certificationLevel: "basic", moduleCount: 0, modules: [] }],
    libraryModules: [],
  });

  let owners = [{ userId: "u1", name: "Alice Owner", email: "alice@x.no", addedAt: "2026-07-19T00:00:00.000Z" }];

  await page.route("**/api/admin/content-owners/COURSE/course-1", async (route: Route) => {
    const method = route.request().method();
    if (method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners, canManage: true }) });
    }
    if (method === "POST") {
      const { userId } = JSON.parse(route.request().postData() ?? "{}");
      owners = [...owners, { userId, name: "Bob New", email: "bob@x.no", addedAt: "2026-07-19T01:00:00.000Z" }];
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ owners }) });
    }
    return route.fallback();
  });
  await page.route("**/api/admin/content-owners/COURSE/course-1/*", async (route: Route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const removed = decodeURIComponent(route.request().url().split("/").pop() ?? "");
    owners = owners.filter((o) => o.userId !== removed);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners }) });
  });
  await page.route("**/api/admin/content/users/search**", async (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ users: [{ id: "u2", name: "Bob New", email: "bob@x.no" }] }),
    }),
  );

  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content/courses/course-1");

  // Panel renders compact with the initial owner; expand to manage.
  const panel = page.locator("#ownerPanelHost .owner-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".owner-compact-names")).toContainText("Alice Owner");
  // QA r6 #1: the compact strip must actually BE a strip. The courses page's own .detail-section
  // padding overrode the shared compact class (page styles load after shared.css), which kept the
  // panel tall — the inline padding fix must win. Pin the rendered height.
  const strip = await page.locator("#ownerPanelHost").boundingBox();
  expect(strip).not.toBeNull();
  expect(strip!.height).toBeLessThanOrEqual(52);
  await panel.locator(".owner-edit-toggle").click();
  await expect(panel.locator(".owner-row")).toHaveCount(1);
  await expect(panel.locator(".owner-name").first()).toHaveText("Alice Owner");

  // Search for and add a co-owner.
  await panel.locator(".owner-search-input").fill("bob");
  const result = panel.locator(".owner-search-results li[data-user-id='u2']");
  await expect(result).toBeVisible();
  await result.click();
  await expect(panel.locator(".owner-row")).toHaveCount(2);

  // Remove the original owner; the co-owner remains.
  await panel.locator(".owner-remove[data-user-id='u1']").click();
  await expect(panel.locator(".owner-row")).toHaveCount(1);
  await expect(panel.locator(".owner-name").first()).toHaveText("Bob New");
});

// #787 QA #6: a content-admin who is NOT an owner (and not admin) still sees the owners (transparency),
// but gets no add/remove controls (canManage=false). This is what makes the panel render on content you
// don't own — previously the ownership-gated GET returned 403 and the panel failed to render.
test("owner panel is read-only when the viewer cannot manage owners", async ({ page }) => {
  await mockCommonApis(page, {
    courses: [{ id: "course-2", title: { nb: "Kurs" }, certificationLevel: "basic", moduleCount: 0, modules: [] }],
    libraryModules: [],
  });
  await page.route("**/api/admin/content-owners/COURSE/course-2", async (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ owners: [{ userId: "u9", name: "Someone Else", email: "else@x.no", addedAt: "2026-07-19T00:00:00.000Z" }], canManage: false }),
    }),
  );

  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content/courses/course-2");

  const panel = page.locator("#ownerPanelHost .owner-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".owner-compact-names")).toContainText("Someone Else");
  // No edit affordance and no management controls for a non-owner viewer.
  await expect(panel.locator(".owner-edit-toggle")).toHaveCount(0);
  await expect(panel.locator(".owner-remove")).toHaveCount(0);
  await expect(panel.locator(".owner-search-input")).toHaveCount(0);
});
