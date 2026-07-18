import { expect, test } from "@playwright/test";

import { clickEnabledButton, mockCommonApis } from "./admin-content-helpers.js";

// Characterization tests for the admin-content MODULE LIBRARY page
// (`public/admin-content-library.html` + `/static/admin-content-library.js`).
//
// These pin CURRENT behaviour ahead of the #599 refactor. They do NOT assert
// what the page *should* do — only what it does today, against the same static
// harness + mock API used by `admin-content-workspaces.spec.ts` (shared via
// `admin-content-helpers.ts`).
//
// #613: the e2e static server now mirrors production — `/admin-content` serves the module library
// (`admin-content-library.html`), matching doc/route-map.md + src/app.ts. Navigate via the canonical
// route. (The conversational shell, which has no bare production route, is loaded by the workspaces
// spec via its `/admin-content.html` file path instead.)
const LIBRARY_PATH = "/admin-content";

test.describe("admin content module library", () => {
  test("lists library modules in a table with per-row open actions", async ({ page }) => {
    await mockCommonApis(page, {
      libraryModules: [
        { id: "module-1", title: "Trade unions", status: "published" },
        { id: "module-2", title: "Collective bargaining", status: "unpublished_draft" },
      ],
    });

    await page.goto(LIBRARY_PATH);

    // #765: Klasser moved out of the admin-content content-area nav into the «Deltakere» area, so the
    // admin-content nav must NOT expose a Klasser tab anymore (it still shows the content tabs).
    await expect(page.locator('a.content-area-nav-link[href="/admin-content/classes"]')).toHaveCount(0);
    await expect(page.locator('a.content-area-nav-link[href="/deltakere/klasser"]')).toHaveCount(0);
    await expect(page.locator('a.content-area-nav-link[href="/admin-content/courses"]')).toHaveText("Kurs");

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

  // #710 regression guard: the "Brukt i kurs" cell renders a <button> when the count > 0
  // and a <span> when 0. A global `button { width: 100% }` rule once stretched the button to
  // the full cell width, so the centred digit landed ~70px right of the span's "0" — the two
  // numbers were not on the same vertical line across rows. Pin that both elements occupy an
  // identical-width box at the same left edge (shared `.course-count-btn`/`.course-count-zero`
  // geometry with `width: auto`).
  test("#710: 'Brukt i kurs' count aligns across rows (button vs zero-span)", async ({ page }) => {
    await mockCommonApis(page, {
      libraryModules: [
        { id: "module-1", title: "Used module", status: "published", courseCount: 1 },
        { id: "module-2", title: "Unused module", status: "published", courseCount: 0 },
      ],
    });

    await page.goto(LIBRARY_PATH);

    const countBtn = page.locator(".course-count-btn").first();
    const countZero = page.locator(".course-count-zero").first();
    await expect(countBtn).toBeVisible();
    await expect(countZero).toBeVisible();

    const btnBox = await countBtn.boundingBox();
    const zeroBox = await countZero.boundingBox();
    expect(btnBox).not.toBeNull();
    expect(zeroBox).not.toBeNull();

    // Same column → identical left edge; same box geometry → identical width. The historic
    // bug had btn.width ≈ 169px vs zero.width ≈ 29px. Allow 1.5px for sub-pixel rounding.
    expect(Math.abs(btnBox!.x - zeroBox!.x)).toBeLessThan(1.5);
    expect(Math.abs(btnBox!.width - zeroBox!.width)).toBeLessThan(1.5);
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
