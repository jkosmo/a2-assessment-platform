import { test, expect, type Page, type Route } from "@playwright/test";

// 2.121.0: delingslenka /kurs/<navn> lander på /participant?kurs=<navn> (videresendingen er testet i
// test/course-share-link-2121.test.ts). «Mine kurs» kjenner bare kursene deltakeren har tilgang til:
// et treff åpner kurset, alt annet gir én melding. Et åpent kurs med lenke har «Kopier lenke».

type Course = { id: string; title: string; slug: string | null };

async function mockBase(page: Page, courses: Course[]) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
        calibrationWorkspace: { accessRoles: [] },
        flow: {},
        output: {},
      }),
    }),
  );
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: {} }) }));
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: courses.map((c) => ({ ...c, description: null, moduleCount: 0, progress: { completed: 0, total: 1, sectionCompleted: 0, sectionTotal: 1, courseStatus: "NOT_STARTED" } })),
      }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }));
  for (const c of courses) {
    await page.route(`**/api/courses/${c.id}`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ course: { id: c.id, title: c.title, items: [{ type: "SECTION", sectionId: `${c.id}-s1`, courseItemId: `${c.id}-ci1`, title: `Seksjon i ${c.id}`, read: false }] } }),
      }),
    );
  }
}

const COURSES: Course[] = [
  { id: "c1", title: "Kurs én", slug: "kurs-en" },
  { id: "c2", title: "Kurs to", slug: null },
];
const NOTICE = "Kurset finnes ikke, eller du har ikke tilgang til det. Ta kontakt med den som sendte deg lenken.";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
});

test("lenka åpner kurset alene, og adressen blir den vanlige", async ({ page }) => {
  await mockBase(page, COURSES);
  await page.goto("/participant?kurs=kurs-en");
  const first = page.locator('.course-accordion-item[data-course-id="c1"]');
  await expect(first.locator(".course-sequence")).toBeVisible();
  await expect(page.locator('.course-accordion-item[data-course-id="c2"]')).toBeHidden();
  await expect(page.locator("#courseLinkNotice")).toBeHidden();
  await expect(page).toHaveURL(/\/participant\?courseId=c1$/);

  // Tilbake til lista og en oppfriskning: lista, ikke kurset igjen (?kurs= er borte fra adressen).
  await page.locator("#courseBackBtn").click();
  await expect(page.locator('.course-accordion-item[data-course-id="c2"]')).toBeVisible();
  await page.reload();
  await expect(page.locator(".course-accordion-item")).toHaveCount(2);
  await expect(page.locator("#courseBackBar")).toBeHidden();
});

test("et ukjent navn gir meldingen, og kurslista står", async ({ page }) => {
  await mockBase(page, COURSES);
  await page.goto("/participant?kurs=lukket-kurs");
  await expect(page.locator("#courseLinkNotice")).toBeVisible();
  await expect(page.locator("#courseLinkNotice")).toHaveText(NOTICE);
  await expect(page.locator(".course-accordion-item")).toHaveCount(2);
  await expect(page.locator("#courseBackBar")).toBeHidden();

  // Deltakeren går videre: meldingen forsvinner når et kurs åpnes.
  await page.locator('.course-accordion-item[data-course-id="c2"] .course-accordion-header').click();
  await expect(page.locator("#courseLinkNotice")).toBeHidden();
});

test("en gammel id-lenke uten tilgang gir samme melding", async ({ page }) => {
  await mockBase(page, COURSES);
  await page.goto("/participant?courseId=finnes-ikke");
  await expect(page.locator("#courseLinkNotice")).toBeVisible();
  await expect(page.locator("#courseLinkNotice")).toHaveText(NOTICE);
});

test("uten noen kurs i det hele tatt: også meldingen", async ({ page }) => {
  await mockBase(page, []);
  await page.goto("/participant?kurs=kurs-en");
  await expect(page.locator("#courseLinkNotice")).toBeVisible();
  await expect(page.locator("#courseLinkNotice")).toHaveText(NOTICE);
});

test("uten lenke i adressen vises ingen melding", async ({ page }) => {
  await mockBase(page, COURSES);
  await page.goto("/participant");
  await expect(page.locator(".course-accordion-item")).toHaveCount(2);
  await expect(page.locator("#courseLinkNotice")).toBeHidden();
});

test("«Kopier lenke» på et åpent kurs kopierer /kurs/<navn>; kurs uten lenke har ingen knapp", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockBase(page, COURSES);
  await page.goto("/participant");
  await page.locator('.course-accordion-item[data-course-id="c1"] .course-accordion-header').click();
  const copy = page.locator("#courseCopyLinkBtn");
  await expect(copy).toBeVisible();
  await expect(copy).toHaveText("Kopier lenke");
  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(baseURL ?? page.url()).origin}/kurs/kurs-en`);

  await page.locator("#courseBackBtn").click();
  await page.locator('.course-accordion-item[data-course-id="c2"] .course-accordion-header').click();
  await expect(page.locator("#courseBackBar")).toBeVisible();
  await expect(copy).toBeHidden();
});
