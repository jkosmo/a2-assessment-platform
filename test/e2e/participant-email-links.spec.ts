import { test, expect, type Page, type Route } from "@playwright/test";

// Lenkene i e-post (compliance 2026-11-06). Resultat og anke lenker til modulen, som bare kan åpnes inne i et kurs, og e-posten vet ikke
// hvilket. Diskusjonen lenker til tråden. Kjører den ekte participant.js mot falske API-er. Teksten i e-postene står i
// test/unit/email-template-links-1141.test.ts.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const NOTICE = "Vi fant ikke denne modulen i kursene dine.";
const RETAKE_HINT = "Modulen er revidert etter at du besto den";

type CourseSetup = { id: string; moduleIds?: string[]; retakeRequired?: boolean; detailFails?: boolean; discussionsEnabled?: boolean };

async function mock(page: Page, courses: CourseSetup[], options: { threadExists?: boolean } = {}) {
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
    route.fulfill(json({
      courses: courses.map((c) => ({ id: c.id, title: `Kurs ${c.id}`, description: null, moduleCount: 1, progress: { completed: 0, total: 1, moduleCompleted: 0, moduleTotal: 1, sectionCompleted: 0, sectionTotal: 0, courseStatus: "IN_PROGRESS" } })),
    })),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/enrollments", (route: Route) => route.fulfill(json({ enrollments: [] })));
  for (const c of courses) {
    await page.route(`**/api/courses/${c.id}`, (route: Route) => {
      if (c.detailFails) return route.fulfill(json({ error: "internal_error" }, 500));
      return route.fulfill(json({
        course: {
          id: c.id,
          title: `Kurs ${c.id}`,
          discussionsEnabled: c.discussionsEnabled ?? false,
          modules: [],
          items: (c.moduleIds ?? []).map((moduleId, index) => ({
            type: "MODULE",
            moduleId,
            courseItemId: `i-${c.id}-${index}`,
            sortOrder: index,
            title: "Modulen",
            moduleStatus: c.retakeRequired ? "REVISED_RETAKE_REQUIRED" : "IN_PROGRESS",
            ...(c.retakeRequired ? { retakeRequired: true } : {}),
            available: true,
            required: true,
            discussionsEnabled: false,
          })),
        },
      }));
    });
  }
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
        activeVersion: { id: "mv-1", versionNo: 1 },
        participantStatus: { latestSubmissionId: "s-1", latestStatus: "COMPLETED", latestDecision: { passFailTotal: false, totalScore: 20 } },
      }],
    })),
  );
  await page.route("**/api/submissions/s-1/result", (route: Route) =>
    route.fulfill(json({ status: "COMPLETED", submissionId: "s-1", decision: { passFailTotal: false, decisionType: "AUTOMATIC" }, scoreComponents: { totalScore: 20, mcqScaledScore: 20, practicalScaledScore: 0 }, participantGuidance: {} })),
  );
  await page.route(/\/api\/submissions\/s-1$/, (route: Route) => route.fulfill(json({ submission: { id: "s-1", response: {} } })));
  await page.route("**/api/submissions/*/mcq-review", (route: Route) => route.fulfill(json({ enabled: false, questions: [] })));
  await page.route("**/api/submissions", (route: Route) => route.fulfill(json({ submission: { id: "s-2", submissionStatus: "SUBMITTED" } }, 201)));
  await page.route("**/api/modules/*/mcq/start**", (route: Route) => route.fulfill(json({ attemptId: "a1", questions: [{ id: "q1", stem: "Spørsmål", options: ["A", "B"] }] })));

  const author = { id: "u1", name: "P", anonymized: false };
  await page.route("**/api/courses/c1/discussions", (route: Route) =>
    route.fulfill(json({ threads: [{ id: "t-1", courseId: "c1", courseItemId: null, kind: "QUESTION", status: "OPEN", title: "Tråden i lista", deleted: false, pinned: false, acceptedReplyId: null, author, createdAt: "2026-11-06T10:00:00.000Z", updatedAt: "2026-11-06T10:00:00.000Z", replyCount: 0, canModerate: false }] })),
  );
  await page.route("**/api/courses/c1/discussions/*", (route: Route) => {
    if (options.threadExists === false) return route.fulfill(json({ error: "not_found" }, 404));
    return route.fulfill(json({ thread: { id: "t-1", courseId: "c1", courseItemId: null, kind: "QUESTION", status: "OPEN", title: "Tråden fra e-posten", bodyHtml: "<p>Innhold</p>", deleted: false, pinned: false, acceptedReplyId: null, author, createdAt: "2026-11-06T10:00:00.000Z", updatedAt: "2026-11-06T10:00:00.000Z", isSubscribed: true, canEdit: false, canDelete: false, canAccept: false, canModerate: false, replies: [] } }));
  });
}

