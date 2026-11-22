import { test, expect, type Page, type Route } from "@playwright/test";

// #1162 — deltakerflyten: kursbeviset har ett navn, «tilbake» heter det samme overalt, kursbeviset åpnes i samme fane, og en
// lest seksjon sier «Gå videre». Produkteier avgjorde tekstene 21.11.2026 (doc/DECISIONS.md, «Deltakerflyten»). Kjører den
// ekte participant.js, profile.js og certificate.js mot falske API-er, på bokmål, nynorsk og engelsk.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

type Locale = "nb" | "nn" | "en-GB";
const LOCALES: Locale[] = ["nb", "nn", "en-GB"];

const TEXT: Record<Locale, { view: string; earlier: string; toCourse: string; toList: string; toPosts: string }> = {
  nb: { view: "Vis kursbevis", earlier: "Vis kursbevis for versjon 2", toCourse: "← Tilbake til kurset", toList: "← Tilbake til Mine kurs", toPosts: "← Tilbake til innleggene" },
  nn: { view: "Vis kursbevis", earlier: "Vis kursbevis for versjon 2", toCourse: "← Tilbake til kurset", toList: "← Tilbake til Mine kurs", toPosts: "← Tilbake til innlegga" },
  "en-GB": { view: "View course certificate", earlier: "View course certificate for version 2", toCourse: "← Back to the course", toList: "← Back to My courses", toPosts: "← Back to the posts" },
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

// ── Skive 2: «tilbake» ─────────────────────────────────────────────────────────────────────────────────────────────────────

const SECTION_TITLE = "Grunnleggende prinsipper for informasjonssikkerhet i hverdagen";
const MODULE_TITLE = "Test: informasjonssikkerhet i praksis for rådgivere og prosjektledere";

type Calls = { reads: string[] };

// Ett kurs med seksjon → seksjon → modul, diskusjon på, og en delingslenke (så deleikonet står ved siden av tilbake).
async function mockCourse(page: Page, opts: { read?: string[] } = {}): Promise<Calls> {
  const calls: Calls = { reads: [] };
  const isRead = (id: string) => (opts.read ?? []).includes(id) || calls.reads.includes(id);
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill(json({
      courses: [{ id: "c1", title: "Informasjonssikkerhet", slug: "infosik", description: null, moduleCount: 1, progress: { completed: 0, total: 3, moduleCompleted: 0, moduleTotal: 1, sectionCompleted: 0, sectionTotal: 2, courseStatus: "IN_PROGRESS" } }],
    })),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/enrollments", (route: Route) => route.fulfill(json({ enrollments: [] })));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill(json({
      course: {
        id: "c1",
        title: "Informasjonssikkerhet",
        discussionsEnabled: true,
        modules: [],
        items: [
          { type: "SECTION", sectionId: "s1", courseItemId: "ci1", title: SECTION_TITLE, read: isRead("s1"), available: true, required: true },
          { type: "SECTION", sectionId: "s2", courseItemId: "ci2", title: "Andre seksjon", read: isRead("s2"), available: true, required: true },
          { type: "MODULE", moduleId: "m1", courseItemId: "ci3", title: MODULE_TITLE, moduleStatus: "NOT_STARTED", available: true, required: true },
        ],
      },
    })),
  );
  await page.route(/\/api\/courses\/c1\/sections\/(s1|s2)$/, (route: Route) => {
    const id = route.request().url().endsWith("s1") ? "s1" : "s2";
    return route.fulfill(json({ title: id === "s1" ? SECTION_TITLE : "Andre seksjon", html: `<p>Tekst i ${id}</p>`, sectionVersionId: `sv-${id}` }));
  });
  await page.route(/\/api\/courses\/c1\/sections\/(s1|s2)\/read$/, (route: Route) => {
    calls.reads.push(route.request().url().includes("/s1/") ? "s1" : "s2");
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill(json({
      modules: [{ id: "m1", title: MODULE_TITLE, description: null, assessmentMode: "FREETEXT_PLUS_MCQ", submissionSchema: null, assessmentPolicy: null, taskText: "Skriv et svar", activeVersion: { id: "mv-1", versionNo: 1 }, participantStatus: null }],
    })),
  );
  const thread = {
    id: "t1", courseId: "c1", courseItemId: null, kind: "DISCUSSION", status: "OPEN", title: "Et spørsmål", bodyHtml: "<p>Hei</p>",
    deleted: false, pinned: false, acceptedReplyId: null, author: { id: "u1", name: "P", anonymized: false },
    createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", isSubscribed: false, canEdit: false, canDelete: false,
    canAccept: false, canModerate: false, replies: [],
  };
  await page.route("**/api/courses/c1/discussions", (route: Route) =>
    route.fulfill(json({ threads: [{ ...thread, replyCount: 0 }], canPost: true })),
  );
  await page.route("**/api/courses/c1/discussions/t1", (route: Route) => route.fulfill(json({ thread })));
  return calls;
}

