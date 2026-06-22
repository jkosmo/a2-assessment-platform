import { expect, test } from "@playwright/test";

import {
  clickEnabledButton,
  mockCommonApis,
} from "./admin-content-workspaces.spec.js";

// Characterization tests for the admin-content MODULE LIBRARY page
// (`public/admin-content-library.html` + `/static/admin-content-library.js`).
//
// These pin CURRENT behaviour ahead of the #599 refactor. They do NOT assert
// what the page *should* do — only what it does today, against the same static
// harness + mock API used by `admin-content-workspaces.spec.ts`.
//
// Routing note: the canonical production route for the library is `/admin-content`
// (see doc/route-map.md), but the e2e static server (`admin-content-static-server.mjs`)
// still maps `/admin-content` to the conversational shell. The library HTML is reached
// here via its static file path `/admin-content-library.html`, which the static server
// serves through its public-file fallback. This is deliberate: the task forbids editing
// the static server, and the library page's behaviour is identical regardless of the
// URL that served the HTML.
const LIBRARY_PATH = "/admin-content-library.html";

test.describe("admin content module library", () => {
  test("lists library modules in a table with per-row open actions", async ({ page }) => {
    await mockCommonApis(page, {
      libraryModules: [
        { id: "module-1", title: "Trade unions", status: "published" },
        { id: "module-2", title: "Collective bargaining", status: "unpublished_draft" },
      ],
    });

    await page.goto(LIBRARY_PATH);

    const table = page.locator(".library-table");
    await expect(table).toBeVisible();
    await expect(table).toContainText("Trade unions");
    await expect(table).toContainText("Collective bargaining");

    // Each row carries the two "open" links pointing at the canonical module routes.
    await expect(
      page.locator('.library-table a[href="/admin-content/module/module-1/conversation"]'),
    ).toBeVisible();
    await expect(
      page.locator('.library-table a[href="/admin-content/module/module-1/advanced"]'),
    ).toHaveText("Åpne i Avansert");
  });

  test("shows an empty state when the library has no modules", async ({ page }) => {
    await mockCommonApis(page, { libraryModules: [] });

    await page.goto(LIBRARY_PATH);

    await expect(page.locator(".library-empty")).toBeVisible();
    await expect(page.getByText("Ingen moduler ennå")).toBeVisible();
    // The empty state offers its own create entry point.
    await expect(page.locator("#emptyCreateBtn")).toBeVisible();
  });

  test("search box filters the visible rows by module name", async ({ page }) => {
    await mockCommonApis(page, {
      libraryModules: [
        { id: "module-1", title: "Trade unions", status: "published" },
        { id: "module-2", title: "Collective bargaining", status: "published" },
      ],
    });

    await page.goto(LIBRARY_PATH);
    await expect(page.locator(".library-table")).toContainText("Trade unions");

    await page.locator("#librarySearch").fill("collective");

    // Only the matching row survives the client-side filter.
    await expect(page.locator(".library-table")).toContainText("Collective bargaining");
    await expect(page.locator(".library-table")).not.toContainText("Trade unions");

    // A search with no matches renders the "no match" empty state.
    await page.locator("#librarySearch").fill("nonexistent-xyz");
    await expect(page.getByText("Ingen moduler matcher søket.")).toBeVisible();
  });

  test("default 'Aktive' filter hides archived modules, and 'Arkiverte' reveals them", async ({ page }) => {
    await mockCommonApis(page, {
      libraryModules: [
        { id: "module-1", title: "Trade unions", status: "published" },
        { id: "module-2", title: "Old retired module", status: "archived" },
      ],
    });

    await page.goto(LIBRARY_PATH);

    // The "Aktive" filter button is active by default and the archived row is hidden.
    await expect(page.locator('.library-filter-btn[data-filter="active"]')).toHaveClass(/active/);
    await expect(page.locator(".library-table")).toContainText("Trade unions");
    await expect(page.locator(".library-table")).not.toContainText("Old retired module");

    // Switching to "Arkiverte" shows only the archived module.
    await page.locator('.library-filter-btn[data-filter="archived"]').click();
    await expect(page.locator(".library-table")).toContainText("Old retired module");
    await expect(page.locator(".library-table")).not.toContainText("Trade unions");
  });

  test("create-module dialog stays disabled until title and level are provided", async ({ page }) => {
    await mockCommonApis(page, {
      libraryModules: [{ id: "module-1", title: "Trade unions", status: "published" }],
    });

    await page.goto(LIBRARY_PATH);

    await page.locator("#createModuleBtn").click();
    await expect(page.locator("#createModuleDialog")).toHaveAttribute("open", "");

    // The confirm button starts disabled.
    await expect(page.locator("#createOpenConversation")).toBeDisabled();

    // Title alone is not enough — a certification level is also required.
    await page.locator("#newModuleTitle").fill("Workplace safety");
    await expect(page.locator("#createOpenConversation")).toBeDisabled();

    await page.locator("#newModuleLevel").selectOption("basic");
    await expect(page.locator("#createOpenConversation")).toBeEnabled();
  });

  test("creating a module POSTs the title/level and navigates to the conversational editor", async ({ page }) => {
    await mockCommonApis(page, { libraryModules: [] });

    await page.goto(LIBRARY_PATH);

    // From the empty state, open the create dialog.
    await page.locator("#emptyCreateBtn").click();
    await expect(page.locator("#createModuleDialog")).toHaveAttribute("open", "");

    await page.locator("#newModuleTitle").fill("Workplace safety");
    await page.locator("#newModuleLevel").selectOption("intermediate");

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/content/modules") &&
        response.request().method() === "POST",
    );
    await clickEnabledButton(page, "Opprett modul");
    const response = await createResponse;
    const postBody = response.request().postDataJSON() as {
      title?: string;
      certificationLevel?: string;
    };
    expect(postBody.title).toBe("Workplace safety");
    expect(postBody.certificationLevel).toBe("intermediate");

    // The mock module POST returns id "module-1"; the page navigates to its conversation route.
    await expect(page).toHaveURL(/\/admin-content\/module\/module-1\/conversation$/);
  });

  test("clicking 'Åpne i Avansert' navigates to the module's advanced editor", async ({ page }) => {
    await mockCommonApis(page, {
      libraryModules: [{ id: "module-1", title: "Trade unions", status: "published" }],
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": {
          module: {
            id: "module-1",
            title: { "en-GB": "Trade unions", nb: "Fagforeninger", nn: "Fagforeiningar" },
            certificationLevel: "basic",
            activeVersionId: null,
            archivedAt: null,
          },
          selectedConfiguration: {
            source: null,
            moduleVersion: null,
            rubricVersion: null,
            promptTemplateVersion: null,
            mcqSetVersion: null,
          },
          versions: {
            moduleVersions: [],
            rubricVersions: [],
            promptTemplateVersions: [],
            mcqSetVersions: [],
          },
        },
      },
    });

    await page.goto(LIBRARY_PATH);

    await page.locator('.library-table a[href="/admin-content/module/module-1/advanced"]').click();

    await expect(page).toHaveURL(/\/admin-content\/module\/module-1\/advanced$/);
    await expect(page.locator("#moduleStatusTitle")).toContainText("Trade unions");
  });
});
