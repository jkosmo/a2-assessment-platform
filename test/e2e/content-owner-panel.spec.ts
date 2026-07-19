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
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners }) });
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

  // Panel renders with the initial owner.
  const panel = page.locator("#ownerPanelHost .owner-panel");
  await expect(panel).toBeVisible();
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
