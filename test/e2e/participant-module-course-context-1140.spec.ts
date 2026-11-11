import { test, expect, type Page, type Route } from "@playwright/test";

// #1140 etappe 1: kurset modulen åpnes fra, bestemmer hvilken versjon deltakeren får. Deltakersiden må derfor si hvilket kurs:
// modullista hentes med `?courseId=`, og innleveringen sender samme kurs sammen med versjonen siden viste. Kjører den ekte
// participant.js mot falske API-er som svarer ulikt per kurs. Serversiden står i test/m2-participant-module-version-1140.test.ts.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const ANSWER = "Et tilstrekkelig langt fritekstsvar som deltakeren ikke vil miste.";

/** Det serveren ville svart: kurs 1 viser hovedversjon 1 av modulen, kurs 2 og «uten kurs» viser hovedversjon 2. */
function moduleFor(courseId: string | null, firstIsMcqOnly: boolean) {
  const old = courseId === "c1";
  return {
    id: "m-1",
    title: "Risiko",
    description: null,
    assessmentMode: firstIsMcqOnly ? "MCQ_ONLY" : "FREETEXT_ONLY",
    submissionSchema: null,
    assessmentPolicy: null,
    taskText: old ? "Oppgaven slik den var i versjon 1" : "Oppgaven slik den er i versjon 2",
    activeVersion: old ? { id: "mv-1", versionNo: 2, versionMajor: 1, versionMinor: 1 } : { id: "mv-2", versionNo: 3, versionMajor: 2, versionMinor: 0 },
    participantStatus: null,
  };
}
const SECOND_MODULE = {
  id: "m-2",
  title: "Gevinster",
  description: null,
  assessmentMode: "FREETEXT_ONLY",
  submissionSchema: null,
  assessmentPolicy: null,
  taskText: "Oppgaven i den andre modulen",
  activeVersion: { id: "mv-20", versionNo: 1, versionMajor: 1, versionMinor: 0 },
  participantStatus: null,
};

type MockOptions = {
  /** Kurs 1 har to moduler («Risiko» og «Gevinster»). */
  twoModules?: boolean;
  /** «Risiko» er en ren flervalgsmodul: å åpne den starter en innlevering av seg selv. */
  firstIsMcqOnly?: boolean;
  /** Den første hentingen av modullista for dette kurset feiler. */
  failOnceFor?: string;
  /** Hentingene av modullista venter på dette før de svarer. */
  hold?: Promise<void>;
  /** Hentingene for dette kurset, fra og med nummer `from` (1 = den første), venter på `until`. De andre svarer straks. */
  holdFor?: { courseId: string; from: number; until: Promise<void> };
};

