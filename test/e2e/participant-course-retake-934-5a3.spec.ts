import { test, expect, type Page, type Route } from "@playwright/test";

// #934 skive 5a-3 (doc/DESIGN_934.md, «Deltakerens vei»): modulsiden åpnet fra kurset bruker kursets status, ikke bare siste vedtak.
// Siste vedtak sier bestått, men det gjaldt en versjon som ikke lenger teller i kurset. Da skal «må tas på nytt» vises, og et nytt
// forsøk starte. Kjører den ekte participant.js mot falske API-er. Serversiden står i test/m2-module-pass-per-course-934-5a3.test.ts.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

type Status = { latestSubmissionId: string; latestStatus: string; latestDecision: { passFailTotal: boolean; totalScore?: number } | null } | null;

const PASSED_ON_OLD_VERSION: Status = { latestSubmissionId: "s-old", latestStatus: "COMPLETED", latestDecision: { passFailTotal: true, totalScore: 90 } };
const FAILED_RETAKE: Status = { latestSubmissionId: "s-old", latestStatus: "COMPLETED", latestDecision: { passFailTotal: false, totalScore: 20 } };

const HINT = "Modulen er revidert etter at du besto den";

function result(passed: boolean) {
  return {
    status: "COMPLETED",
    decision: { passFailTotal: passed, decisionType: "AUTOMATIC" },
    scoreComponents: { totalScore: passed ? 100 : 20, mcqScaledScore: passed ? 100 : 20, practicalScaledScore: 0 },
    participantGuidance: {},
  };
}

async function mock(page: Page, options: { retakeRequired?: boolean; status?: Status; moduleStatus?: string; newAttemptPasses?: boolean; serverStillRequires?: boolean; detailFailsAfterPass?: boolean; secondCourse?: boolean } = {}) {
  const state = {
    decided: false,
    moduleStatus: options.moduleStatus ?? "REVISED_RETAKE_REQUIRED",
    retakeRequired: options.retakeRequired ?? true,
    status: options.status ?? PASSED_ON_OLD_VERSION,
    completions: [{ courseId: "c1", certificateId: "bevis-1", completedAt: "2026-01-01T10:00:00.000Z", courseTitle: "Kurset", versionMajor: 1, versionMinor: 0, current: false }] as Array<Record<string, unknown>>,
  };
  const calls = { created: [] as Array<Record<string, unknown>>, earlierResults: 0, mcqStarts: 0, details: { c1: 0, c2: 0 } };
  const courseRow = (id: string, title: string) => ({
    id,
    title,
    description: null,
    moduleCount: 1,
    progress: {
      completed: state.moduleStatus === "PASSED" ? 1 : 0,
      total: 1,
      moduleCompleted: state.moduleStatus === "PASSED" ? 1 : 0,
      moduleTotal: 1,
      sectionCompleted: 0,
      sectionTotal: 0,
      courseStatus: state.moduleStatus === "PASSED" ? "COMPLETED" : "IN_PROGRESS",
    },
  });
  const courseDetail = (id: string, title: string, retakeRequired: boolean) => ({
    course: {
      id,
      title,
      items: [{
        type: "MODULE",
        moduleId: "m-1",
        courseItemId: `i-${id}`,
        sortOrder: 0,
        title: "Modulen",
        moduleStatus: state.moduleStatus,
        ...(retakeRequired ? { retakeRequired: true } : {}),
        available: true,
        required: true,
        discussionsEnabled: false,
      }],
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
      flow: {},
      output: {},
    })),
  );
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill(json({ courses: [courseRow("c1", "Kurset"), ...(options.secondCourse ? [courseRow("c2", "Det andre kurset")] : [])] })),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: state.completions })));
  await page.route("**/api/courses/enrollments", (route: Route) => route.fulfill(json({ enrollments: [] })));
  await page.route("**/api/courses/c1", (route: Route) => {
    calls.details.c1 += 1;
    if (options.detailFailsAfterPass && state.decided) return route.fulfill(json({ error: "internal_error" }, 500));
    return route.fulfill(json(courseDetail("c1", "Kurset", state.retakeRequired)));
  });
  // Det andre kurset valgte mindre: kravet der er dekket av beståtten, selv om det står i det første.
  await page.route("**/api/courses/c2", (route: Route) => {
    calls.details.c2 += 1;
    return route.fulfill(json(courseDetail("c2", "Det andre kurset", !state.decided)));
  });
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill(json({
      modules: [{
        id: "m-1",
        title: "Modulen",
        description: null,
        assessmentMode: "MCQ_ONLY",
        submissionSchema: null,
        assessmentPolicy: null,
        taskText: null,
        activeVersion: { id: "mv-2", versionNo: 2 },
        participantStatus: state.status,
      }],
    })),
  );
  await page.route("**/api/submissions", (route: Route) => {
    calls.created.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill(json({ submission: { id: "s-new", submissionStatus: "SUBMITTED" } }, 201));
  });
  await page.route("**/api/modules/*/mcq/start**", (route: Route) => {
    calls.mcqStarts += 1;
    return route.fulfill(json({ attemptId: "a1", questions: [{ id: "q1", stem: "Spørsmål på den nye versjonen", options: ["A", "B"] }] }));
  });
  await page.route("**/api/modules/*/mcq/submit", (route: Route) => route.fulfill(json({ assessmentComplete: true })));
  await page.route("**/api/submissions/s-new/result", (route: Route) => {
    state.decided = true;
    const passed = options.newAttemptPasses ?? true;
    state.status = { latestSubmissionId: "s-new", latestStatus: "COMPLETED", latestDecision: { passFailTotal: passed, totalScore: passed ? 100 : 20 } };
    if (passed && !options.serverStillRequires) {
      // Serveren: beståtten på den nye versjonen teller, og beviset for hovedversjon 2 er utstedt.
      state.moduleStatus = "PASSED";
      state.retakeRequired = false;
      state.completions = [
        ...state.completions,
        { courseId: "c1", certificateId: "bevis-2", completedAt: "2026-11-05T10:00:00.000Z", courseTitle: "Kurset", versionMajor: 2, versionMinor: 0, current: true },
      ];
    }
    return route.fulfill(json({ ...result(passed), submissionId: "s-new" }));
  });
  await page.route("**/api/submissions/s-old/result", (route: Route) => {
    calls.earlierResults += 1;
    return route.fulfill(json({ ...result(state.status === PASSED_ON_OLD_VERSION), submissionId: "s-old" }));
  });
  await page.route(/\/api\/submissions\/s-old$/, (route: Route) => route.fulfill(json({ submission: { id: "s-old", response: {} } })));
  await page.route("**/api/submissions/*/mcq-review", (route: Route) => route.fulfill(json({ enabled: false, questions: [] })));
  return { state, calls };
}

