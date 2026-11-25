import { test, expect, type Page, type Route } from "@playwright/test";

// #1162 skive 5 (produkteier 21.11.2026; prototypen godkjent 25.11.2026): modulen åpnes som seksjonen. Den tar over kurskortet
// (lesemodus), hodet sier «Test», «Steg n av N» og «← Tilbake til kurset», tittelen står på arket på telefon, og nederst står én
// knapp videre, men bare når modulen er bestått: «Gå videre», eller «Avslutt kurset» på siste steg. Knappen i lista heter «Ta
// testen». Kjører den ekte participant.js mot falske API-er, som participant-flow-1162.spec.ts.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const MODULE_TITLE = "Test: informasjonssikkerhet i praksis for rådgivere";
// Arial: bredest av fontene vi har målt (se participant-flow-1162.spec.ts), så telefontesten er like streng i CI.
const WIDEST_FONT = "body, body * { font-family: Arial, sans-serif !important; }";

type Key = "s1" | "m1" | "s2";
type Setup = { order: Key[]; moduleStatus: string; s2Read?: boolean; locale?: string };
type State = { moduleStatus: string; courseLists: number };

async function mock(page: Page, setup: Setup): Promise<State> {
  const state: State = { moduleStatus: setup.moduleStatus, courseLists: 0 };
  await page.addInitScript((loc) => { try { localStorage.setItem("participant.locale", loc); } catch { /* standardspråk */ } }, setup.locale ?? "nb");
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock", navigation: { items: [], workspaceItems: [] },
      identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
      calibrationWorkspace: { accessRoles: [] }, flow: {}, output: {},
    })),
  );
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill(json({ user: { id: "participant-1", name: "Kari", email: "p@x.no", roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })),
  );
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/courses", (route: Route) => {
    state.courseLists += 1;
    return route.fulfill(json({ courses: [{ id: "c1", title: "Informasjonssikkerhet", slug: "infosik", description: null, moduleCount: 1, progress: { completed: 1, total: 3, moduleCompleted: 0, moduleTotal: 1, sectionCompleted: 1, sectionTotal: 2, courseStatus: "IN_PROGRESS" } }] }));
  });
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/enrollments", (route: Route) => route.fulfill(json({ enrollments: [] })));
  await page.route("**/api/courses/c1", (route: Route) => {
    const entries = {
      s1: { type: "SECTION", sectionId: "s1", courseItemId: "ci1", title: "Grunnleggende prinsipper", read: true, available: true, required: true },
      m1: { type: "MODULE", moduleId: "m1", courseItemId: "ci3", title: MODULE_TITLE, moduleStatus: state.moduleStatus, available: true, required: true },
      s2: { type: "SECTION", sectionId: "s2", courseItemId: "ci2", title: "Phishing og sosial manipulering", read: setup.s2Read === true, available: true, required: true },
    };
    return route.fulfill(json({ course: { id: "c1", title: "Informasjonssikkerhet", discussionsEnabled: false, modules: [], items: setup.order.map((k) => entries[k]) } }));
  });
  await page.route(/\/api\/courses\/c1\/sections\/(s1|s2)$/, (route: Route) =>
    route.fulfill(json({ title: "Seksjon", html: `<p>Tekst i ${route.request().url().endsWith("s1") ? "s1" : "s2"}</p>`, sectionVersionId: "sv" })),
  );
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill(json({ modules: [{ id: "m1", title: MODULE_TITLE, description: null, assessmentMode: "FREETEXT_PLUS_MCQ", submissionSchema: null, assessmentPolicy: null, taskText: "Skriv et svar", activeVersion: { id: "mv-1", versionNo: 1 }, participantStatus: null }] })),
  );
  return state;
}

const courseCard = (page: Page) => page.locator('.course-accordion-item[data-course-id="c1"]');
const moduleRow = (page: Page) => page.locator('.course-item[data-key="ci3"] .course-module-row');
const panel = (page: Page) => page.locator('.course-item[data-key="ci3"] .course-inline-panel');
const workspace = (page: Page) => page.locator('.course-item[data-key="ci3"] .course-inline-panel #moduleWorkspace');

async function openModule(page: Page) {
  await page.goto("/participant");
  await courseCard(page).locator(".course-accordion-header").click();
  await moduleRow(page).click();
  await expect(workspace(page)).toBeVisible();
}

