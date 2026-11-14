import { expect, test, type Page, type Route } from "@playwright/test";
import { mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

// #1152 skive 4a-2: hva som holder et arkivert kurs igjen fra sletting, sagt til den som trykker «Slett».
//
// Tjeneren svarer `400 course_has_completed_without_certificate` eller `400 course_has_pending_reviews` med `details: { count }`
// fra «Slett», og kaskadens forhåndsvisning lister de samme grunnene med `code` og `details`. Setningen lages her, i klienten, på
// forfatterens språk; tjenerens tekst vises ikke. At tjeneren sender denne formen, festes i test/m2-course-delete-1152.test.ts.
//
// Det testen fester, er klientlaget: at kodene slås opp på alle tre språk, at tallet fylles inn, at både lista og det åpnede
// kurset viser det, og at kaskadedialogen oversetter grunnene og lister et element som ikke er arkivert, for seg.

const SERVER_MESSAGE = "SERVERTEKST Cannot delete the course.";

const EXPECTED = {
  course_has_completed_without_certificate: {
    nb: "Kurset kan ikke slettes fordi 2 deltaker(e) har fullført kravet uten kursbevis. Kurset må gjenopprettes og publiseres for at de skal få kursbeviset.",
    nn: "Kurset kan ikkje slettast fordi 2 deltakar(ar) har fullført kravet utan kursbevis. Kurset må gjenopprettast og publiserast for at dei skal få kursbeviset.",
    "en-GB": "The course cannot be deleted because 2 participant(s) have completed the requirement without a certificate. Restore and publish the course so they get the certificate.",
  },
  course_has_pending_reviews: {
    nb: "Kurset kan ikke slettes ennå fordi 2 besvarelse(r) i kursets moduler venter på vurdering, manuell behandling eller anke. Kurset kan slettes når de er avgjort.",
    nn: "Kurset kan ikkje slettast enno fordi 2 svar i modulane til kurset ventar på vurdering, manuell behandling eller anke. Kurset kan slettast når dei er avgjorde.",
    "en-GB": "The course cannot be deleted yet because 2 submission(s) in its modules are waiting for assessment, manual review or appeal. The course can be deleted when they are resolved.",
  },
} as const;

const ARCHIVED_COURSE = {
  id: "course-1152",
  title: "Arbeidsmiljø 1152",
  description: null,
  certificationLevel: "basic",
  moduleCount: 1,
  updatedAt: "2026-11-01T12:00:00.000Z",
  publishedAt: null,
  archivedAt: "2026-11-02T12:00:00.000Z",
  modules: [],
};

async function setLocale(page: Page, value: string) {
  await page.addInitScript((loc) => { try { localStorage.setItem("participant.locale", loc); } catch { /* ignore */ } }, value);
}

/** «Slett» svarer med koden. Teller kallene, så testen vet at tjeneren ble spurt. */
async function mockDelete(page: Page, code: string) {
  let calls = 0;
  await page.route("**/api/admin/content/courses/course-1152", async (route: Route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    calls += 1;
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: code, message: SERVER_MESSAGE, details: { count: 2 } }) });
  });
  return () => calls;
}

async function openList(page: Page) {
  await page.goto("/admin-content/courses");
  await page.locator('.list-filters [data-filter="all"]').click();
}

const row = (page: Page) => page.locator("#coursesTableBody tr").filter({ hasText: "Arbeidsmiljø 1152" });

