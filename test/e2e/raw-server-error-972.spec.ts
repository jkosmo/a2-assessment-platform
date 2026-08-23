import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// #972/#965/#980 — «serverens feiltekst vist rått», i en ekte nettleser.
//
// Dette laget er usynlig for supertest: hvilken streng som havner i toasten, hvilket språk den er
// på, og om detaljene overlever i `.toast__detail` avgjøres av i18n-oppslag og rendring i klienten.
// En backend-test ser bare at 403-en ble sendt.
//
// Regelen som testes (doc/DECISIONS.md → «Feilkoden er kontrakten, ikke teksten»): backend sender
// en KODE, klienten slår den opp i sin egen tabell og rendrer på brukerens språk.
//
// ⚠️ Testene går i BEGGE retninger. En engelsk servertekst vist til en norsk forfatter (#965) og en
// hardkodet norsk servertekst vist til en engelsk forfatter (#980) er samme feil. Konsollene
// defaulter til `en-GB`, så bare å sjekke at det ikke står engelsk ville vært halve jobben.

const SECTION_ROW = {
  id: "sec-972",
  title: JSON.stringify({ nb: "Eid av en annen", "en-GB": "Owned by someone else", nn: "Eigd av ein annan" }),
  activeVersionId: "v1",
  archivedAt: null,
  versionNo: 1,
  courseCount: 0,
  updatedAt: "2026-01-01T00:00:00.000Z",
  canManage: true,
};

async function mockSectionsPage(page: Page, locale: string | null) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: {
          contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] },
        },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }),
  );
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { roles: ["SUBJECT_MATTER_OWNER"] },
        consent: { accepted: true, currentVersion: "1.0" },
      }),
    }),
  );
  await page.route("**/api/admin/content/sections", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sections: [SECTION_ROW] }),
    });
  });
  await page.addInitScript((chosen) => {
    try {
      if (chosen === null) localStorage.removeItem("participant.locale");
      else localStorage.setItem("participant.locale", chosen as string);
    } catch { /* some contexts block localStorage */ }
  }, locale);
}

// Eierskapsvaktas 403 (contentOwnershipService.ts) — hardkodet engelsk på serversiden.
// Avpubliser er valgt framfor Arkiver fordi Arkiver går via `window.confirm`, som Playwright
// avviser automatisk; da hadde kallet aldri blitt sendt og testen målt ingenting.
function mockOwnershipRefusal(page: Page, path: string) {
  return page.route(path, (route: Route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: "content_ownership",
        message: "You can only modify content you own.",
      }),
    }),
  );
}

const toastOf = (page: Page) => page.locator("#toastRegion");

test.describe("#965: eierskapsvaktas 403 på seksjonsflaten", () => {
  test("nb-konsoll får norsk forklaring — ikke «403: {…}» og ikke serverens engelske setning", async ({ page }) => {
    await mockSectionsPage(page, "nb");
    await mockOwnershipRefusal(page, "**/api/admin/content/sections/sec-972/unpublish");

    await page.goto("/admin-content/sections");
    await page.locator('[data-action="unpublish"][data-id="sec-972"]').click();

    const toast = toastOf(page);
    // Setningen sier hva som er galt OG hva forfatteren kan gjøre med det — poenget i #965 var at
    // «You can only modify content you own.» ikke fortalte at løsningen er å be om å bli eier.
    await expect(toast).toContainText(/du eier/i);
    await expect(toast).toContainText(/eier/i);

    // De to feilene i én: rå JSON, og serverens språk.
    await expect(toast).not.toContainText("403:");
    await expect(toast).not.toContainText("content_ownership");
    await expect(toast).not.toContainText("You can only modify content you own.");
  });

  test("KONTROLL, motsatt retning: en-GB-konsoll får engelsk — samme kode, annet språk", async ({ page }) => {
    // Uten denne ville en implementasjon som hardkodet den norske setningen bestått testen over.
    await mockSectionsPage(page, "en-GB");
    await mockOwnershipRefusal(page, "**/api/admin/content/sections/sec-972/unpublish");

    await page.goto("/admin-content/sections");
    await page.locator('[data-action="unpublish"][data-id="sec-972"]').click();

    const toast = toastOf(page);
    await expect(toast).toContainText(/You can only change content you own/i);
    await expect(toast).not.toContainText(/du eier/i);
    await expect(toast).not.toContainText("403:");
  });

  test("KONTROLL, ukjent kode: lokalisert generisk setning med statuskoden, detaljene i detaljfeltet", async ({ page }) => {
    // Uten denne vet vi ikke om vi målte OVERSETTELSEN eller bare at det finnes en streng: en
    // implementasjon som fortsatt returnerte `body.message` for alt den ikke kjente ville bestått
    // testene over.
    await mockSectionsPage(page, "nb");
    await page.route("**/api/admin/content/sections/sec-972/unpublish", (route: Route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "a_code_no_client_knows",
          message: "Some English sentence the client has never seen.",
        }),
      }),
    );

    await page.goto("/admin-content/sections");
    await page.locator('[data-action="unpublish"][data-id="sec-972"]').click();

    const message = page.locator(".toast__message");
    await expect(message).toContainText("409");
    await expect(message).not.toContainText("Some English sentence");
    await expect(message).not.toContainText("{");

    // ⚠️ FORFATTERflatens kontrakt (FEATURE_SURFACE_MAP §24): informasjonen kastes ikke, den
    // flyttes. En forfatter kan sitere diagnostikken videre; en kandidat midt i en test kan ikke,
    // og deltakerflaten viser den derfor ikke.
    await expect(page.locator(".toast__detail")).toContainText("a_code_no_client_knows");
    await expect(page.locator(".toast__detail")).toContainText("Some English sentence the client has never seen.");
  });
});

