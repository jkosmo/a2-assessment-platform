import { test, expect, type Page, type Route } from "@playwright/test";

// #1162 — deltakerflyten: kursbeviset har ett navn, «tilbake» heter det samme overalt, kursbeviset åpnes i samme fane, og en
// lest seksjon sier «Gå videre». Produkteier avgjorde tekstene 21.11.2026 (doc/DECISIONS.md, «Deltakerflyten»). Kjører den
// ekte participant.js, profile.js og certificate.js mot falske API-er, på bokmål, nynorsk og engelsk.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

type Locale = "nb" | "nn" | "en-GB";
const LOCALES: Locale[] = ["nb", "nn", "en-GB"];

const TEXT: Record<Locale, { view: string; earlier: string }> = {
  nb: { view: "Vis kursbevis", earlier: "Vis kursbevis for versjon 2" },
  nn: { view: "Vis kursbevis", earlier: "Vis kursbevis for versjon 2" },
  "en-GB": { view: "View course certificate", earlier: "View course certificate for version 2" },
};

// Ordet som er borte. «Sertifikat» står fortsatt i «Sertifiseringsnivå» på beviset, men ikke som navn på beviset.
const OLD_WORDS = /Sertifikat\b|Vis bevis\b|View certificate\b|Certificate,/;

const LONG_TITLE = "Informasjonssikkerhetsopplæringsprogrammetsrepetisjonskurs";

async function mockBase(page: Page, locale: Locale) {
  await page.addInitScript((l) => {
    try { localStorage.setItem("participant.locale", l); } catch { /* standardspråk */ }
  }, locale);
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
      calibrationWorkspace: { accessRoles: [] },
      flow: {},
      output: {},
    })),
  );
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill(json({ user: { id: "participant-1", name: "Kari", email: "p@x.no", roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })),
  );
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/me/stats", (route: Route) => route.fulfill(json(EMPTY_STATS)));
}

// Profilens statistikk for en ny bruker (samme form som i profile-stats-1138.spec.ts).
const EMPTY_STATS = {
  generatedAt: "2026-11-11T10:30:00.000Z",
  mood: "ny",
  lastActivityAt: null,
  weeks: Array.from({ length: 12 }, (_, i) => {
    const from = new Date(Date.parse("2026-08-24T00:00:00Z") + i * 7 * 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.parse(`${from}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
    return { from, to, partial: i === 11, sectionsRead: 0, modulesPassed: 0, coursesCompleted: 0, readingMinutes: 0 };
  }),
  recent: { weeks: 4, sectionsRead: 0, modulesPassed: 0, coursesCompleted: 0, readingMinutes: 0 },
  totals: { coursesCompleted: 0, modulesPassed: 0, sectionsRead: 0 },
  passedModules: [],
};

function course(id: string, title: string, status: string) {
  return {
    id,
    title,
    description: null,
    moduleCount: 1,
    progress: { completed: status === "COMPLETED" ? 1 : 0, total: 1, moduleCompleted: status === "COMPLETED" ? 1 : 0, moduleTotal: 1, sectionCompleted: 0, sectionTotal: 0, courseStatus: status },
  };
}

// Tre kurs: ett fullført med kort tittel, ett fullført med en lang tittel (ett ord), og ett med bare et bevis for en eldre
// hovedversjon (#934).
async function mockCertificates(page: Page) {
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill(json({
      courses: [course("ny", "Arbeidsrett", "IN_PROGRESS"), course("done", "Personvern", "COMPLETED"), course("lang", LONG_TITLE, "COMPLETED")],
    })),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill(json({
      completions: [
        { courseId: "done", certificateId: "cert-done", completedAt: "2026-10-01T10:00:00.000Z", courseTitle: "Personvern", certificationLevel: "basic", versionMajor: 1, versionMinor: 0, current: true },
        { courseId: "lang", certificateId: "cert-lang", completedAt: "2026-10-02T10:00:00.000Z", courseTitle: LONG_TITLE, certificationLevel: "basic", versionMajor: 1, versionMinor: 0, current: true },
        { courseId: "ny", certificateId: "cert-v2", completedAt: "2026-03-01T10:00:00.000Z", courseTitle: "Arbeidsrett", certificationLevel: "basic", versionMajor: 2, versionMinor: 0, current: false },
      ],
    })),
  );
  await page.route("**/api/courses/ny", (route: Route) =>
    route.fulfill(json({ course: { id: "ny", title: "Arbeidsrett", discussionsEnabled: false, modules: [], items: [] } })),
  );
}

const item = (page: Page, id: string) => page.locator(`.course-accordion-item[data-course-id="${id}"]`);

test.describe("#1162 skive 1: kursbeviset heter «Kursbevis», lenken «Vis kursbevis»", () => {
  for (const locale of LOCALES) {
    test(`kursraden, eldre versjon og profilen (${locale})`, async ({ page }) => {
      await mockBase(page, locale);
      await mockCertificates(page);
      await page.goto("/participant");

      const link = item(page, "done").locator(".course-certificate-link");
      await expect(link).toHaveText(TEXT[locale].view);
      await expect(page.locator("#courseAccordion")).not.toContainText(OLD_WORDS);

      await item(page, "ny").locator(".course-accordion-header").click();
      const earlier = item(page, "ny").locator("a.course-certificate-link--earlier");
      await expect(earlier).toHaveText(TEXT[locale].earlier);
      await expect(earlier).toHaveAttribute("href", /^\/certificate\?id=cert-v2/);

      await page.goto("/profile");
      await page.locator("#profileTab-courses").click();
      const profileLinks = page.locator("#coursesBody a");
      await expect(profileLinks).toHaveCount(3);
      await expect(profileLinks).toHaveText([TEXT[locale].view, TEXT[locale].view, TEXT[locale].view]);
      await expect(page.locator("#profilePanel-courses")).not.toContainText(OLD_WORDS);
    });
  }

  for (const width of [390, 360]) {
    for (const locale of LOCALES) {
      test(`på telefon (${width} px, ${locale}) står hele «${TEXT[locale].view}» på kursraden, innenfor kortet og uten vannrett rulling`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await mockBase(page, locale);
        await mockCertificates(page);
        await page.goto("/participant");

        for (const id of ["done", "lang"]) {
          const link = item(page, id).locator(".course-certificate-link");
          await expect(link).toBeVisible();
          await expect(link).toHaveText(TEXT[locale].view);
          const linkBox = (await link.boundingBox())!;
          const card = (await item(page, id).boundingBox())!;
          expect(linkBox.x).toBeGreaterThanOrEqual(card.x);
          expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
          // Lenken står på én linje (13 px tekst).
          expect(linkBox.height).toBeLessThan(26);
        }
        // Raden med kort tittel er høyst to linjer. Engelsk på 360 px brekker tittel og telling over to (målt 59 px).
        const row = (await item(page, "done").locator(".course-done-row").boundingBox())!;
        expect(row.height).toBeLessThanOrEqual(64);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        // Den eldre versjonen inne i kurset.
        await item(page, "ny").locator(".course-accordion-header").click();
        const earlier = item(page, "ny").locator("a.course-certificate-link--earlier");
        await expect(earlier).toHaveText(TEXT[locale].earlier);
        const earlierBox = (await earlier.boundingBox())!;
        expect(earlierBox.x + earlierBox.width).toBeLessThanOrEqual(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        // Profilen: lenken i tabellen, uten vannrett rulling av siden.
        await page.goto("/profile");
        await page.locator("#profileTab-courses").click();
        await expect(page.locator("#coursesBody a").first()).toHaveText(TEXT[locale].view);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      });
    }
  }
});
