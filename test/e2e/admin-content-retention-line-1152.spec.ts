import { expect, test, type Page, type Route } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #1152 skive 4b (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Hva forfatteren ser»): under «Arkiverte» i kurslista,
// modulbiblioteket og seksjonslista står en linje under statusmerket: «Slettes 13.05.2027» eller «Beholdes: <grunn>».
//
// Testen fester klientlaget: at `retention` fra tjeneren blir riktig tekst på brukerens språk (datoformat, grunnen slått opp på
// koden, nynorsk bøyd etter kjønnet er i enhetstesten), at «ukjent» og aktive rader ikke får noen linje, og at linja passer på en
// telefon uten vannrett rulling. Tjenerens svar er etterlignet; at tjeneren sender denne formen, festes i
// test/m2-archived-retention-1152.test.ts.

const ARCHIVED_AT = "2026-11-10T12:00:00.000Z";
const SHOTS = "test-results/1152-4b";

type Locale = "nb" | "en-GB";

async function locale(page: Page, value: Locale) {
  await page.addInitScript((loc) => { try { localStorage.setItem("participant.locale", loc); } catch { /* ignore */ } }, value);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * Linja ligger innenfor vinduet, og teksten innenfor linja (en lang grunn brekker, den skyver ikke raden ut). Tabellen ligger i en
 * ramme som ruller selv (`.list-table-wrap`), så en tekst som ikke brekker, gir rulling i ramma og ikke på sida: den sjekkes også.
 */
async function insideViewport(page: Page, selector: string, width: number) {
  const boxes = await page.locator(selector).evaluateAll((els) => els.map((el) => ({ ...el.getBoundingClientRect().toJSON(), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })));
  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.scrollWidth, "teksten går utenfor linja").toBeLessThanOrEqual(box.clientWidth);
  }
  const wraps = await page.locator(".list-table-wrap").evaluateAll((els) => els.map((el) => el.scrollWidth - el.clientWidth));
  for (const overflow of wraps) expect(overflow, "tabellramma ruller sidelengs").toBeLessThanOrEqual(0);
}

const LONG_TITLE = "Et arkivert kurs med en svært lang tittel som må få plass på en smal skjerm uten at noe havner utenfor";

function course(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: { nb: title, nn: title, "en-GB": title },
    description: null,
    certificationLevel: "basic",
    moduleCount: 1,
    updatedAt: "2026-11-01T12:00:00.000Z",
    publishedAt: null,
    archivedAt: ARCHIVED_AT,
    lifecycle: "archived",
    modules: [],
    ...overrides,
  };
}

const COURSES = [
  course("course-slettes", "Kurs som slettes", { retention: { deletesAt: "2027-05-13" } }),
  course("course-bevis", LONG_TITLE, { retention: { kept: { code: "course_has_completed_without_certificate", details: { count: 3 } } } }),
  course("course-ukjent", "Kurs uten dato", { retention: { unknown: true } }),
  // KONTROLL: et aktivt kurs har ingen linje.
  course("course-aktiv", "Aktivt kurs", { archivedAt: null, publishedAt: "2026-11-01T12:00:00.000Z", lifecycle: "published" }),
];

const MODULES = [
  { id: "mod-slettes", title: "Modul som slettes", titleLocales: ["nb", "nn", "en-GB"], status: "archived", archivedAt: ARCHIVED_AT, courseCount: 0, retention: { deletesAt: "2027-02-28" } },
  { id: "mod-besvarelser", title: "Modul med besvarelser", titleLocales: ["nb", "nn", "en-GB"], status: "archived", archivedAt: ARCHIVED_AT, courseCount: 0, retention: { kept: { code: "module_has_submissions", details: { count: 4 } } } },
  { id: "mod-ukjent", title: "Modul uten dato", titleLocales: ["nb", "nn", "en-GB"], status: "archived", archivedAt: ARCHIVED_AT, courseCount: 0, retention: { unknown: true } },
  { id: "mod-aktiv", title: "Aktiv modul", titleLocales: ["nb", "nn", "en-GB"], status: "published", courseCount: 0 },
];

function section(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: JSON.stringify({ nb: title, nn: title, "en-GB": title }),
    activeVersionId: null,
    versionNo: 1,
    updatedAt: "2026-11-01T08:00:00.000Z",
    archivedAt: ARCHIVED_AT,
    lifecycle: "archived",
    canManage: true,
    courseCount: 0,
    courses: [],
    titleLocales: ["nb", "nn", "en-GB"],
    ...overrides,
  };
}