async function mock(page: Page, options: MockOptions = {}) {
  const calls = { lists: [] as Array<string | null>, created: [] as Array<Record<string, unknown>> };
  let failFor = options.failOnceFor ?? null;
  const seenPerCourse = new Map<string | null, number>();
  const courseRow = (id: string, title: string) => ({
    id,
    title,
    description: null,
    moduleCount: 1,
    progress: { completed: 0, total: 1, moduleCompleted: 0, moduleTotal: 1, sectionCompleted: 0, sectionTotal: 0, courseStatus: "NOT_STARTED" },
  });
  const moduleItem = (courseId: string, moduleId: string, title: string, sortOrder: number) => ({
    type: "MODULE", moduleId, courseItemId: `i-${courseId}-${moduleId}`, sortOrder, title, moduleStatus: "NOT_STARTED", available: true, required: true, discussionsEnabled: false,
  });
  const courseDetail = (id: string, title: string) => ({
    course: {
      id,
      title,
      items: [moduleItem(id, "m-1", "Risiko", 0), ...(options.twoModules && id === "c1" ? [moduleItem(id, "m-2", "Gevinster", 1)] : [])],
    },
  });

  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ }
  });
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
      calibrationWorkspace: { accessRoles: [] },
      flow: { autoStartAfterMcq: false },
      output: {},
    })),
  );
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/courses", (route: Route) => route.fulfill(json({ courses: [courseRow("c1", "Pers kurs"), courseRow("c2", "Karis kurs")] })));
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/enrollments", (route: Route) => route.fulfill(json({ enrollments: [] })));
  await page.route("**/api/courses/c1", (route: Route) => route.fulfill(json(courseDetail("c1", "Pers kurs"))));
  await page.route("**/api/courses/c2", (route: Route) => route.fulfill(json(courseDetail("c2", "Karis kurs"))));
  await page.route("**/api/modules**", async (route: Route) => {
    const courseId = new URL(route.request().url()).searchParams.get("courseId");
    calls.lists.push(courseId);
    const nth = (seenPerCourse.get(courseId) ?? 0) + 1;
    seenPerCourse.set(courseId, nth);
    if (options.hold) await options.hold;
    if (options.holdFor && options.holdFor.courseId === courseId && nth >= options.holdFor.from) await options.holdFor.until;
    if (failFor !== null && failFor === courseId) {
      failFor = null;
      return route.fulfill(json({ error: "internal_error" }, 500));
    }
    return route.fulfill(json({ modules: [moduleFor(courseId, options.firstIsMcqOnly === true), ...(options.twoModules ? [SECOND_MODULE] : [])] }));
  });
  await page.route("**/api/modules/*/mcq/start**", (route: Route) => route.fulfill(json({ attemptId: "a1", questions: [{ id: "q1", stem: "Spørsmål", options: ["A", "B"] }] })));
  await page.route("**/api/submissions", (route: Route) => {
    calls.created.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill(json({ submission: { id: "s-new", submissionStatus: "SUBMITTED" } }, 201));
  });
  await page.route("**/api/assessments/*/run", (route: Route) => route.fulfill(json({ ok: true })));
  await page.route("**/api/submissions/*/result", (route: Route) => route.fulfill(json({ status: "PROCESSING" })));
  return calls;
}

function courseCard(page: Page, courseTitle: string) {
  return page.locator(".course-accordion-item", { hasText: courseTitle });
}

/** Åpner kurset (og går tilbake til kurslista først, når et annet kurs står åpent alene på siden). */
async function openCourse(page: Page, courseTitle: string) {
  const course = courseCard(page, courseTitle);
  await expect(course).toBeAttached();
  if (!(await course.isVisible())) await page.locator("#courseBackBtn").click();
  if ((await course.locator(".course-module-row").count()) === 0) await course.locator(".course-accordion-header").click();
  await expect(course.locator(".course-module-row").first()).toBeVisible();
  return course;
}

async function openModuleFromCourse(page: Page, courseTitle: string) {
  const course = await openCourse(page, courseTitle);
  await course.locator(".course-module-row").first().click();
}

