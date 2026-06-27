import { test, expect, type Page, type Route } from "@playwright/test";

// #495/T-QA-3 deltaker-UI: kjører den ekte discussion-panel.js + participant.js i mock-auth-modus
// mot mocket diskusjons-API. Dekker klientlaget (usynlig for supertest): opprett tråd, list,
// åpne tråd, svar — på kurs-nivå board.

async function mockBase(page: Page) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: {
          participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] },
        },
        calibrationWorkspace: { accessRoles: [] },
        flow: {},
        output: {},
      }),
    }),
  );
  await page.route("**/version", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }),
  );
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } }),
    }),
  );
  await page.route("**/api/queue-counts", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: {} }) }),
  );
  await page.route("**/api/courses/enrollments", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enrollments: [] }) }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );
  // Kursliste
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [
          { id: "c1", title: "Kurs 1", description: null, moduleCount: 0, progress: { completed: 0, total: 0, courseStatus: "NOT_STARTED" } },
        ],
      }),
    }),
  );
  // Kursdetalj (tomt kurs, diskusjon på)
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        course: {
          id: "c1", title: "Kurs 1", description: null, certificationLevel: null,
          publishedAt: "2026-01-01T00:00:00.000Z", discussionsEnabled: true,
          moduleCount: 0, progress: { completed: 0, total: 0, courseStatus: "NOT_STARTED" },
          modules: [], items: [],
        },
      }),
    }),
  );
}

function authorDto() {
  return { id: "u1", name: "P", anonymized: false };
}

test("participant: oppretter en kurs-nivå tråd, ser den i lista, åpner og svarer", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  // Stateful diskusjons-mock.
  const detailById: Record<string, Record<string, unknown>> = {};
  let nextId = 1;

  function summaries() {
    return Object.values(detailById).map((d) => ({
      id: d.id, courseId: "c1", courseItemId: null, kind: d.kind, status: d.status,
      title: d.title, deleted: false, pinned: false, acceptedReplyId: null,
      author: authorDto(), createdAt: d.createdAt, updatedAt: d.updatedAt,
      replyCount: (d.replies as unknown[]).length, canModerate: false,
    }));
  }

  // POST create / GET list
  await page.route("**/api/courses/c1/discussions", async (route: Route) => {
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      const id = `t${nextId++}`;
      const now = "2026-06-27T00:00:00.000Z";
      detailById[id] = {
        id, courseId: "c1", courseItemId: null, kind: body.kind, status: "OPEN",
        title: body.title, bodyHtml: `<p>${body.bodyMarkdown}</p>`, deleted: false, pinned: false,
        acceptedReplyId: null, author: authorDto(), createdAt: now, updatedAt: now,
        isSubscribed: true, canEdit: true, canDelete: true, canAccept: body.kind === "QUESTION",
        canModerate: false, replies: [],
      };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ thread: detailById[id] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ threads: summaries() }) });
  });

  // POST reply
  await page.route("**/api/courses/c1/discussions/*/replies", async (route: Route) => {
    const m = route.request().url().match(/discussions\/([^/]+)\/replies/);
    const id = m?.[1] ?? "";
    const body = JSON.parse(route.request().postData() ?? "{}");
    const detail = detailById[id];
    (detail.replies as unknown[]).push({
      id: `r${nextId++}`, bodyHtml: `<p>${body.bodyMarkdown}</p>`, deleted: false,
      author: authorDto(), createdAt: "2026-06-27T01:00:00.000Z", updatedAt: "2026-06-27T01:00:00.000Z",
      isAccepted: false, canEdit: true, canDelete: true,
    });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ thread: detail }) });
  });

  // GET detail
  await page.route("**/api/courses/c1/discussions/*", async (route: Route) => {
    const m = route.request().url().match(/discussions\/([^/?]+)/);
    const id = m?.[1] ?? "";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ thread: detailById[id] }) });
  });

  await page.goto("/participant");
  await page.locator("#loadCoursesBtn").click();

  // Åpne kurs-accordion → laster detalj → monterer diskusjonspanel.
  await page.locator(".course-accordion-header").first().click();

  const panel = page.locator("[data-course-discussion='c1']");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-disc-empty]")).toBeVisible();

  // Opprett en diskusjonstråd.
  await panel.locator("[data-disc-new]").click();
  await panel.locator("[data-disc-kind]").selectOption("DISCUSSION");
  await panel.locator("[data-disc-title]").fill("Min første tråd");
  await panel.locator("[data-disc-text]").fill("Hei alle sammen");
  await panel.locator("[data-disc-new-form] button[type=submit]").click();

  // Etter opprettelse vises tråd-visningen med tittel + body.
  await expect(panel.getByText("Min første tråd")).toBeVisible();
  await expect(panel.locator(".discussion-body")).toContainText("Hei alle sammen");

  // Gå tilbake til lista — tråden er der.
  await panel.locator("[data-disc-back]").click();
  await expect(panel.locator("[data-disc-thread]")).toHaveCount(1);

  // Åpne tråden og svar.
  await panel.locator("[data-disc-thread]").first().click();
  await panel.locator("[data-disc-reply-text]").fill("Mitt svar");
  await panel.locator("[data-disc-reply-form] button[type=submit]").click();
  await expect(panel.locator(".discussion-reply")).toHaveCount(1);
  await expect(panel.locator(".discussion-reply")).toContainText("Mitt svar");
});