const SECTIONS = [
  section("sec-slettes", "Seksjon som slettes", { retention: { deletesAt: "2027-01-01" } }),
  section("sec-kurs", "Seksjon i et kurs som beholdes", { retention: { kept: { code: "content_in_archived_course", details: { count: 1 } } } }),
  section("sec-ukjent", "Seksjon uten dato", { retention: { unknown: true } }),
  section("sec-aktiv", "Aktiv seksjon", { archivedAt: null, activeVersionId: "sv-1", lifecycle: "published" }),
];

async function mockSectionList(page: Page) {
  await page.route(/\/api\/admin\/content\/sections(\?.*)?$/, (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: SECTIONS }) });
  });
}

const line = (page: Page, id: string) => page.locator(`tr[data-row-id="${id}"] .retention-line`);

const EXPECTED: Record<Locale, Record<string, string>> = {
  nb: {
    "course-slettes": "Slettes 13.05.2027",
    "course-bevis": "Beholdes: 3 deltakere har fullført kravet uten kursbevis",
    "mod-slettes": "Slettes 28.02.2027",
    "mod-besvarelser": "Beholdes: har besvarelser",
    "sec-slettes": "Slettes 01.01.2027",
    "sec-kurs": "Beholdes: ligger i et kurs som beholdes",
  },
  "en-GB": {
    "course-slettes": "To be deleted 13 May 2027",
    "course-bevis": "Kept: 3 participants have completed the requirement without a certificate",
    "mod-slettes": "To be deleted 28 February 2027",
    "mod-besvarelser": "Kept: has submissions",
    "sec-slettes": "To be deleted 1 January 2027",
    "sec-kurs": "Kept: is in a course that is kept",
  },
};

const PAGES = [
  { name: "kurslista", url: "/admin-content/courses", ids: ["course-slettes", "course-bevis"], none: ["course-ukjent", "course-aktiv"] },
  { name: "modulbiblioteket", url: "/admin-content", ids: ["mod-slettes", "mod-besvarelser"], none: ["mod-ukjent", "mod-aktiv"] },
  { name: "seksjonslista", url: "/admin-content/sections", ids: ["sec-slettes", "sec-kurs"], none: ["sec-ukjent", "sec-aktiv"] },
] as const;

for (const loc of ["nb", "en-GB"] as const) {
  for (const width of [1280, 390] as const) {
    for (const list of PAGES) {
      test(`#1152 4b — ${list.name}, ${loc}, ${width} px: «slettes»/«beholdes» under merket, ingenting for ukjent og aktive`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await locale(page, loc);
        await mockCommonApis(page, { courses: COURSES as never, libraryModules: MODULES as never });
        await mockSectionList(page);
        await page.goto(list.url);
        await page.locator('.list-filters [data-filter="all"]').click();
        await expect(page.locator(`tr[data-row-id="${list.ids[0]}"]`)).toBeVisible();

        for (const id of list.ids) {
          await expect(line(page, id)).toHaveText(EXPECTED[loc][id]!);
          // Linja står i statuscellen, under merket.
          await expect(page.locator(`tr[data-row-id="${id}"] td.col-status .status-badge--archived`)).toHaveCount(1);
          await expect(page.locator(`tr[data-row-id="${id}"] td.col-status .retention-line`)).toHaveCount(1);
        }
        for (const id of list.none) {
          await expect(page.locator(`tr[data-row-id="${id}"]`)).toBeVisible();
          await expect(line(page, id)).toHaveCount(0);
        }
        // Linja står UNDER merket, ikke ved siden av.
        const id = list.ids[1];
        const badge = await page.locator(`tr[data-row-id="${id}"] .status-badge`).boundingBox();
        const text = await line(page, id).boundingBox();
        expect(text!.y).toBeGreaterThanOrEqual(badge!.y + badge!.height - 1);

        await noHorizontalScroll(page);
        await insideViewport(page, ".retention-line", width);
        await page.screenshot({ path: `${SHOTS}-${list.name}-${loc}-${width}.png`, fullPage: true });
      });
    }
  }
}

test("#1152 4b — «Arkiverte»-filteret i kurslista: linjene står der, og et svar uten `retention` (gammel tjener) gir ingen linje", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await locale(page, "nb");
  const courses = [...COURSES, course("course-gammel", "Kurs fra gammel tjener")];
  await mockCommonApis(page, { courses: courses as never });
  await page.goto("/admin-content/courses");
  await page.locator('.list-filters [data-filter="archived"]').click();
  await expect(line(page, "course-slettes")).toHaveText("Slettes 13.05.2027");
  await expect(page.locator('tr[data-row-id="course-gammel"]')).toBeVisible();
  await expect(line(page, "course-gammel")).toHaveCount(0);
  await expect(page.locator('tr[data-row-id="course-aktiv"]')).toHaveCount(0);
});
