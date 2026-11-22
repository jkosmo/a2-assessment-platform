import { test, expect, type Route } from "@playwright/test";
import { mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

// #1152 skive 4a-1: «Slett» på en arkivert modul i biblioteket.
//
// Før svarte tjeneren med den generelle `delete_module_failed` for alt som hadde versjoner, og forfatteren fikk «noe gikk galt».
// Nå slettes en arkivert modul uten deltakerhistorikk med versjonene sine, og det som holder den igjen har hver sin kode. Testen
// fester klientlaget: at koden slås opp i tekstene, at tallet og kursnavnene fylles fra `details`, at tjenerens egen tekst ikke
// vises, og at en vellykket sletting tar raden ut av lista. Tjenerens svar er etterlignet; at tjeneren sender denne formen, festes
// i test/m2-content-delete-1152.test.ts.

const SERVER_MESSAGE = "SERVERTEKST Module cannot be deleted.";

async function openLibrary(page: import("@playwright/test").Page, deleteResponse: { status: number; body: object }) {
  // Biblioteket står på en-GB i e2e (standard). Raden er arkivert, så «Slett» finnes.
  const libraryModules = [{ id: "module-1152", title: "Archived module 1152", status: "archived", courseCount: 0, courses: [] }];
  await mockCommonApis(page, { libraryModules });
  let deleteCalls = 0;
  await page.route("**/api/admin/content/modules/module-1152", (route: Route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    deleteCalls += 1;
    // Lista leses på nytt etter en vellykket sletting; da er modulen borte.
    if (deleteResponse.status < 300) libraryModules.splice(0, libraryModules.length);
    return route.fulfill({ status: deleteResponse.status, contentType: "application/json", body: JSON.stringify(deleteResponse.body) });
  });
  await page.goto("/admin-content-library.html");
  await page.locator('.list-filter-btn[data-filter="archived"]').click();
  await expect(page.locator(".list-table tbody tr", { hasText: "Archived module 1152" })).toHaveCount(1);
  return () => deleteCalls;
}

async function clickDelete(page: import("@playwright/test").Page) {
  await (await revealRowAction(page, page.locator('[data-action="delete"][data-module-id="module-1152"]'))).click();
  // #1168: sidas egen dialog, ikke nettleserens spørreboks.
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
}

test.describe("#1152 — «Slett» på en arkivert modul i biblioteket", () => {
  test("innleveringer holder modulen igjen: kodens tekst med tallet, ikke tjenerens tekst, og raden står", async ({ page }) => {
    const deleteCalls = await openLibrary(page, {
      status: 400,
      body: { error: "module_has_submissions", message: SERVER_MESSAGE, details: { count: 4 } },
    });
    await clickDelete(page);
    await expect.poll(deleteCalls).toBe(1);

    await expect(page.locator(".toast__message")).toHaveText(
      "The module cannot be deleted because participants have submitted answers to it. Number of submissions: 4. It stays archived, so the results are kept.",
    );
    await expect(page.locator(".toast")).not.toContainText("SERVERTEKST");
    await expect(page.locator(".toast")).not.toContainText("{");
    await expect(page.locator(".list-table tbody tr", { hasText: "Archived module 1152" })).toHaveCount(1);
  });

  test("et kursutkast holder modulen igjen: kursnavnet står i teksten", async ({ page }) => {
    const deleteCalls = await openLibrary(page, {
      status: 400,
      body: { error: "delete_blocked_by_course_draft", message: SERVER_MESSAGE, details: { count: 1, draftCourseTitles: ["Kurs med utkast"] } },
    });
    await clickDelete(page);
    await expect.poll(deleteCalls).toBe(1);

    await expect(page.locator(".toast__message")).toHaveText(
      "This content cannot be deleted because it is in a saved draft of 1 course(s): Kurs med utkast. Take it out of the draft, or discard the draft, first.",
    );
    await expect(page.locator(".toast")).not.toContainText("SERVERTEKST");
  });

  test("KONTROLL: en vellykket sletting tar raden ut av lista og sier at modulen er slettet", async ({ page }) => {
    const deleteCalls = await openLibrary(page, { status: 200, body: { deletedModule: { id: "module-1152", title: "Archived module 1152" } } });
    await clickDelete(page);
    await expect.poll(deleteCalls).toBe(1);

    await expect(page.locator(".list-table tbody tr", { hasText: "Archived module 1152" })).toHaveCount(0);
    await expect(page.locator(".toast__message")).toHaveText("Module deleted.");
  });
});