test.describe("#1152 — «Slett» på et arkivert kurs sier hva som holder det igjen", () => {
  for (const code of ["course_has_completed_without_certificate", "course_has_pending_reviews"] as const) {
    for (const locale of ["nb", "nn", "en-GB"] as const) {
      test(`lista, ${code}, ${locale}: setningen med tallet, uten plassholder og uten tjenerens tekst`, async ({ page }) => {
        await mockCommonApis(page, { courses: [{ ...ARCHIVED_COURSE }], meRoles: ["SUBJECT_MATTER_OWNER"] });
        await setLocale(page, locale);
        const calls = await mockDelete(page, code);
        await openList(page);

        await (await revealRowAction(page, row(page).locator('[data-action="delete"]'))).click();
        await page.locator("#deleteConfirmBtn").click();
        await expect.poll(calls).toBe(1);

        await expect(page.locator(".toast__message")).toHaveText(EXPECTED[code][locale]);
        await expect(page.locator(".toast")).not.toContainText("{");
        await expect(page.locator(".toast")).not.toContainText("SERVERTEKST");
        // Kurset står: dialogen kan prøves igjen, og raden er der.
        await expect(row(page)).toBeVisible();
      });
    }
  }

  test("det åpnede kurset: samme setning fra «Slett» i toppen", async ({ page }) => {
    await mockCommonApis(page, { courses: [{ ...ARCHIVED_COURSE }], meRoles: ["SUBJECT_MATTER_OWNER"] });
    await setLocale(page, "nb");
    const calls = await mockDelete(page, "course_has_pending_reviews");
    await page.goto("/admin-content/courses/course-1152");

    await (await revealRowAction(page, page.locator('.form-page-actions [data-action="delete"]'))).click();
    await page.locator("#deleteConfirmBtn").click();
    await expect.poll(calls).toBe(1);
    await expect(page.locator(".toast__message")).toHaveText(EXPECTED.course_has_pending_reviews.nb);
  });
});

test.describe("#1152 — kaskaden: grunnene på forfatterens språk, og det som ikke er arkivert, for seg", () => {
  const PREVIEW = {
    courseId: "course-1152",
    courseTitle: "Arbeidsmiljø 1152",
    deletableModules: [],
    deletableSections: [],
    sparedModules: [
      { id: "mod-shared", title: "Delt modul", reason: "Delt med 1 annet kurs: «Annet kurs». Kobles kun fra dette kurset.", stays: "shared" },
      { id: "mod-active", title: "Aktiv modul", reason: "Ikke arkivert. Blir stående, og kobles bare fra dette kurset.", stays: "not_archived" },
    ],
    sparedSections: [],
    blockers: [
      { id: "course-1152", title: "Arbeidsmiljø 1152", reason: "NORSK RESERVE 1", code: "course_has_completed_without_certificate", details: { count: 2 } },
      { id: "course-1152", title: "Arbeidsmiljø 1152", reason: "NORSK RESERVE 2", code: "course_has_pending_reviews", details: { count: 2 } },
    ],
    deletable: false,
  };

  for (const locale of ["nb", "en-GB"] as const) {
    test(`${locale}: blokkeringene oversatt med tallet; «Slett» skjult; det aktive elementet under egen overskrift`, async ({ page }) => {
      await mockCommonApis(page, { courses: [{ ...ARCHIVED_COURSE }], meRoles: ["ADMINISTRATOR"] });
      await setLocale(page, locale);
      await page.route("**/api/admin/content/courses/*/cascade-delete-preview", (route: Route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PREVIEW) }));
      await openList(page);
      await (await revealRowAction(page, row(page).locator('[data-action="cascade-delete"]'))).click();

      const dialog = page.locator("#cascadeDeleteDialog");
      await expect(dialog).toContainText(EXPECTED.course_has_completed_without_certificate[locale]);
      await expect(dialog).toContainText(EXPECTED.course_has_pending_reviews[locale]);
      await expect(dialog).not.toContainText("NORSK RESERVE");
      await expect(page.locator("#cascadeDeleteConfirmBtn")).toBeHidden();

      // Det aktive elementet står under sin egen overskrift, ikke under «delt med andre kurs», og uten serverens norske tekst.
      const staysHeading = dialog.locator('[data-testid="cascade-delete-stays-active"]');
      await expect(staysHeading).toBeVisible();
      const activeList = staysHeading.locator("xpath=following-sibling::ul[1]");
      await expect(activeList).toContainText("Aktiv modul");
      await expect(activeList).not.toContainText("Delt modul");
      await expect(activeList).not.toContainText("Ikke arkivert");
    });
  }
});
