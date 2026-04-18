import AxeBuilderModule from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

const AxeBuilder = (AxeBuilderModule.default ?? AxeBuilderModule) as any;

type MockModule = {
  id: string;
  title: string;
  activeVersion?: { versionNo: number };
};

type MockLibraryModule = {
  id: string;
  title?: string;
  status?: string;
};

type MockCourse = {
  id: string;
  title: Record<string, string>;
  certificationLevel: string;
  moduleCount?: number;
  updatedAt?: string;
  publishedAt?: string;
};

async function mockCommonApis(page: Page, {
  modules = [],
  libraryModules = [],
  courses = [],
}: {
  modules?: MockModule[];
  libraryModules?: MockLibraryModule[];
  courses?: MockCourse[];
} = {}) {
  await page.route("**/participant/config", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { workspaceItems: [], profileItem: null },
        identityDefaults: {
          userId: "content-owner-1",
          email: "content.owner@example.test",
          name: "Content Owner",
          department: "Learning",
          roles: ["SUBJECT_MATTER_OWNER"],
        },
      }),
    });
  });

  await page.route("**/version", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ version: "e2e" }),
    });
  });

  await page.route("**/api/queue-counts", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reviews: 0, appeals: 0 }),
    });
  });

  await page.route("**/api/admin/content/modules/library**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ modules: libraryModules }),
    });
  });

  await page.route("**/api/admin/content/modules", async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ modules }),
    });
  });

  await page.route("**/api/admin/content/courses", async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ courses }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  await page.route("**/api/admin/content/courses/*", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}

test.describe("admin content browser coverage", () => {
  test("shell idle flow opens the module picker and renders existing module choices", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [
        { id: "module-1", title: "Trade unions", activeVersion: { versionNo: 2 } },
        { id: "module-2", title: "Collective bargaining" },
      ],
    });

    await page.goto("/admin-content");

    await expect(page.locator("#moduleWorkspaceTitle")).toBeVisible();
    await expect(page.getByText("What would you like to do?")).toBeVisible();
    await page.getByRole("button", { name: "Open existing module" }).click();

    await expect(page.getByRole("button", { name: /Trade unions/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Collective bargaining/ })).toBeVisible();
  });

  test("courses conversational flow accepts Enter on course title and advances to certification choices", async ({ page }) => {
    await mockCommonApis(page, { libraryModules: [] });

    await page.goto("/admin-content/courses/new");

    const titleInput = page.locator("#convTitleInput");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("Labour rights");
    await titleInput.press("Enter");

    await expect(titleInput).toBeDisabled();
    await expect(page.getByRole("button", { name: "Basic" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Intermediate" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Advanced" })).toBeVisible();
  });

  test("courses list opens a delete dialog bound to the chosen course", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: { "en-GB": "Trade unions", nb: "Fagforeninger" },
          certificationLevel: "advanced",
          moduleCount: 3,
          updatedAt: "2026-04-18T10:30:00.000Z",
        },
      ],
    });

    await page.goto("/admin-content/courses");

    await expect(page.getByRole("table", { name: "Kursliste" })).toBeVisible();
    await page.locator('[data-action="delete"]').first().click();

    await expect(page.locator("#deleteDialog")).toHaveAttribute("open", "");
    await expect(page.locator("#deleteDialogText")).toContainText("Trade unions");
  });

  test("shell and courses routes pass an accessibility smoke check", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [],
    });

    await page.goto("/admin-content");
    const shellResults = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    const shellViolations = shellResults.violations.filter((violation: { impact?: string | null }) =>
      ["critical", "serious"].includes(violation.impact || ""),
    );
    expect(shellViolations).toEqual([]);

    await page.goto("/admin-content/courses");
    const coursesResults = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    const courseViolations = coursesResults.violations.filter((violation: { impact?: string | null }) =>
      ["critical", "serious"].includes(violation.impact || ""),
    );
    expect(courseViolations).toEqual([]);
  });
});
