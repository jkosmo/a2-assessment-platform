import { test, expect, type Page, type Route } from "@playwright/test";
import { mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

// #1150 skive 2a-1: arkivering for hånd stoppes også av et lagret utkast (#1140) til et annet aktivt kurs. Tjeneren svarer
// `400 content_in_course_draft` med kursene i `details`; setningen forfatteren ser, lages her i klienten på hens språk.
//
// Det testen fester, er klientlaget: at den NYE koden slås opp i alle tre språk, at plassholderne fylles fra `details` (også
// når `details` har et felt setningen ikke bruker, `uses`), og at begge flatene som arkiverer for hånd (seksjonen i editoren,
// modulen i biblioteket) viser den. Ingen klientkode er endret; bare tekstene er nye. Tjenerens svar er etterlignet; at tjeneren
// faktisk sender denne formen, festes i test/m2-course-archive-preview-1150.test.ts.

const DETAILS = {
  count: 2,
  courseTitles: ["Kurs A", "Kurs B"],
  draftCount: 1,
  draftCourseTitles: ["Kurs B"],
  uses: [{ courseId: "a", title: "Kurs A", via: "course" }, { courseId: "b", title: "Kurs B", via: "draft" }],
};
// Tjenerens reserve-tekst, på bokmål uansett språk. Den skal ALDRI vises: setningen kommer fra oversettelsene.
const SERVER_MESSAGE = "SERVERTEKST Seksjonen kan ikke arkiveres.";

const EXPECTED = {
  nb: "Innholdet kan ikke arkiveres fordi det er i bruk i 2 kurs: Kurs A, Kurs B. I 1 av dem står det bare i et lagret utkast: Kurs B. Ta det ut av utkastet (eller forkast utkastet) og av kursene først.",
  nn: "Innhaldet kan ikkje arkiverast fordi det er i bruk i 2 kurs: Kurs A, Kurs B. I 1 av dei står det berre i eit lagra utkast: Kurs B. Ta det ut av utkastet (eller forkast utkastet) og av kursa først.",
  "en-GB": "This content cannot be archived because it is used in 2 course(s): Kurs A, Kurs B. In 1 of them it is only in a saved draft: Kurs B. Take it out of the draft (or discard the draft) and out of the courses first.",
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

// En publisert seksjon som ikke står i noe kurs' liste (`courseCount: 0`), men i et annet kurs' lagrede utkast.
const publishedSection = {
  id: "sec-1150",
  title: JSON.stringify({ nb: "Publisert seksjon", nn: "Publisert seksjon", "en-GB": "Published section" }),
  bodyMarkdown: JSON.stringify({ nb: "x", nn: "x", "en-GB": "x" }),
  activeVersionId: "secv-1150",
  versionNo: 1,
  updatedAt: "2026-11-01T00:00:00.000Z",
  archivedAt: null,
  lifecycle: "published",
  courseCount: 0,
  courses: [],
  canManage: true,
  assets: [],
};

async function openPublishedSection(page: Page, locale: string, archiveResponse: { status: number; body: object }) {
  await mockSectionBase(page, locale);
  await page.route("**/api/admin/content/sections", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [publishedSection] }) }));
  await page.route("**/api/admin/content-owners/SECTION/sec-1150", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners: [], canManageOwners: false }) }));
  await page.route("**/api/admin/content/sections/sec-1150", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: publishedSection }) }));
  let archiveCalls = 0;
  await page.route("**/api/admin/content/sections/sec-1150/archive", (route: Route) => {
    archiveCalls += 1;
    return route.fulfill({ status: archiveResponse.status, contentType: "application/json", body: JSON.stringify(archiveResponse.body) });
  });
  await page.goto("/admin-content/sections?id=sec-1150");
  return () => archiveCalls;
}

test.describe("#1150 — arkivering stoppet av et lagret utkast: meldingen sier at det er et utkast", () => {
  for (const locale of ["nb", "nn", "en-GB"] as const) {
    test(`seksjonen i editoren, ${locale}: setningen navngir kursene og utkastet, uten plassholdere og uten tjenerens tekst`, async ({ page }) => {
      const archiveCalls = await openPublishedSection(page, locale, {
        status: 400,
        body: { error: "content_in_course_draft", message: SERVER_MESSAGE, details: DETAILS },
      });

      page.once("dialog", (dialog) => dialog.accept());
      await (await revealRowAction(page, page.locator('[data-editor-action="archive"]'))).click();
      await expect.poll(archiveCalls).toBe(1);

      const toast = page.locator(".toast__message");
      await expect(toast).toHaveText(EXPECTED[locale]);
      await expect(page.locator(".toast")).not.toContainText("{");
      await expect(page.locator(".toast")).not.toContainText("SERVERTEKST");
      await expect(page.locator(".toast")).not.toContainText("[object Object]");
      // Seksjonen er ikke arkivert: knappen står der fortsatt.
      await expect(page.locator('[data-editor-action="archive"]')).toBeAttached();
    });
  }

  test("KONTROLL: uten utkast sender tjeneren `content_in_use`, og setningen er den gamle", async ({ page }) => {
    const archiveCalls = await openPublishedSection(page, "nb", {
      status: 400,
      body: { error: "content_in_use", message: SERVER_MESSAGE, details: { count: 1, courseTitles: ["Kurs A"] } },
    });
    page.once("dialog", (dialog) => dialog.accept());
    await (await revealRowAction(page, page.locator('[data-editor-action="archive"]'))).click();
    await expect.poll(archiveCalls).toBe(1);
    await expect(page.locator(".toast__message")).toHaveText("Innholdet er i bruk i 1 kurs: Kurs A. Fjern det fra kursene først, eller avpubliser dem.");
  });

  test("modulen i biblioteket: samme setning, og raden står igjen", async ({ page }) => {
    // Biblioteket står på en-GB i e2e (standard).
    await mockCommonApis(page, {
      libraryModules: [{ id: "module-1150", title: "Published module", status: "published", courseCount: 0, courses: [] }],
    });
    let archiveCalls = 0;
    await page.route("**/api/admin/content/modules/module-1150/archive", (route: Route) => {
      archiveCalls += 1;
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "content_in_course_draft", message: SERVER_MESSAGE, details: DETAILS }),
      });
    });

    await page.goto("/admin-content-library.html");
    const row = page.locator(".list-table tbody tr", { hasText: "Published module" });
    await expect(row).toHaveCount(1);
    await (await revealRowAction(page, page.locator('[data-action="archive"][data-module-id="module-1150"]'))).click();
    await expect.poll(() => archiveCalls).toBe(1);

    await expect(page.locator(".toast__message")).toHaveText(EXPECTED["en-GB"]);
    await expect(page.locator(".toast")).not.toContainText("SERVERTEKST");
    await expect(page.locator(".list-table tbody tr", { hasText: "Published module" })).toHaveCount(1);
  });
});