async function openCourse(page: Page) {
  await page.goto("/participant");
  await item(page, "c1").locator(".course-accordion-header").click();
  await expect(page).toHaveURL(/courseId=c1$/);
  await expect(page.locator('.course-item[data-key="ci1"] .course-module-row')).toBeVisible();
}

// Antall tekstlinjer i et element (knappene har en minstehøyde, så høyden alene sier ikke om teksten har brukket).
async function lineCount(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top)));
    return tops.size;
  });
}

const sectionRow = (page: Page, key = "ci1") => page.locator(`.course-item[data-key="${key}"] .course-module-row`);
const moduleRow = (page: Page) => page.locator('.course-item[data-key="ci3"] .course-module-row');
const openPanel = (page: Page) => page.locator(".course-item.open .course-inline-panel");

test.describe("#1162 skive 2: «← Tilbake til <stedet>»", () => {
  for (const locale of LOCALES) {
    test(`kurset, seksjonen, modulen, diskusjonen og kursbeviset (${locale})`, async ({ page }) => {
      await mockBase(page, locale);
      await mockCourse(page);
      await openCourse(page);
      await expect(page.locator("#courseBackBtn")).toHaveText(TEXT[locale].toList);

      // Seksjonen: tilbake står i kurset.
      await sectionRow(page).click();
      await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s1");
      const sectionBack = openPanel(page).locator('[data-role="close"]');
      await expect(sectionBack).toHaveText(TEXT[locale].toCourse);
      await sectionBack.click();
      await expect(page.locator("#sectionReaderBody")).toHaveCount(0);
      await expect(page).toHaveURL(/courseId=c1$/);

      // Modulen: samme tekst.
      await moduleRow(page).click();
      await expect(page.locator(".course-inline-panel #moduleWorkspace")).toBeVisible();
      const moduleBack = openPanel(page).locator('[data-role="close"]');
      await expect(moduleBack).toHaveText(TEXT[locale].toCourse);
      await moduleBack.click();
      await expect(page.locator(".course-item.open")).toHaveCount(0);

      // Diskusjonstråden: tilbake til lista over innleggene.
      await page.locator(".course-discussion-toggle").click();
      const panel = page.locator("[data-course-discussion='c1']");
      await panel.locator("[data-disc-thread]").first().click();
      await expect(panel.locator("[data-disc-back]")).toHaveText(TEXT[locale].toPosts);
      await panel.locator("[data-disc-back]").click();
      await expect(panel.locator("[data-disc-thread]")).toHaveCount(1);

      // Kursbeviset.
      await page.route("**/api/courses/completions/cert-1", (route: Route) =>
        route.fulfill(json({ certificateId: "cert-1", courseId: "c1", courseTitle: "Informasjonssikkerhet", certificationLevel: "basic", completedAt: "2026-06-20T10:00:00.000Z", participantName: "Kari", moduleCount: 1 })),
      );
      await page.goto("/certificate?id=cert-1");
      await expect(page.locator("#certificate")).toBeVisible();
      const certBack = page.locator(".cert-toolbar a.workspace-nav-link");
      await expect(certBack).toHaveText(TEXT[locale].toList);
      await expect(certBack).toHaveAttribute("href", "/participant");
    });
  }

  // Bredden: de lengste tekstene på de smaleste telefonene. Én linje, innenfor skjermen, ingen vannrett rulling.
  for (const width of [390, 360]) {
    for (const locale of LOCALES) {
      test(`bredden på ${width} px (${locale})`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await mockBase(page, locale);
        await mockCourse(page);
        await openCourse(page);
        const noHorizontalScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        const measured: Record<string, number> = {};

        // Kurset: tilbake og deleikonet på samme linje.
        const back = (await page.locator("#courseBackBtn").boundingBox())!;
        const copy = (await page.locator("#courseCopyLinkBtn").boundingBox())!;
        measured.courseBackWidth = Math.round(back.width);
        measured.courseBackHeight = Math.round(back.height);
        expect(await lineCount(page, "#courseBackBtn")).toBe(1);
        expect(Math.abs((back.y + back.height / 2) - (copy.y + copy.height / 2))).toBeLessThan(6);
        expect(copy.x + copy.width).toBeLessThanOrEqual(width);
        expect(await noHorizontalScroll()).toBe(true);

        // Seksjonen (lesemodus): knappen på én linje, hodet lavt.
        await sectionRow(page).click();
        await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s1");
        const sBtn = (await openPanel(page).locator('[data-role="close"]').boundingBox())!;
        const sHead = (await openPanel(page).locator(".course-inline-panel-sticky").boundingBox())!;
        measured.sectionBackWidth = Math.round(sBtn.width);
        measured.sectionBackHeight = Math.round(sBtn.height);
        measured.sectionHeaderHeight = Math.round(sHead.height);
        expect(await lineCount(page, '.course-item.open [data-role="close"]')).toBe(1);
        expect(sBtn.x + sBtn.width).toBeLessThanOrEqual(width);
        const sPanel = (await openPanel(page).boundingBox())!;
        expect(sBtn.x + sBtn.width).toBeLessThanOrEqual(sPanel.x + sPanel.width - 1);
        expect(sHead.height).toBeLessThan(56);
        expect(await noHorizontalScroll()).toBe(true);
        if (process.env.SKJERMBILDE_DIR) await page.screenshot({ path: `${process.env.SKJERMBILDE_DIR}/1162-seksjon-${width}-${locale}.png` });
        await openPanel(page).locator('[data-role="close"]').click();
        await expect(page.locator(".course-item.open")).toHaveCount(0);

        // Modulen: lang tittel i hodet, knappen fortsatt hel og på én linje.
        await moduleRow(page).click();
        await expect(page.locator(".course-inline-panel #moduleWorkspace")).toBeVisible();
        const mBtn = (await openPanel(page).locator('[data-role="close"]').boundingBox())!;
        const mHead = (await openPanel(page).locator(".course-inline-panel-sticky").boundingBox())!;
        measured.moduleBackWidth = Math.round(mBtn.width);
        measured.moduleBackHeight = Math.round(mBtn.height);
        measured.moduleHeaderHeight = Math.round(mHead.height);
        expect(await lineCount(page, '.course-item.open [data-role="close"]')).toBe(1);
        expect(mBtn.x + mBtn.width).toBeLessThanOrEqual(width);
        // Panelet klipper (overflow: hidden): knappen må stå innenfor det, ikke bare innenfor skjermen. På 360 px ble den kuttet
        // før merket vek på telefon.
        const mPanel = (await openPanel(page).boundingBox())!;
        measured.modulePanelWidth = Math.round(mPanel.width);
        measured.moduleTitleWidth = Math.round((await openPanel(page).locator(".course-inline-panel-title").boundingBox())?.width ?? 0);
        expect(mBtn.x + mBtn.width).toBeLessThanOrEqual(mPanel.x + mPanel.width - 1);
        expect(mHead.height).toBeLessThan(56);
        expect(await noHorizontalScroll()).toBe(true);
        if (process.env.SKJERMBILDE_DIR) await page.screenshot({ path: `${process.env.SKJERMBILDE_DIR}/1162-modul-${width}-${locale}.png` });

        // Kursbeviset: verktøylinja.
        await page.route("**/api/courses/completions/cert-1", (route: Route) =>
          route.fulfill(json({ certificateId: "cert-1", courseId: "c1", courseTitle: "Informasjonssikkerhet", certificationLevel: "basic", completedAt: "2026-06-20T10:00:00.000Z", participantName: "Kari", moduleCount: 1 })),
        );
        await page.goto("/certificate?id=cert-1");
        await expect(page.locator("#certificate")).toBeVisible();
        const cBack = (await page.locator(".cert-toolbar a.workspace-nav-link").boundingBox())!;
        measured.certificateBackWidth = Math.round(cBack.width);
        measured.certificateBackHeight = Math.round(cBack.height);
        expect(await lineCount(page, ".cert-toolbar a.workspace-nav-link")).toBe(1);
        expect(cBack.x + cBack.width).toBeLessThanOrEqual(width);
        expect(await noHorizontalScroll()).toBe(true);

        console.log(`MÅLT ${width}px ${locale}: ${JSON.stringify(measured)}`);
        if (process.env.SKJERMBILDE_DIR) await page.screenshot({ path: `${process.env.SKJERMBILDE_DIR}/1162-bevis-${width}-${locale}.png` });
      });
    }
  }
});

