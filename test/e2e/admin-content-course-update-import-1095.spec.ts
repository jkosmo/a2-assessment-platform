import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// #1095: en kurspakke som ble eksportert fra dette miljøet bærer kursets id. Når forfatteren
// importerer den, spør dialogen: oppdater det kurset (nye versjoner legges klar) eller importer som
// nytt kurs. En fil uten identitet, eller med en id som ikke finnes her, importeres som nytt kurs
// uten å spørre — slik det alltid var.

const LIBRARY = "/admin-content/courses";

function pakke(origin: { courseId: string } | null) {
  return {
    exportFormat: "a2-content-export/v1",
    exportedAt: "2026-10-12T08:00:00.000Z",
    exportedBy: null,
    exportedByEmail: null,
    scope: "course",
    course: {
      course: {
        title: { nb: "Justert kurs", nn: "Justert kurs", "en-GB": "Adjusted course" },
        description: null,
        certificationLevel: null,
        ...(origin ? { origin } : {}),
        audit: { publishedAt: null, publishedBy: null, publishedByEmail: null, sourceVersionNo: null },
        items: [],
      },
    },
  };
}

async function lastOpp(page: import("@playwright/test").Page, innhold: unknown) {
  await page.setInputFiles("#importCoursePackageFile", { name: "kurs.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(innhold)) });
}

test.describe("#1095 kursimport — oppdater kurset fila hører til, eller importer som nytt", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommonApis(page, {
      courses: [{ id: "course-1", title: "Rapportskriving", description: null, certificationLevel: "basic", moduleCount: 1, updatedAt: "2026-10-11T12:00:00.000Z", publishedAt: "2026-10-11T12:00:00.000Z", archivedAt: null, modules: [] }],
      libraryModules: [],
    });
  });

  test("fila peker på et kurs som finnes: «Oppdater dette kurset» sender updateExisting med kursets id", async ({ page }) => {
    const sendt: unknown[] = [];
    await page.route("**/api/admin/content/courses/import", async (route: Route) => {
      sendt.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ courseId: "course-1", moduleIds: [], heldBackByTranslationGate: false, summary: { updatedSections: 2, updatedModules: 1, createdSections: 1, createdModules: 0, removedSections: 1, removedModules: 0 } }) });
    });
    await page.goto(LIBRARY);
    await lastOpp(page, pakke({ courseId: "course-1" }));

    const dialog = page.locator("#courseImportChoiceDialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#courseImportChoiceText")).toContainText("Rapportskriving");
    await page.locator("#courseImportUpdateBtn").click();

    await expect.poll(() => sendt.length).toBe(1);
    expect(sendt[0]).toMatchObject({ mode: "updateExisting", targetId: "course-1" });
    // Etterpå går siden til kurset, der de nye versjonene ligger klar.
    await expect(page).toHaveURL(/\/admin-content\/courses\/course-1$/);
  });

  test("«Importer som nytt kurs» i dialogen sender createNew; «Avbryt» sender ingenting", async ({ page }) => {
    const sendt: unknown[] = [];
    await page.route("**/api/admin/content/courses/import", async (route: Route) => {
      sendt.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ courseId: "course-9", moduleIds: [], heldBackByTranslationGate: false }) });
    });
    await page.goto(LIBRARY);
    await lastOpp(page, pakke({ courseId: "course-1" }));
    await expect(page.locator("#courseImportChoiceDialog")).toBeVisible();
    await page.locator("#courseImportCancelBtn").click();
    await expect(page.locator("#courseImportChoiceDialog")).toBeHidden();
    await page.waitForTimeout(300);
    expect(sendt).toHaveLength(0);

    await lastOpp(page, pakke({ courseId: "course-1" }));
    await page.locator("#courseImportCreateBtn").click();
    await expect.poll(() => sendt.length).toBe(1);
    expect(sendt[0]).toMatchObject({ mode: "createNew" });
    expect((sendt[0] as Record<string, unknown>).targetId).toBeUndefined();
  });

  test("en fil uten identitet, eller med en id som ikke finnes her, importeres som nytt kurs uten å spørre", async ({ page }) => {
    const sendt: unknown[] = [];
    await page.route("**/api/admin/content/courses/import", async (route: Route) => {
      sendt.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ courseId: "course-9", moduleIds: [], heldBackByTranslationGate: false }) });
    });
    await page.route("**/api/admin/content/courses/finnes-ikke", (route: Route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "course_not_found" }) }));
    await page.goto(LIBRARY);
    await lastOpp(page, pakke(null));
    await expect.poll(() => sendt.length).toBe(1);
    expect(sendt[0]).toMatchObject({ mode: "createNew" });

    await page.goto(LIBRARY);
    await lastOpp(page, pakke({ courseId: "finnes-ikke" }));
    await expect.poll(() => sendt.length).toBe(2);
    expect(sendt[1]).toMatchObject({ mode: "createNew" });
    await expect(page.locator("#courseImportChoiceDialog")).toBeHidden();
  });
});
