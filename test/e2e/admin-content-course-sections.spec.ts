import { test, expect, type Route } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #524 (U3): the course builder can add a reusable learning section from the library. It must appear in
// the mixed content list as a [SEKSJON] row — colour-coded / distinct from modules via data-item-type +
// the type badge — with its title.
test("course builder: add a section from the library renders it as a [SEKSJON] row", async ({ page }) => {
  await mockCommonApis(page, {
    courses: [
      { id: "course-1", title: { nb: "Kurs" }, certificationLevel: "basic", moduleCount: 0, modules: [] },
    ],
    libraryModules: [],
  });

  // Library sections available to the picker (GET /api/admin/content/sections). Registered after
  // mockCommonApis so this handler wins for the GET; other methods fall through.
  await page.route("**/api/admin/content/sections", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sections: [{ id: "sec-1", title: { nb: "Innføring" } }] }),
    });
  });

  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });

  await page.goto("/admin-content/courses/course-1");

  // The picker is populated, and there is no section row yet.
  await expect(page.locator("#sectionSelect option[value='sec-1']")).toHaveCount(1);
  await expect(page.locator('#moduleList .module-list-item[data-item-type="SECTION"]')).toHaveCount(0);

  // Add the section from the library.
  await page.locator("#sectionSelect").selectOption("sec-1");
  await page.locator("#addSectionBtn").click();

  // It appears as a distinct [SEKSJON] row carrying the section title.
  const sectionRow = page.locator('#moduleList .module-list-item[data-item-type="SECTION"]');
  await expect(sectionRow).toHaveCount(1);
  await expect(sectionRow.locator(".item-type-badge")).toHaveText("SEKSJON");
  await expect(sectionRow).toContainText("Innføring");

  // And it is no longer offered in the picker (can't add the same section twice).
  await expect(page.locator("#sectionSelect option[value='sec-1']")).toHaveCount(0);
});

// #992: kursbyggeren skal ikke by fram noe backend avviser.
//
// Seksjons-API-et returnerer `archivedAt`, men velgeren filtrerte bare bort seksjoner som ALLEREDE
// lå i kurset. Modulsøsterflaten filtrerer til publiserte; seksjonssiden gjorde ikke det.
//
// ⚠️ Konsekvensen er ikke en pen feilmelding: `/items` skriver HELE sekvensen, så et 400 på én
// arkivert rad ruller tilbake alt. Forfatteren mister også de endringene som var i orden.
//
// Den forrige e2e-en bruker bare en seksjon uten `archivedAt` og kunne ikke se dette.
test("#992: kursbyggeren tilbyr ikke arkiverte seksjoner", async ({ page }) => {
  await mockCommonApis(page, {
    courses: [
      { id: "course-1", title: { nb: "Kurs" }, certificationLevel: "basic", moduleCount: 0, modules: [] },
    ],
    libraryModules: [],
  });

  await page.route("**/api/admin/content/sections", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sections: [
          { id: "sec-live", title: { nb: "Innføring" }, archivedAt: null },
          { id: "sec-arkivert", title: { nb: "Utgått rutine" }, archivedAt: "2026-08-01T00:00:00.000Z" },
        ],
      }),
    });
  });

  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content/courses/course-1");

  // ⚠️ REKKEFØLGEN ER POENGET. Første utkast sjekket den arkiverte FØRST, og var grønn selv med
  // filteret fjernet: velgeren var ennå ikke fylt, så assertionen målte en TOM LISTE. Mutasjonstesten
  // avslørte det — uten den hadde jeg trodd funnet var rettet.
  //
  // Vent til lista finnes. Først da betyr fraværet av den arkiverte noe.
  //
  // Den ventingen er samtidig kontrollen: «tøm lista» ville løst funnet og gjort seksjoner umulige
  // å legge inn i det hele tatt.
  await expect(page.locator("#sectionSelect option[value='sec-live']")).toHaveCount(1);
  await expect(page.locator("#sectionSelect option[value='sec-arkivert']")).toHaveCount(0);
  await page.locator("#sectionSelect").selectOption("sec-live");
  await page.locator("#addSectionBtn").click();
  await expect(page.locator('#moduleList .module-list-item[data-item-type="SECTION"]')).toContainText("Innføring");
});