// ── Skive 3: kursbeviset i samme fane ──────────────────────────────────────────────────────────────────────────────────────

const PROFILE_BACK: Record<Locale, string> = { nb: "← Tilbake til profilen", nn: "← Tilbake til profilen", "en-GB": "← Back to your profile" };

// «ny» har bare et bevis for en eldre hovedversjon og en modul som kan åpnes; «done» er fullført.
async function mockSameTab(page: Page) {
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill(json({ courses: [course("ny", "Arbeidsrett", "IN_PROGRESS"), course("done", "Personvern", "COMPLETED")] })),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill(json({
      completions: [
        { courseId: "done", certificateId: "cert-done", completedAt: "2026-10-01T10:00:00.000Z", courseTitle: "Personvern", certificationLevel: "basic", versionMajor: 1, versionMinor: 0, current: true },
        { courseId: "ny", certificateId: "cert-v2", completedAt: "2026-03-01T10:00:00.000Z", courseTitle: "Arbeidsrett", certificationLevel: "basic", versionMajor: 2, versionMinor: 0, current: false },
      ],
    })),
  );
  await page.route("**/api/courses/enrollments", (route: Route) => route.fulfill(json({ enrollments: [] })));
  await page.route("**/api/courses/ny", (route: Route) =>
    route.fulfill(json({
      course: {
        id: "ny",
        title: "Arbeidsrett",
        discussionsEnabled: false,
        modules: [],
        items: [
          { type: "SECTION", sectionId: "s1", courseItemId: "ny-1", title: "Lesestoff", read: true, available: true, required: true },
          { type: "MODULE", moduleId: "m1", courseItemId: "ny-2", title: "Testen", moduleStatus: "NOT_STARTED", available: true, required: true },
        ],
      },
    })),
  );
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill(json({
      modules: [{ id: "m1", title: "Testen", description: null, assessmentMode: "FREETEXT_PLUS_MCQ", submissionSchema: null, assessmentPolicy: null, taskText: "Skriv et svar", activeVersion: { id: "mv-1", versionNo: 1 }, participantStatus: null }],
    })),
  );
  for (const [id, courseTitle, versionMajor] of [["cert-v2", "Arbeidsrett", 2], ["cert-done", "Personvern", 1]] as const) {
    await page.route(`**/api/courses/completions/${id}`, (route: Route) =>
      route.fulfill(json({ certificateId: id, courseId: "c", courseTitle, certificationLevel: "basic", completedAt: "2026-06-20T10:00:00.000Z", participantName: "Kari", moduleCount: 1, versionMajor, versionMinor: 0, current: true })),
    );
  }
}