test.describe("#1162 skive 5: modulen åpnes som seksjonen", () => {
  test("lesemodus, hodet som seksjonens, og ingen knapp videre før modulen er bestått", async ({ page }) => {
    await mock(page, { order: ["s1", "m1", "s2"], moduleStatus: "NOT_STARTED" });
    await openModule(page);

    await expect(courseCard(page)).toHaveClass(/course-reading/);
    // Resten av kurset og «← Tilbake til Mine kurs» viker, som for en seksjon.
    await expect(page.locator('.course-item[data-key="ci1"] .course-module-row')).toBeHidden();
    await expect(page.locator('.course-item[data-key="ci2"] .course-module-row')).toBeHidden();
    await expect(page.locator("#courseBackBtn")).toBeHidden();

    const head = panel(page).locator(".course-inline-panel-sticky");
    await expect(head.locator(".course-inline-panel-tag")).toHaveText("Test");
    await expect(head.locator(".course-inline-panel-title")).toHaveText(MODULE_TITLE);
    await expect(head.locator(".course-reading-position")).toHaveText("Steg 2 av 3");
    await expect(head.locator("[data-role='close']")).toHaveText("← Tilbake til kurset");
    // Avgjørelse 3: ingen vei videre før modulen er bestått. Den gamle «Gå til neste element» er borte.
    await expect(panel(page).locator(".course-inline-actions")).toHaveCount(0);
    await expect(panel(page)).not.toContainText("Gå til neste element");

    // Tilbake til kurset: lesemodus av, radene står.
    await head.locator("[data-role='close']").click();
    await expect(courseCard(page)).not.toHaveClass(/course-reading/);
    await expect(moduleRow(page)).toBeVisible();
  });

  test("bestått midt i kurset: «Gå videre» åpner neste steg", async ({ page }) => {
    await mock(page, { order: ["s1", "m1", "s2"], moduleStatus: "PASSED" });
    await openModule(page);
    const next = panel(page).locator(".course-inline-actions [data-role='next']");
    await expect(next).toHaveText("Gå videre");
    await expect(next).toHaveClass(/btn-primary/);
    await next.click();
    await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s2");
    await expect(page).toHaveURL(/courseId=c1&sectionId=s2$/);
  });

  test("bestått på siste steg: «Avslutt kurset» lukker modulen og henter kurslista", async ({ page }) => {
    const state = await mock(page, { order: ["s1", "s2", "m1"], moduleStatus: "PASSED", s2Read: true });
    await openModule(page);
    await expect(panel(page).locator(".course-reading-position")).toHaveText("Steg 3 av 3");
    const finish = panel(page).locator("[data-role='finishCourse']");
    await expect(finish).toHaveText("Avslutt kurset");
    const lists = state.courseLists;
    await finish.click();
    await expect(courseCard(page)).not.toHaveClass(/course-reading/);
    await expect(workspace(page)).toHaveCount(0);
    await expect.poll(() => state.courseLists).toBeGreaterThan(lists);
    await expect(page).toHaveURL(/courseId=c1$/);
  });

  test("bestått på siste steg med noe igjen: sier hva, og knappen går dit", async ({ page }) => {
    await mock(page, { order: ["s1", "s2", "m1"], moduleStatus: "PASSED", s2Read: false });
    await openModule(page);
    await expect(panel(page).locator("[data-role='finishCourse']")).toHaveCount(0);
    await expect(panel(page).locator(".course-inline-actions")).toContainText("Phishing og sosial manipulering");
    await panel(page).locator("[data-role='goOutstanding']").click();
    await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s2");
  });

  test("knappen kommer når kurset tegnes på nytt med modulen bestått, og arbeidsflaten står (språkbytte)", async ({ page }) => {
    const state = await mock(page, { order: ["s1", "m1", "s2"], moduleStatus: "NOT_STARTED" });
    await openModule(page);
    await expect(panel(page).locator(".course-inline-actions")).toHaveCount(0);
    await page.locator("#submissionFields textarea").first().fill("Et svar som skal stå.");

    // Et avgjort bestått henter kurslista og kurset på nytt (renderResult). Her: språkbyttet, som også tegner kurset på nytt.
    state.moduleStatus = "PASSED";
    await page.locator("#localeSelect").selectOption("nn");
    await expect(panel(page).locator("[data-role='next']")).toHaveText("Gå vidare");
    await expect(panel(page).locator(".course-inline-panel-tag")).toHaveText("Test");
    await expect(courseCard(page)).toHaveClass(/course-reading/);
    await expect(workspace(page)).toBeVisible();
    await expect(page.locator("#submissionFields textarea").first()).toHaveValue("Et svar som skal stå.");
  });

  test("QA 2.184.0: tegnes kurset på nytt mens modulen hentes, og hentingen feiler, står kurset igjen (ingen blindvei)", async ({ page }) => {
    await mock(page, { order: ["s1", "m1", "s2"], moduleStatus: "NOT_STARTED" });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    // Registrert etter mock(): vinner. Modullista holdes tilbake, og svarer så med en feil.
    await page.route("**/api/modules**", async (route: Route) => {
      await held;
      await route.fulfill(json({ error: "internal_error" }, 500));
    });
    await page.goto("/participant");
    await courseCard(page).locator(".course-accordion-header").click();
    await moduleRow(page).click();
    // Kurset tegnes på nytt mens modulen hentes (her språkbyttet; i bruk: kurslista som svarer etter «gå til testen»).
    await page.locator("#localeSelect").selectOption("nn");
    // Forutsetningen: panelet er montert i lesemodus før hentingen feiler. Uten den måler testen ikke blindveien.
    await expect(courseCard(page)).toHaveClass(/course-reading/);
    release();

    await expect(page.locator(".toast").last()).toBeVisible();
    await expect(courseCard(page)).not.toHaveClass(/course-reading/);
    await expect(page.locator('.course-item[data-key="ci1"] .course-module-row')).toBeVisible();
    await expect(moduleRow(page)).toBeEnabled();
    await expect(page).toHaveURL(/courseId=c1$/);
  });

  test("QA 2.184.0: kurset tegnet på nytt uten fokus: fokus går til modulens tittel, som for seksjonen", async ({ page }) => {
    await mock(page, { order: ["s1", "m1", "s2"], moduleStatus: "NOT_STARTED" });
    await openModule(page);
    // Tegn kurset på nytt (språkbyttet) uten at noe har fokus, som når en vurdering blir ferdig.
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      const select = document.querySelector<HTMLSelectElement>("#localeSelect")!;
      select.value = "nn";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(panel(page).locator(".course-inline-panel-tag")).toBeVisible();
    await expect(panel(page).locator(".course-inline-panel-title")).toBeFocused();
  });

  test("seksjonens merke heter «Lesestoff», og knappen i lista «Ta testen»", async ({ page }) => {
    await mock(page, { order: ["s1", "m1", "s2"], moduleStatus: "NOT_STARTED" });
    await page.goto("/participant");
    await courseCard(page).locator(".course-accordion-header").click();
    await expect(page.locator('.course-item[data-key="ci3"] .course-step-cta')).toHaveText("Ta testen");
    await page.locator('.course-item[data-key="ci1"] .course-module-row').click();
    await expect(page.locator('.course-item[data-key="ci1"] .course-inline-panel-tag')).toHaveText("Lesestoff");
  });

  test("på engelsk: «Take the test», «Test», «Continue»", async ({ page }) => {
    await mock(page, { order: ["s1", "m1", "s2"], moduleStatus: "PASSED", locale: "en-GB" });
    await page.goto("/participant");
    await courseCard(page).locator(".course-accordion-header").click();
    await expect(page.locator('.course-item[data-key="ci3"] .course-step-cta, .course-item[data-key="ci3"] .course-step-review').first()).toBeVisible();
    await moduleRow(page).click();
    await expect(workspace(page)).toBeVisible();
    await expect(panel(page).locator(".course-inline-panel-tag")).toHaveText("Test");
    await expect(panel(page).locator("[data-role='next']")).toHaveText("Continue");
    await expect(panel(page).locator("[data-role='close']")).toHaveText("← Back to the course");
  });

  for (const width of [390, 360]) {
    test(`på telefon (${width} px): tittelen på arket, «Test» og tilbake i hodet, knappen hel, ingen vannrett rulling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mock(page, { order: ["s1", "m1", "s2"], moduleStatus: "PASSED" });
      await openModule(page);
      await page.addStyleTag({ content: WIDEST_FONT });

      await expect(panel(page).locator(".course-reading-title")).toBeVisible();
      await expect(panel(page).locator(".course-reading-title")).toHaveText(MODULE_TITLE);
      await expect(panel(page).locator(".course-inline-panel-title")).toBeHidden();
      await expect(panel(page).locator(".course-inline-panel-tag")).toBeVisible();
      const close = panel(page).locator("[data-role='close']");
      await expect(close).toBeVisible();
      // Alt målt i ÉN lesing: åpningen ruller raden til toppen (jevnt), og hodet er klebrig. Målt med flere kall etter hverandre
      // sto merket og knappen i ulike øyeblikk av rullingen, og testen feilet tilfeldig (1 av 5).
      const m = await panel(page).evaluate((el) => {
        const box = (sel: string) => el.querySelector(sel)!.getBoundingClientRect();
        const p = el.getBoundingClientRect();
        const c = box("[data-role='close']");
        const t = box(".course-inline-panel-tag");
        return { panelRight: p.right, closeRight: c.right, closeMid: c.top + c.height / 2, closeHeight: c.height, tagMid: t.top + t.height / 2 };
      });
      expect(m.closeRight, "tilbake-knappen står innenfor panelet").toBeLessThanOrEqual(m.panelRight + 0.5);
      expect(Math.abs(m.tagMid - m.closeMid), "merket og knappen på samme linje").toBeLessThan(m.closeHeight / 2);
      await expect(panel(page).locator("[data-role='next']")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: test.info().outputPath(`modul-lesemodus-${width}.png`), fullPage: false });
    });
  }

  test("på desktop står «← Tilbake til kurset» til høyre i hodet", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await mock(page, { order: ["s1", "m1", "s2"], moduleStatus: "NOT_STARTED" });
    await openModule(page);
    const head = (await panel(page).locator(".course-inline-panel-sticky").boundingBox())!;
    const close = (await panel(page).locator("[data-role='close']").boundingBox())!;
    expect(head.x + head.width - (close.x + close.width), "knappen står ved høyre kant").toBeLessThan(40);
  });
});