test.describe("#980: publiseringsdialogens blokkeringer", () => {
  const DRAFT_COURSE = {
    id: "course-980",
    title: "Labour rights",
    description: null,
    certificationLevel: "basic",
    moduleCount: 1,
    updatedAt: "2026-04-18T12:00:00.000Z",
    publishedAt: null,
    archivedAt: null,
    modules: [],
  };

  function mockPreview(page: Page, unpublishedItems: unknown[]) {
    return page.route("**/api/admin/content/courses/*/publish-preview", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          courseId: "course-980",
          allPublished: false,
          publishable: false,
          unpublishedItems,
        }),
      }),
    );
  }

  test("serverens hardkodede bokmål vises ikke i et en-GB-konsoll", async ({ page }) => {
    // Scenariet fra #980: en innholdsansvarlig med konsollet på en-GB (default) trykker Publiser
    // kurs på et kurs med én arkivert modul. Dialogen var engelsk med én bokmålslinje i.
    await mockCommonApis(page, { courses: [{ ...DRAFT_COURSE }] });
    await mockPreview(page, [
      {
        type: "MODULE",
        id: "module-1",
        title: "Trade unions",
        publishable: false,
        blockers: [{ code: "item_archived", message: "Modulen er arkivert. Gjenopprett den før du publiserer." }],
      },
    ]);

    await page.goto("/admin-content/courses");
    await page.locator("#coursesTableBody tr").filter({ hasText: "Labour rights" })
      .locator('[data-action="publish"]').click();

    const dialog = page.locator("#cascadePublishDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("The module is archived. Restore it before you publish.");
    await expect(dialog).not.toContainText("Modulen er arkivert");
  });

  test("samme kode, seksjonsrad: klienten skiller modul fra seksjon — serveren gjør det ikke i koden", async ({ page }) => {
    // `item_archived` sendes for BÅDE moduler og seksjoner. Koden alene kan ikke si hvilken det er;
    // bare klienten vet hvilken rad den tegner. Uten denne testen ville en oversettelse som sa
    // «modulen» for begge sett riktig ut i den forrige testen.
    await mockCommonApis(page, { courses: [{ ...DRAFT_COURSE }] });
    await mockPreview(page, [
      {
        type: "SECTION",
        id: "section-1",
        title: "Introduction",
        publishable: false,
        blockers: [{ code: "item_archived", message: "Seksjonen er arkivert. Gjenopprett den før du publiserer." }],
      },
    ]);

    await page.goto("/admin-content/courses");
    await page.locator("#coursesTableBody tr").filter({ hasText: "Labour rights" })
      .locator('[data-action="publish"]').click();

    const dialog = page.locator("#cascadePublishDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("The section is archived. Restore it before you publish.");
    await expect(dialog).not.toContainText("The module is archived");
    await expect(dialog).not.toContainText("Seksjonen er arkivert");
  });

  test("KONTROLL: en blokkeringskode klienten ikke kjenner beholder serverens årsak, i en lokalisert ramme", async ({ page }) => {
    // ⚠️ Dette er #914, ikke #980: blokkeringene fra contentValidationService bærer ennå ingen
    // `params`, så tallene og tersklene finnes bare inne i den engelske setningen. Å bytte den mot
    // et kodenavn ville fjernet informasjonen forfatteren trenger for å rette feilen. Rammen er
    // lokalisert, årsaken er serverens tekst — sømmen skal være synlig til #914 er gjort.
    await mockCommonApis(page, { courses: [{ ...DRAFT_COURSE }] });
    await mockPreview(page, [
      {
        type: "MODULE",
        id: "module-1",
        title: "Trade unions",
        publishable: false,
        blockers: [
          {
            code: "MCQ_COUNT_FAR_BELOW_BLUEPRINT",
            message: "Blueprint suggested 10 MCQ questions but only 2 are present (20%).",
          },
        ],
      },
    ]);

    await page.goto("/admin-content/courses");
    await page.locator("#coursesTableBody tr").filter({ hasText: "Labour rights" })
      .locator('[data-action="publish"]').click();

    const dialog = page.locator("#cascadePublishDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Cannot be published yet:");
    // Tallene overlever — de er det eneste handlingsbare i meldingen.
    await expect(dialog).toContainText("10 MCQ questions but only 2");
  });
});