const certBack = (page: Page) => page.locator("#certBackLink");

test.describe("#1162 skive 3: kursbeviset åpnes i samme fane", () => {
  test("fra kurset med en åpen modul: beviset i samme fane, og nettleserens tilbake står i kurset med modulen åpen", async ({ page }) => {
    await mockBase(page, "nb");
    await mockSameTab(page);
    await page.goto("/participant");
    await item(page, "ny").locator(".course-accordion-header").click();
    await page.locator('.course-item[data-key="ny-2"] .course-module-row').click();
    await expect(page.locator(".course-inline-panel #moduleWorkspace")).toBeVisible();
    await expect(page).toHaveURL(/\/participant\?courseId=ny&moduleId=m1$/);
    // QA 2.173.0: ulagret tekst i modulen skal overleve turen til beviset i samme fane (kladden lagres i nettleseren).
    const answer = page.locator("#submissionFields textarea").first();
    await answer.fill("Et halvferdig svar jeg ikke vil miste.");
    await page.waitForTimeout(400); // kladden lagres 250 ms etter siste tastetrykk

    const earlier = item(page, "ny").locator("a.course-certificate-link--earlier");
    await expect(earlier).not.toHaveAttribute("target", /.+/);
    const pagesBefore = page.context().pages().length;
    await earlier.click();

    // Samme fane: ingen ny side, og adressen er beviset.
    await expect(page).toHaveURL(/\/certificate\?id=cert-v2$/);
    expect(page.context().pages().length).toBe(pagesBefore);
    await expect(page.locator("#certificate")).toBeVisible();
    await expect(certBack(page)).toHaveText("← Tilbake til Mine kurs");
    await expect(certBack(page)).toHaveAttribute("href", "/participant");

    // Nettleserens tilbake: kurset står, med modulen åpen.
    await page.goBack();
    await expect(page).toHaveURL(/\/participant\?courseId=ny&moduleId=m1$/);
    await expect(item(page, "ny")).toHaveClass(/is-focused/);
    await expect(page.locator('.course-item[data-key="ny-2"] .course-inline-panel #moduleWorkspace')).toBeVisible();
    await expect(page.locator("#submissionFields textarea").first()).toHaveValue("Et halvferdig svar jeg ikke vil miste.");
  });

  test("fra kursraden i lista: tilbake gir lista, og lenken på beviset fører til «Mine kurs»", async ({ page }) => {
    await mockBase(page, "nb");
    await mockSameTab(page);
    await page.goto("/participant");
    const link = item(page, "done").locator(".course-certificate-link");
    await expect(link).not.toHaveAttribute("target", /.+/);
    await link.click();
    await expect(page).toHaveURL(/\/certificate\?id=cert-done$/);
    await expect(page.locator("#certificate")).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/participant$/);
    await expect(item(page, "ny")).toBeVisible();
    await expect(item(page, "done")).toBeVisible();

    // Lenken på beviset gjør det samme som tilbake her: «Mine kurs».
    await page.goForward();
    await expect(page.locator("#certificate")).toBeVisible();
    await certBack(page).click();
    await expect(page).toHaveURL(/\/participant$/);
    await expect(item(page, "done")).toBeVisible();
  });

  for (const locale of LOCALES) {
    test(`fra profilen: «${PROFILE_BACK[locale]}», og nettleserens tilbake står i profilen (${locale})`, async ({ page }) => {
      await mockBase(page, locale);
      await mockSameTab(page);
      await page.goto("/profile");
      await page.locator("#profileTab-courses").click();
      const link = page.locator("#coursesBody a").first();
      await expect(link).not.toHaveAttribute("target", /.+/);
      const pagesBefore = page.context().pages().length;
      await link.click();

      await expect(page).toHaveURL(/\/certificate\?id=cert-[a-z0-9-]+&fra=profil$/);
      expect(page.context().pages().length).toBe(pagesBefore);
      await expect(page.locator("#certificate")).toBeVisible();
      await expect(certBack(page)).toHaveText(PROFILE_BACK[locale]);
      await expect(certBack(page)).toHaveAttribute("href", "/profile#courses");

      // Nettleserens tilbake: profilen, med fanen «Beståtte kurs» der deltakeren var.
      await page.goBack();
      await expect(page).toHaveURL(/\/profile$/);
      await expect(page.locator("#profilePanel-courses")).toBeVisible();
      await expect(page.locator("#coursesBody a").first()).toBeVisible();

      // Lenken på beviset fører også til profilen, og til den samme fanen (QA 2.173.0: før åpnet den «Statistikk»).
      await page.goForward();
      await expect(certBack(page)).toHaveText(PROFILE_BACK[locale]);
      await certBack(page).click();
      await expect(page).toHaveURL(/\/profile#courses$/);
      await expect(page.locator("#profileName")).toBeVisible();
      await expect(page.locator("#profilePanel-courses")).toBeVisible();
      await expect(page.locator("#profileTab-courses")).toHaveAttribute("aria-selected", "true");
    });
  }

  test("språkbytte på beviset fra profilen: lenken beholder stedet og følger språket", async ({ page }) => {
    await mockBase(page, "nb");
    await mockSameTab(page);
    await page.goto("/certificate?id=cert-done&fra=profil");
    await expect(certBack(page)).toHaveText(PROFILE_BACK.nb);
    await page.selectOption("#localeSelect", "en-GB");
    await expect(certBack(page)).toHaveText(PROFILE_BACK["en-GB"]);
    await expect(certBack(page)).toHaveAttribute("href", "/profile#courses");
  });
});