test.describe("#1140 etappe 1: kurset modulen åpnes fra", () => {
  test("lista hentes for kurset, siden viser den versjonen, og innleveringen sender versjonen og kurset", async ({ page }) => {
    const calls = await mock(page);
    await page.goto("/participant");
    await openModuleFromCourse(page, "Pers kurs");

    await expect(page.getByText("Oppgaven slik den var i versjon 1")).toBeVisible();
    expect(calls.lists).toContain("c1");

    for (const field of await page.locator("#submissionFields textarea").all()) await field.fill(ANSWER);
    await page.locator("#createSubmission").click();
    await expect.poll(() => calls.created.length).toBe(1);
    expect(calls.created[0]).toMatchObject({ moduleId: "m-1", moduleVersionId: "mv-1", courseId: "c1" });
  });

  test("samme modul åpnet fra et annet kurs: lista hentes på nytt for det kurset, og siden viser DEN versjonen", async ({ page }) => {
    const calls = await mock(page);
    await page.goto("/participant");
    await openModuleFromCourse(page, "Pers kurs");
    await expect(page.getByText("Oppgaven slik den var i versjon 1")).toBeVisible();
    const field = page.locator("#submissionFields textarea").first();
    await field.fill(ANSWER);

    await openModuleFromCourse(page, "Karis kurs");
    await expect(page.getByText("Oppgaven slik den er i versjon 2")).toBeVisible();
    await expect(page.getByText("Oppgaven slik den var i versjon 1")).toHaveCount(0);
    expect(calls.lists.filter((id) => id === "c2")).toHaveLength(1);
    // Det som var skrevet, står i kladden for modulen.
    await expect(page.locator("#submissionFields textarea").first()).toHaveValue(ANSWER);

    for (const one of await page.locator("#submissionFields textarea").all()) await one.fill(ANSWER);
    await page.locator("#createSubmission").click();
    await expect.poll(() => calls.created.length).toBe(1);
    expect(calls.created[0]).toMatchObject({ moduleVersionId: "mv-2", courseId: "c2" });
  });

  test("det som er skrevet rett før kurset byttes, før autolagringen har gått, står etterpå", async ({ page }) => {
    // Autolagringen går et kvart sekund etter siste tastetrykk. Her går den aldri: testen står i vinduet før den.
    await page.addInitScript(() => {
      const original = window.setTimeout.bind(window);
      window.setTimeout = ((handler: TimerHandler, ms?: number, ...rest: unknown[]) =>
        ms === 250 ? 0 : original(handler, ms, ...rest)) as typeof window.setTimeout;
    });
    await mock(page);
    await page.goto("/participant");
    await openModuleFromCourse(page, "Pers kurs");
    await expect(page.getByText("Oppgaven slik den var i versjon 1")).toBeVisible();
    await page.locator("#submissionFields textarea").first().fill(ANSWER);

    await openModuleFromCourse(page, "Karis kurs");
    await expect(page.getByText("Oppgaven slik den er i versjon 2")).toBeVisible();
    // Lista ble hentet på nytt og siden tegnet om. Kladden ble lagret FØR det, så teksten er der.
    await expect(page.locator("#submissionFields textarea").first()).toHaveValue(ANSWER);
  });

  test("modulen åpnet på nytt fra SAMME kurs henter ikke lista en gang til", async ({ page }) => {
    const calls = await mock(page);
    await page.goto("/participant");
    await openModuleFromCourse(page, "Pers kurs");
    await expect(page.getByText("Oppgaven slik den var i versjon 1")).toBeVisible();
    const fetched = calls.lists.length;
    await openModuleFromCourse(page, "Pers kurs");
    await expect(page.getByText("Oppgaven slik den var i versjon 1")).toBeVisible();
    expect(calls.lists.length).toBe(fetched);
  });
});