test.describe("lenke til modulen", () => {
  test("åpner kurset og modulen, viser resultatet, og adressen blir den vanlige", async ({ page }) => {
    await mock(page, [{ id: "c1", moduleIds: ["m-1"] }]);
    await page.goto("/participant?moduleId=m-1");
    await expect(page.locator('.course-accordion-item[data-course-id="c1"].is-focused')).toBeVisible();
    await expect(page.locator("#courseDetail_c1 #moduleWorkspace")).toBeVisible();
    await expect(page.locator("#resultSummary .result-headline")).toContainText("Ikke bestått");
    await expect(page).toHaveURL(/\/participant\?courseId=c1$/);
    await expect(page.locator("#courseLinkNotice")).toBeHidden();
  });

  test("finner kurset modulen ligger i, ikke bare det første", async ({ page }) => {
    await mock(page, [{ id: "c1", moduleIds: ["annen-modul"] }, { id: "c2", moduleIds: ["m-1"] }]);
    await page.goto("/participant?moduleId=m-1");
    await expect(page.locator("#courseDetail_c2 #moduleWorkspace")).toBeVisible();
    await expect(page).toHaveURL(/courseId=c2$/);
  });

  test("ligger modulen i flere kurs, velges det som krever nytt forsøk, og deltakeren ser kravet", async ({ page }) => {
    await mock(page, [{ id: "c1", moduleIds: ["m-1"] }, { id: "c2", moduleIds: ["m-1"], retakeRequired: true }]);
    await page.goto("/participant?moduleId=m-1");
    await expect(page.locator("#courseDetail_c2 #moduleWorkspace")).toBeVisible();
    await expect(page.locator("#selectedModuleStatus")).toContainText(RETAKE_HINT);
  });

  test("et kurs som ikke kan lastes, stopper ikke lenken", async ({ page }) => {
    await mock(page, [{ id: "c1", detailFails: true }, { id: "c2", moduleIds: ["m-1"] }]);
    await page.goto("/participant?moduleId=m-1");
    await expect(page.locator("#courseDetail_c2 #moduleWorkspace")).toBeVisible();
  });

  test("modulen finnes ikke i kursene: meldingen, kurslista står, og ingen innlevering startes", async ({ page }) => {
    let created = 0;
    await mock(page, [{ id: "c1", moduleIds: ["annen-modul"] }]);
    await page.route("**/api/submissions", (route: Route) => {
      created += 1;
      return route.fulfill(json({ submission: { id: "s-2" } }, 201));
    });
    await page.goto("/participant?moduleId=m-1");
    await expect(page.locator("#courseLinkNotice")).toContainText(NOTICE);
    await expect(page.locator('.course-accordion-item[data-course-id="c1"]')).toBeVisible();
    await expect(page.locator(".course-accordion-item.is-focused")).toHaveCount(0);
    expect(created).toBe(0);
  });

  test("deltaker uten kurs får meldingen", async ({ page }) => {
    await mock(page, []);
    await page.goto("/participant?moduleId=m-1");
    await expect(page.locator("#courseLinkNotice")).toContainText(NOTICE);
  });
});

test.describe("lenke til en tråd", () => {
  test("åpner kurset, panelet og tråden, og tar tråden ut av adressen", async ({ page }) => {
    await mock(page, [{ id: "c1", discussionsEnabled: true }]);
    await page.goto("/participant?courseId=c1&threadId=t-1");
    await expect(page.locator(".course-discussion-body")).toBeVisible();
    await expect(page.locator(".course-discussion-body")).toContainText("Tråden fra e-posten");
    await expect(page).toHaveURL(/\/participant\?courseId=c1$/);
  });

  test("tråden finnes ikke lenger: lista vises", async ({ page }) => {
    await mock(page, [{ id: "c1", discussionsEnabled: true }], { threadExists: false });
    await page.goto("/participant?courseId=c1&threadId=borte");
    await expect(page.locator(".course-discussion-body")).toContainText("Tråden i lista");
  });

  test("kurset har ikke diskusjon: kurset åpnes likevel", async ({ page }) => {
    await mock(page, [{ id: "c1", moduleIds: ["m-1"], discussionsEnabled: false }]);
    await page.goto("/participant?courseId=c1&threadId=t-1");
    await expect(page.locator('.course-accordion-item[data-course-id="c1"].is-focused')).toBeVisible();
    await expect(page.locator(".course-discussion-body")).toHaveCount(0);
  });

  test("uten tråd i adressen er diskusjonen lukket, som før", async ({ page }) => {
    await mock(page, [{ id: "c1", discussionsEnabled: true }]);
    await page.goto("/participant?courseId=c1");
    await expect(page.locator(".course-discussion-toggle")).toBeVisible();
    await expect(page.locator(".course-discussion-body")).toBeHidden();
  });
});