// ── Skive 4: en lest seksjon sier «Gå videre» ──────────────────────────────────────────────────────────────────────────────

const ADVANCE: Record<Locale, { next: string; test: string; markNext: string }> = {
  nb: { next: "Gå videre", test: "Gå til testen", markNext: "Marker seksjon lest, og gå videre" },
  nn: { next: "Gå vidare", test: "Gå til testen", markNext: "Marker seksjon lesen, og gå vidare" },
  "en-GB": { next: "Continue", test: "Go to the test", markNext: "Mark section as read, and continue" },
};

test.describe("#1162 skive 4: en seksjon som alt er lest", () => {
  for (const locale of LOCALES) {
    test(`«${ADVANCE[locale].next}» og «${ADVANCE[locale].test}» sender ikke lesingen på nytt (${locale})`, async ({ page }) => {
      await mockBase(page, locale);
      const calls = await mockCourse(page, { read: ["s1", "s2"] });
      await openCourse(page);
      const historyBefore = await page.evaluate(() => history.length);

      // Første seksjon er lest; neste er en seksjon.
      await sectionRow(page, "ci1").click();
      await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s1");
      await expect(openPanel(page).locator(".course-inline-actions button")).toHaveCount(1);
      await expect(page.locator("#sectionReaderMarkRead")).toHaveCount(0);
      await expect(page.locator("#sectionReaderNext")).toHaveText(ADVANCE[locale].next);
      await expect(page.locator("#sectionReaderNext")).toBeEnabled();
      await page.locator("#sectionReaderNext").click();
      await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s2");
      await expect(page).toHaveURL(/courseId=c1&sectionId=s2$/);

      // Andre seksjon er lest; neste er testen.
      await expect(page.locator("#sectionReaderNext")).toHaveText(ADVANCE[locale].test);
      await page.locator("#sectionReaderNext").click();
      await expect(page.locator('.course-item[data-key="ci3"] .course-inline-panel #moduleWorkspace')).toBeVisible();
      await expect(page).toHaveURL(/courseId=c1&moduleId=m1$/);

      // Ingen lesing er sendt, og «videre» erstattet elementet i adressen: ett steg over kurset, som før.
      expect(calls.reads).toEqual([]);
      expect(await page.evaluate(() => history.length)).toBe(historyBefore + 1);
    });
  }

  test("KONTROLL: en ulest seksjon har fortsatt «Marker seksjon lest, og gå videre», og lesingen sendes", async ({ page }) => {
    await mockBase(page, "nb");
    const calls = await mockCourse(page);
    await openCourse(page);
    await sectionRow(page, "ci1").click();
    await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s1");
    await expect(page.locator("#sectionReaderNext")).toHaveCount(0);
    await expect(page.locator("#sectionReaderMarkRead")).toHaveText(ADVANCE.nb.markNext);
    await page.locator("#sectionReaderMarkRead").click();
    await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s2");
    expect(calls.reads).toEqual(["s1"]);

    // Tilbake til kurset og «Se igjen» på den som nettopp ble lest: nå «Gå videre», uten ny lesing.
    await openPanel(page).locator('[data-role="close"]').click();
    await expect(page.locator(".course-item.open")).toHaveCount(0);
    await sectionRow(page, "ci1").click();
    await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s1");
    await expect(page.locator("#sectionReaderNext")).toHaveText(ADVANCE.nb.next);
    await page.locator("#sectionReaderNext").click();
    await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s2");
    expect(calls.reads).toEqual(["s1"]);
  });
});