// QA-porten 2.154.0: kurset skal bare gjelde når lista for det faktisk er hentet, og det siste klikket skal vinne.
test.describe("#1140 etappe 1: hentingen feiler, eller to klikk krysser hverandre", () => {
  test("lista gjelder et annet kurs, og hentingen for det nye feiler: neste klikk henter på nytt, og modulen åpnes aldri fra den gamle lista", async ({ page }) => {
    const calls = await mock(page, { failOnceFor: "c1" });
    await page.goto("/participant");
    // Lista gjelder Karis kurs (versjon 2) når hentingen for Pers kurs feiler.
    await openModuleFromCourse(page, "Karis kurs");
    await expect(page.getByText("Oppgaven slik den er i versjon 2")).toBeVisible();

    const course = await openCourse(page, "Pers kurs");
    await course.locator(".course-module-row").first().click();
    await expect(page.locator(".toast").last()).toBeVisible();

    // Kurset står ikke som «hentet»: klikket henter lista for Pers kurs en gang til, og viser DEN versjonen.
    await expect(course.locator(".course-module-row").first()).toBeEnabled();
    await course.locator(".course-module-row").first().click();
    await expect(page.getByText("Oppgaven slik den var i versjon 1")).toBeVisible();
    await expect(page.getByText("Oppgaven slik den er i versjon 2")).toHaveCount(0);
    expect(calls.lists.filter((id) => id === "c1")).toHaveLength(2);

    for (const field of await page.locator("#submissionFields textarea").all()) await field.fill(ANSWER);
    await page.locator("#createSubmission").click();
    await expect.poll(() => calls.created.length).toBe(1);
    expect(calls.created[0]).toMatchObject({ moduleVersionId: "mv-1", courseId: "c1" });
  });

  test("et svar for det forrige kurset kommer ETTER at modulen er åpnet fra det nye: det forkastes", async ({ page }) => {
    let release: () => void = () => {};
    const until = new Promise<void>((resolve) => { release = resolve; });
    // Den andre hentingen for Karis kurs (språkbyttet) henger. Hentingen for Pers kurs svarer straks.
    const calls = await mock(page, { holdFor: { courseId: "c2", from: 2, until } });
    await page.goto("/participant");
    await openModuleFromCourse(page, "Karis kurs");
    await expect(page.getByText("Oppgaven slik den er i versjon 2")).toBeVisible();

    // Språkbyttet henter lista på nytt for kurset som gjelder (Karis), og svaret lar vente på seg.
    await page.locator("#localeSelect").selectOption("nn");
    await expect.poll(() => calls.lists.filter((id) => id === "c2").length).toBe(2);
    await openModuleFromCourse(page, "Pers kurs");
    await expect(page.getByText("Oppgaven slik den var i versjon 1")).toBeVisible();

    release();
    await page.waitForTimeout(500);
    // Det sene svaret gjaldt Karis kurs. Siden står på Pers kurs, og sender det.
    await expect(page.getByText("Oppgaven slik den var i versjon 1")).toBeVisible();
    await expect(page.getByText("Oppgaven slik den er i versjon 2")).toHaveCount(0);
    for (const field of await page.locator("#submissionFields textarea").all()) await field.fill(ANSWER);
    await page.locator("#createSubmission").click();
    await expect.poll(() => calls.created.length).toBe(1);
    expect(calls.created[0]).toMatchObject({ moduleVersionId: "mv-1", courseId: "c1" });
  });

  test("to klikk mens lista hentes: det siste vinner, og den første modulen starter ingen innlevering", async ({ page }) => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => { release = resolve; });
    // «Risiko» er en ren flervalgsmodul: ble den åpnet til slutt, ville den startet en innlevering av seg selv.
    const calls = await mock(page, { twoModules: true, firstIsMcqOnly: true, hold });
    await page.goto("/participant");
    const course = await openCourse(page, "Pers kurs");
    const rows = course.locator(".course-module-row");
    await expect(rows).toHaveCount(2);

    await rows.nth(0).click();
    await rows.nth(1).click();
    release();

    await expect(page.getByText("Oppgaven i den andre modulen")).toBeVisible();
    // Det siste klikket eier visningen: modulen står åpen under SIN rad, og det første klikket ga verken feilmelding,
    // en henting til eller en innlevering.
    await expect(rows.nth(1)).toHaveAttribute("aria-expanded", "true");
    await expect(course.locator(".course-item.open")).toContainText("Oppgaven i den andre modulen");
    await page.waitForTimeout(500);
    await expect(page.locator(".toast")).toHaveCount(0);
    expect(calls.lists).toEqual(["c1", "c1"]);
    expect(calls.created).toEqual([]);

    for (const field of await page.locator("#submissionFields textarea").all()) await field.fill(ANSWER);
    await page.locator("#createSubmission").click();
    await expect.poll(() => calls.created.length).toBe(1);
    expect(calls.created[0]).toMatchObject({ moduleId: "m-2", moduleVersionId: "mv-20", courseId: "c1" });
  });
});