async function openModuleFromCourse(page: Page) {
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  await page.locator(".course-module-row").first().click();
}

test.describe("#934 5a-3: modulen åpnet fra kurset", () => {
  test("kurset sier «ta den på nytt»: siden sier det, starter et nytt forsøk, deltakeren består, og får kursbevis for den nye versjonen", async ({ page }) => {
    const { calls } = await mock(page);
    await openModuleFromCourse(page);

    // «Må tas på nytt» vises, ikke «Fullført» fra forrige vedtak.
    await expect(page.locator("#selectedModuleStatus")).toContainText(HINT);
    await expect(page.locator("#selectedModuleStatus")).not.toContainText("Fullført");

    // Et nytt forsøk starter på den nye versjonen. Det gamle resultatet legger seg ikke over.
    await expect.poll(() => calls.created.length).toBe(1);
    expect(calls.created[0]).toMatchObject({ moduleId: "m-1", moduleVersionId: "mv-2" });
    await expect(page.locator(".mcq-question-card")).toContainText("Spørsmål på den nye versjonen");
    expect(calls.earlierResults).toBe(0);

    await page.locator("input[name='q_q1']").first().check();
    await page.locator("#submitMcq").click();
    await expect(page.locator("#resultSummary .result-headline")).toContainText("Bestått");
    // Nytt vedtak: beskjeden om nytt forsøk er borte.
    await expect(page.locator("#selectedModuleStatus")).not.toContainText(HINT);

    // Fra serverens svar, etter innlasting: modulen er bestått, og kurset er fullført i versjon 2.
    await page.reload();
    await expect(page.locator(".course-accordion-item--done")).toBeVisible();
    await page.goto("/participant");
    await page.locator(".course-accordion-header").first().click();
    await expect(page.locator(".course-module-row").first()).toContainText("Bestått");
  });

  test("2.136.1: bestått, men serveren sier kravet står (en ny hovedversjon kom under vurderingen): beskjeden står, og neste klikk starter et nytt forsøk", async ({ page }) => {
    const { calls } = await mock(page, { serverStillRequires: true });
    await openModuleFromCourse(page);
    await expect.poll(() => calls.created.length).toBe(1);
    await page.locator("input[name='q_q1']").first().check();
    await page.locator("#submitMcq").click();
    await expect(page.locator("#resultSummary .result-headline")).toContainText("Bestått");
    await expect.poll(() => calls.details.c1).toBe(2);
    await page.waitForTimeout(300);
    await expect(page.locator("#selectedModuleStatus")).toContainText(HINT);
    expect(calls.details.c1).toBe(2);
  });

  test("2.136.1: et nytt stryk spør ikke serveren, og beskjeden står", async ({ page }) => {
    const { calls } = await mock(page, { newAttemptPasses: false });
    await openModuleFromCourse(page);
    await expect.poll(() => calls.created.length).toBe(1);
    await page.locator("input[name='q_q1']").first().check();
    await page.locator("#submitMcq").click();
    await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
    await page.waitForTimeout(300);
    await expect(page.locator("#selectedModuleStatus")).toContainText(HINT);
    expect(calls.details.c1).toBe(1);
  });

  test("2.136.1: svarer ikke serveren på kurset, står beskjeden, og resultatet vises", async ({ page }) => {
    const { calls } = await mock(page, { detailFailsAfterPass: true });
    await openModuleFromCourse(page);
    await expect.poll(() => calls.created.length).toBe(1);
    await page.locator("input[name='q_q1']").first().check();
    await page.locator("#submitMcq").click();
    await expect(page.locator("#resultSummary .result-headline")).toContainText("Bestått");
    await expect.poll(() => calls.details.c1).toBe(2);
    await page.waitForTimeout(300);
    await expect(page.locator("#selectedModuleStatus")).toContainText(HINT);
  });

  test("2.136.1: et annet kurs uten kravet tar ikke bort beskjeden fra kurset modulen ble åpnet fra", async ({ page }) => {
    const { calls } = await mock(page, { secondCourse: true, serverStillRequires: true });
    await page.goto("/participant");
    await page.locator('.course-accordion-item[data-course-id="c1"] .course-accordion-header').click();
    await page.locator("#courseDetail_c1 .course-module-row").first().click();
    await expect.poll(() => calls.created.length).toBe(1);
    await page.locator("input[name='q_q1']").first().check();
    await page.locator("#submitMcq").click();
    await expect(page.locator("#resultSummary .result-headline")).toContainText("Bestått");
    await expect.poll(() => calls.details.c1).toBe(2);

    // Tilbake til lista og inn i det andre kurset. Modulen står valgt, og der er kravet dekket.
    await page.locator("#courseBackBar button, #courseBackBar a").first().click();
    await page.locator('.course-accordion-item[data-course-id="c2"] .course-accordion-header').click();
    await expect.poll(() => calls.details.c2).toBe(1);
    await expect(page.locator("#courseDetail_c2 .course-module-row").first()).toBeVisible();
    await expect(page.locator("#selectedModuleStatus")).toContainText(HINT);
  });

  test("2.136.4: «marker lest og gå videre» til modulen, mens kurslista tømmer minnet: siden bruker raden, og sier ikke «Fullført»", async ({ page }) => {
    const { calls } = await mock(page);
    const vent = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let treg = false;
    let detaljer = 0;
    const rad = { id: "c1", title: "Kurset", description: null, moduleCount: 1, progress: { completed: 0, total: 2, moduleCompleted: 0, moduleTotal: 1, sectionCompleted: 0, sectionTotal: 1, courseStatus: "IN_PROGRESS" } };
    await page.route("**/api/courses", async (route: Route) => {
      if (treg) await vent(400);
      return route.fulfill(json({ courses: [rad] }));
    });
    await page.route("**/api/courses/completions", async (route: Route) => {
      if (treg) await vent(400);
      return route.fulfill(json({ completions: [] }));
    });
    await page.route("**/api/courses/c1", async (route: Route) => {
      detaljer += 1;
      if (treg && detaljer >= 3) await vent(1500);
      return route.fulfill(json({
        course: {
          id: "c1",
          title: "Kurset",
          items: [
            { type: "SECTION", sectionId: "sec1", courseItemId: "i-s", sortOrder: 0, title: "Lesestoff", read: false, available: true, required: true, discussionsEnabled: false },
            { type: "MODULE", moduleId: "m-1", courseItemId: "i-m", sortOrder: 1, title: "Modulen", moduleStatus: "REVISED_RETAKE_REQUIRED", retakeRequired: true, available: true, required: true, discussionsEnabled: false },
          ],
        },
      }));
    });
    await page.route("**/api/courses/c1/sections/sec1", (route: Route) => route.fulfill(json({ title: "Lesestoff", html: "<p>Tekst</p>", sectionVersionId: "sv1" })));
    await page.route("**/api/courses/c1/sections/sec1/read", (route: Route) => route.fulfill(json({ ok: true })));
    // Første åpning av en modul i økta: modullista hentes, og den er tregere enn kurslista.
    await page.route("**/api/modules**", async (route: Route) => {
      if (route.request().url().includes("/mcq/")) return route.fallback();
      await vent(800);
      return route.fulfill(json({
        modules: [{
          id: "m-1", title: "Modulen", description: null, assessmentMode: "MCQ_ONLY", submissionSchema: null, assessmentPolicy: null, taskText: null,
          activeVersion: { id: "mv-2", versionNo: 2 },
          participantStatus: PASSED_ON_OLD_VERSION,
        }],
      }));
    });

    await page.goto("/participant");
    await page.locator(".course-accordion-header").click();
    await page.locator(".course-module-row").first().click();
    await expect(page.locator("#sectionReaderMarkRead")).toBeEnabled();
    treg = true;
    await page.locator("#sectionReaderMarkRead").click();

    await expect(page.locator("#selectedModuleTitle")).toHaveText("Modulen");
    await expect(page.locator("#selectedModuleStatus")).toContainText(HINT);
    await expect(page.locator("#selectedModuleStatus")).not.toContainText("Fullført");
    await expect.poll(() => calls.created.length).toBe(1);
    expect(calls.earlierResults).toBe(0);
  });

  test("KONTROLL: med bryteren av (uten feltet) er siden som i 2.134.0. Forrige resultat vises, og ingenting starter av seg selv", async ({ page }) => {
    const { calls } = await mock(page, { retakeRequired: false });
    await openModuleFromCourse(page);
    await expect.poll(() => calls.earlierResults).toBe(1);
    await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
    await expect(page.locator("#selectedModuleStatus")).not.toContainText(HINT);
    await page.waitForTimeout(300);
    expect(calls.created).toHaveLength(0);
    // Raden sier fortsatt «revidert»: det gjør den i 2.134.0 også, for `SUPERSEDED`.
    await expect(page.locator(".course-module-row").first()).toContainText("Revidert");
  });

  test("har deltakeren alt strøket på nytt: resultatet vises, med anke og «Prøv igjen», og beskjeden står", async ({ page }) => {
    const { calls } = await mock(page, { status: FAILED_RETAKE });
    await openModuleFromCourse(page);
    await expect.poll(() => calls.earlierResults).toBe(1);
    await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
    await expect(page.locator("#selectedModuleStatus")).toContainText(HINT);
    await page.waitForTimeout(300);
    expect(calls.created).toHaveLength(0);
  });

  test("en modul som teller i dette kurset: ingen beskjed, og ingenting starter", async ({ page }) => {
    const { calls } = await mock(page, { retakeRequired: false, moduleStatus: "PASSED" });
    await openModuleFromCourse(page);
    await expect.poll(() => calls.earlierResults).toBe(1);
    await expect(page.locator("#selectedModuleStatus")).not.toContainText(HINT);
    await page.waitForTimeout(300);
    expect(calls.created).toHaveLength(0);
  });
});
