import { test, expect, type Page, type Route } from "@playwright/test";

// 2.102.0 — «Mine kurs» etter tema.
//
// Produkteier, 2026-10-25: «Oversikten Mine Kurs bør vises kategorisert på Tema, men også kunne skifte
// til alfabetisk rekkefølge. Fullførte kurs vises også under kurslisten, når Mine Kurs er kategorisert
// etter Tema bør de fullførte vises per Tema.» Og: et kurs med flere tema står under hvert av dem.
//
// Grupperingen, kopiene og valget som huskes lever i klientlaget og er usynlige for supertest.

async function mockBase(page: Page, courses: unknown[], themes: unknown[]) {
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
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses, themes }) }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );
  await page.route(/\/api\/courses\/c[^/]+$/, (route: Route) => {
    const id = route.request().url().split("/").pop();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ course: { id, title: `Kurs ${id}`, items: [{ type: "SECTION", sectionId: `${id}-s1`, courseItemId: `${id}-ci1`, title: `Seksjon i ${id}`, read: false }] } }),
    });
  });
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
}

const KI = { id: "t-ki", name: "KI" };
const PL = { id: "t-pl", name: "Prosjektledelse" };

function course(id: string, title: string, status: string, themes: Array<{ id: string; name: string }>) {
  return {
    id,
    title,
    description: null,
    moduleCount: 1,
    themes,
    progress: { completed: status === "COMPLETED" ? 1 : 0, total: 1, moduleCompleted: status === "COMPLETED" ? 1 : 0, moduleTotal: 1, sectionCompleted: 0, sectionTotal: 0, courseStatus: status },
  };
}

const COURSES = [
  course("c1", "Agentisk KI", "IN_PROGRESS", [KI]),
  course("c2", "Kontrakter", "IN_PROGRESS", [KI, PL]),
  course("c3", "Kvalitet", "COMPLETED", [PL]),
  course("c4", "Personvern", "NOT_STARTED", []),
];

/** Lista lest som tekstlinjer: overskrifter, kurs og grenser i rekkefølge. */
async function listOutline(page: Page) {
  return page.locator("#courseAccordion").evaluate((root) =>
    [...root.querySelectorAll(".course-theme-heading, .course-accordion-title, .course-group-divider")].map((el) =>
      el.classList.contains("course-theme-heading") ? `# ${el.textContent}` : el.classList.contains("course-group-divider") ? "--" : el.textContent,
    ),
  );
}

test("etter tema: hvert tema har sine kurs, fullførte under en grense i temaet, uten tema sist", async ({ page }) => {
  await mockBase(page, COURSES, [KI, PL]);
  await page.goto("/participant");
  await expect(page.locator(".course-theme-heading").first()).toBeVisible();

  expect(await listOutline(page)).toEqual([
    "# KI", "Agentisk KI", "Kontrakter",
    "# Prosjektledelse", "Kontrakter", "--", "Kvalitet",
    "# Andre kurs", "Personvern",
  ]);
  await expect(page.locator('.course-view-btn[data-view="theme"]')).toHaveAttribute("aria-pressed", "true");
});

test("alfabetisk: én liste uten temaoverskrifter, hvert kurs én gang — og valget huskes", async ({ page }) => {
  await mockBase(page, COURSES, [KI, PL]);
  await page.goto("/participant");
  await page.locator('.course-view-btn[data-view="alphabetical"]').click();

  expect(await listOutline(page)).toEqual(["Agentisk KI", "Kontrakter", "Personvern", "--", "Kvalitet"]);
  await expect(page.locator('.course-view-btn[data-view="alphabetical"]')).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.locator(".course-accordion-title").first()).toBeVisible();
  await expect(page.locator(".course-theme-heading")).toHaveCount(0);
  await expect(page.locator('.course-view-btn[data-view="alphabetical"]')).toHaveAttribute("aria-pressed", "true");
});

test("uten tema på noe kurs: ingen bryter og ingen «Andre kurs» — lista er som før", async ({ page }) => {
  await mockBase(page, [course("c1", "Alfa", "IN_PROGRESS", []), course("c2", "Beta", "COMPLETED", [])], []);
  await page.goto("/participant");
  await expect(page.locator(".course-accordion-title").first()).toBeVisible();
  // Kontrollcase: uten denne ville «vis alltid bryteren» bestått testene over.
  await expect(page.locator(".course-view-toggle")).toHaveCount(0);
  await expect(page.locator(".course-theme-heading")).toHaveCount(0);
  expect(await listOutline(page)).toEqual(["Alfa", "--", "Beta"]);
});

test("et kurs under to tema åpnes ÉN gang, med innholdet, uansett hvilken forekomst man trykker på", async ({ page }) => {
  await mockBase(page, COURSES, [KI, PL]);
  await page.goto("/participant");
  await expect(page.locator(".course-theme-heading").first()).toBeVisible();

  // Den andre forekomsten («Kontrakter» under Prosjektledelse) har ikke kursinnholdet.
  const copies = page.locator('.course-accordion-item[data-course-id="c2"]');
  await expect(copies).toHaveCount(2);
  await expect(page.locator("#courseDetail_c2")).toHaveCount(1);

  await copies.nth(1).locator(".course-accordion-header").click();
  await expect(page.locator("#courseAccordion")).toHaveClass(/course-accordion--focused/);
  // Bare én forekomst står igjen, og det er den med innholdet.
  await expect(page.locator(".course-accordion-item:visible")).toHaveCount(1);
  await expect(page.locator(".course-accordion-item:visible #courseDetail_c2")).toHaveCount(1);
  await expect(page.locator(".course-sequence")).toBeVisible();
  // Overskriftene og bryteren viker også.
  await expect(page.locator(".course-theme-heading:visible")).toHaveCount(0);
  await expect(page.locator(".course-view-toggle")).toBeHidden();
});
