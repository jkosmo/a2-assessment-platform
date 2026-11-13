import { test, expect, type Page, type Route } from "@playwright/test";
import { mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

// #1149: sletting stoppes også av arkiverte kurs, og meldingen sier hvilke kurs som er arkiverte.
//
// Etter #1149 er dette en vanlig vei: «Slett» vises bare på et arkivert element, og et element kan nå
// arkiveres mens det ligger i et arkivert kurs. Tjeneren svarer `400 content_in_archived_course` med
// kursene i `details`; setningen forfatteren ser, lages her i klienten på hens språk.
//
// Det testen fester, er klientlaget: at koden slås opp i alle tre språk, at alle fire plassholderne
// fylles fra `details`, og at begge flatene som sletter (seksjonen i editoren, modulen i biblioteket)
// viser den. Tjenerens svar er etterlignet; at tjeneren faktisk sender denne formen, festes i
// test/m2-archived-courses-not-in-use-1149.test.ts.

const DETAILS = { count: 2, courseTitles: ["Kurs A", "Kurs B"], archivedCount: 1, archivedCourseTitles: ["Kurs B"] };
// Tjenerens reserve-tekst, på bokmål uansett språk. Den skal ALDRI vises: setningen kommer fra oversettelsene.
const SERVER_MESSAGE = "SERVERTEKST Seksjonen kan ikke slettes fordi den ligger i 2 kurs.";

const EXPECTED = {
  nb: "Innholdet kan ikke slettes fordi det ligger i 2 kurs: Kurs A, Kurs B. Arkiverte kurs (1): Kurs B. Et arkivert kurs beholder innholdet sitt.",
  nn: "Innhaldet kan ikkje slettast fordi det ligg i 2 kurs: Kurs A, Kurs B. Arkiverte kurs (1): Kurs B. Eit arkivert kurs beheld innhaldet sitt.",
  "en-GB": "This content cannot be deleted because it is in 2 course(s): Kurs A, Kurs B. Archived courses (1): Kurs B. An archived course keeps its content.",
} as const;

async function mockSectionBase(page: Page, locale: string) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.addInitScript((value) => {
    try { localStorage.setItem("participant.locale", value); } catch { /* ignore */ }
  }, locale);
}

// En arkivert seksjon. `courseCount: 0` og `courses: []` er det tjeneren sender etter #1149 for en seksjon som
// bare ligger i et arkivert kurs: lista viser den som ubrukt, og likevel kan den ikke slettes.
const archivedSection = {
  id: "sec-1149",
  title: JSON.stringify({ nb: "Arkivert seksjon", nn: "Arkivert seksjon", "en-GB": "Archived section" }),
  bodyMarkdown: JSON.stringify({ nb: "x", nn: "x", "en-GB": "x" }),
  activeVersionId: null,
  versionNo: 1,
  updatedAt: "2026-11-01T00:00:00.000Z",
  archivedAt: "2026-11-02T00:00:00.000Z",
  lifecycle: "archived",
  courseCount: 0,
  courses: [],
  canManage: true,
  assets: [],
};

async function openArchivedSection(page: Page, locale: string, deleteResponse: { status: number; body: object }) {
  await mockSectionBase(page, locale);
  await page.route("**/api/admin/content/sections", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [archivedSection] }) }));
  await page.route("**/api/admin/content-owners/SECTION/sec-1149", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners: [], canManageOwners: false }) }));
  let deleteCalls = 0;
  await page.route("**/api/admin/content/sections/sec-1149", (route: Route) => {
    if (route.request().method() === "DELETE") {
      deleteCalls += 1;
      return route.fulfill({ status: deleteResponse.status, contentType: "application/json", body: JSON.stringify(deleteResponse.body) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: archivedSection }) });
  });
  await page.goto("/admin-content/sections?id=sec-1149");
  return () => deleteCalls;
}

test.describe("#1149 — sletting stoppet av et arkivert kurs: meldingen sier hvilke kurs som er arkiverte", () => {
  for (const locale of ["nb", "nn", "en-GB"] as const) {
    test(`seksjonen i editoren, ${locale}: setningen navngir kursene og det arkiverte, uten plassholdere og uten tjenerens tekst`, async ({ page }) => {
      const deleteCalls = await openArchivedSection(page, locale, {
        status: 400,
        body: { error: "content_in_archived_course", message: SERVER_MESSAGE, details: DETAILS },
      });

      page.once("dialog", (dialog) => dialog.accept());
      await (await revealRowAction(page, page.locator("#sectionDeleteBtn"))).click();
      await expect.poll(deleteCalls).toBe(1);

      const toast = page.locator(".toast__message");
      await expect(toast).toHaveText(EXPECTED[locale]);
      // Ingen plassholder står igjen, og tjenerens bokmål er ikke vist, verken i overskriften eller i detaljfeltet.
      await expect(page.locator(".toast")).not.toContainText("{");
      await expect(page.locator(".toast")).not.toContainText("SERVERTEKST");
      // Seksjonen er ikke slettet: forfatteren står fortsatt på den.
      await expect(page.locator("#sectionDeleteBtn")).toBeAttached();
    });
  }

  test("KONTROLL: uten arkiverte kurs sender tjeneren `content_in_use`, og setningen er den gamle", async ({ page }) => {
    const deleteCalls = await openArchivedSection(page, "nb", {
      status: 400,
      body: { error: "content_in_use", message: SERVER_MESSAGE, details: { count: 1, courseTitles: ["Kurs A"] } },
    });

    page.once("dialog", (dialog) => dialog.accept());
    await (await revealRowAction(page, page.locator("#sectionDeleteBtn"))).click();
    await expect.poll(deleteCalls).toBe(1);
    await expect(page.locator(".toast__message")).toHaveText("Innholdet er i bruk i 1 kurs: Kurs A. Fjern det fra kursene først, eller avpubliser dem.");
  });

  test("modulen i biblioteket: samme setning, og raden står igjen", async ({ page }) => {
    // Biblioteket står på en-GB i e2e (standard). Raden er arkivert, så «Slett» finnes; `courseCount: 0` fordi
    // modulen bare ligger i et arkivert kurs.
    await mockCommonApis(page, {
      libraryModules: [{ id: "module-1149", title: "Archived module", status: "archived", courseCount: 0, courses: [] }],
    });
    let deleteCalls = 0;
    await page.route("**/api/admin/content/modules/module-1149", (route: Route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      deleteCalls += 1;
      // Sletteruta for moduler sender også antallet øverst i kroppen (#705).
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "content_in_archived_course", message: SERVER_MESSAGE, courseCount: 2, details: DETAILS }),
      });
    });

    await page.goto("/admin-content-library.html");
    await page.locator('.list-filter-btn[data-filter="archived"]').click();
    const row = page.locator(".list-table tbody tr", { hasText: "Archived module" });
    await expect(row).toHaveCount(1);
    // Lista viser modulen som ubrukt: det arkiverte kurset teller ikke som bruk.
    await expect(row.locator(".course-count-zero")).toHaveText("0");

    page.once("dialog", (dialog) => dialog.accept());
    await (await revealRowAction(page, page.locator('[data-action="delete"][data-module-id="module-1149"]'))).click();
    await expect.poll(() => deleteCalls).toBe(1);

    await expect(page.locator(".toast__message")).toHaveText(EXPECTED["en-GB"]);
    await expect(page.locator(".toast")).not.toContainText("SERVERTEKST");
    await expect(page.locator(".list-table tbody tr", { hasText: "Archived module" })).toHaveCount(1);
  });
});
