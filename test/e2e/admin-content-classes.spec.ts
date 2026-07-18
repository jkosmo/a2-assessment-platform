import { test, expect, type Page, type Route } from "@playwright/test";

// #645/CL-3: browser e2e for the classes (cohort) admin page — runs the real front-end JS against
// mocked APIs, covering the client wiring (list, create, add student via search, assign course).

async function mockBaseApis(page: Page, roles: string[] = ["SUBJECT_MATTER_OWNER"]) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles } },
        calibrationWorkspace: { accessRoles: [] },
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
      body: JSON.stringify({ user: { roles }, consent: { accepted: true, currentVersion: "1.0" } }),
    }),
  );
}

test("classes admin: list, create, add a student via search, and assign a course", async ({ page }) => {
  await mockBaseApis(page);

  const state = {
    classes: [{ id: "cls_all_participants", name: "Alle deltakere", isSystem: true, _count: { members: 0, courseAssignments: 0 } }],
    members: [] as Array<{ userId: string; name: string; email: string; addedAt: string }>,
    assignedCourses: [] as Array<{ courseId: string; title: string; dueAt: string | null }>,
  };
  let memberPosted = false;
  let coursePosted = false;

  await page.route("**/api/admin/content/classes", (route: Route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { name: string };
      const created = { id: "cls-new", name: body.name, isSystem: false, _count: { members: 0, courseAssignments: 0 } };
      state.classes.push(created);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ class: created }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: state.classes }) });
  });
  await page.route("**/api/admin/content/classes/*/members", (route: Route) => {
    if (route.request().method() === "POST") {
      memberPosted = true;
      state.members.push({ userId: "u1", name: "Kari Nordmann", email: "kari@x.no", addedAt: new Date(0).toISOString() });
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ members: state.members }) });
  });
  await page.route("**/api/admin/content/classes/*/courses", (route: Route) => {
    if (route.request().method() === "POST") {
      coursePosted = true;
      // #497: mirror the server — persist the assigned course WITH its due date so the re-rendered
      // chip can display the frist.
      const body = route.request().postDataJSON() as { courseId: string; dueAt?: string };
      state.assignedCourses.push({ courseId: body.courseId, title: JSON.stringify({ nb: "Arbeidsmiljø" }), dueAt: body.dueAt ?? null });
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: state.assignedCourses }) });
  });
  await page.route("**/api/admin/content/users/search**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ users: [{ id: "u1", name: "Kari Nordmann", email: "kari@x.no" }] }) }),
  );
  await page.route("**/api/admin/content/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [
          { id: "course-1", title: JSON.stringify({ nb: "Arbeidsmiljø" }), archivedAt: null },
          // #688: archived courses must NOT be offered for assignment.
          { id: "course-arch", title: JSON.stringify({ nb: "Gammelt kurs" }), archivedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    }),
  );

  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content/classes");

  // List renders the system class with a real heading (no raw i18n keys).
  await expect(page.locator("h1")).toContainText("Klasser");
  await expect(page.locator("#classesTableBody")).toContainText("Alle deltakere");

  // Create a class.
  page.once("dialog", (dialog) => dialog.accept("Kull 2026"));
  await page.locator("#newClassBtn").click();
  await expect(page.locator("#classesTableBody")).toContainText("Kull 2026");

  // Open the new class → detail view.
  await page.locator('[data-action="open"][data-id="cls-new"]').click();
  await expect(page.locator("#studentSearch")).toBeVisible();

  // Search a student and add them.
  await page.locator("#studentSearch").fill("kari");
  await expect(page.locator("#searchResults")).toContainText("Kari Nordmann");
  await page.locator('[data-add-user="u1"]').click();
  await expect.poll(() => memberPosted).toBe(true);
  await expect(page.locator("#memberChips")).toContainText("Kari Nordmann");

  // #688: the archived course must not be an assignable option; the active one must.
  await expect(page.locator('#courseSelect option[value="course-arch"]')).toHaveCount(0);
  await expect(page.locator('#courseSelect option[value="course-1"]')).toHaveCount(1);

  // #497: the due-date input carries a visible label so it is clear what the date means.
  await expect(page.locator('label[for="dueAtInput"]')).toContainText("Frist");

  // Assign a course WITH a due date.
  await page.locator("#courseSelect").selectOption("course-1");
  await page.locator("#dueAtInput").fill("2026-07-17");
  await page.locator("#assignCourseBtn").click();
  await expect.poll(() => coursePosted).toBe(true);

  // #497: the assigned-course chip shows the frist (formatted DD.MM.YYYY, no timezone shift).
  await expect(page.locator("#courseChips")).toContainText("Arbeidsmiljø");
  await expect(page.locator("#courseChips")).toContainText("Frist: 17.07.2026");
});

// #690: the "Synk brukere fra Entra" button is ADMINISTRATOR-only and triggers the Entra user sync.
test("classes admin: Entra user-sync button is admin-only and posts to the sync endpoint", async ({ page }) => {
  // SUBJECT_MATTER_OWNER must NOT see the button.
  await mockBaseApis(page, ["SUBJECT_MATTER_OWNER"]);
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [] }) }),
  );
  await page.goto("/admin-content/classes");
  await expect(page.locator("h1")).toContainText("Klasser");
  await expect(page.locator("#syncEntraBtn")).toHaveCount(0);
});

test("classes admin: ADMINISTRATOR sees the Entra sync button and clicking it posts", async ({ page }) => {
  await mockBaseApis(page, ["ADMINISTRATOR"]);
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [] }) }),
  );
  let syncPosted = false;
  await page.route("**/api/admin/sync/org/entra", (route: Route) => {
    syncPosted = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ importedUsers: 61, fetchedMembers: 61 }) });
  });

  await page.goto("/admin-content/classes");
  await expect(page.locator("#syncEntraBtn")).toBeVisible();
  await page.locator("#syncEntraBtn").click();
  await expect.poll(() => syncPosted).toBe(true);
});

// #690 regression: in prod (Entra auth) `identityDefaults` is undefined — admin gating AND the
// workspace nav role filter MUST come from /api/me's live roles. Guards two prod bugs: (1) import/sync
// buttons hidden because isAdministrator read absent identityDefaults; (2) the top workspace nav never
// rendered because the whole config object was passed as navItems (→ sanitized to []) and roles were "".
test("classes admin: admin buttons + top nav render in prod-shaped config (role from /api/me)", async ({ page }) => {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      // Prod shape: mockRoleSwitch disabled → identityDefaults omitted entirely. Two nav items: one
      // open, one role-gated (only visible if the live roles include SUBJECT_MATTER_OWNER).
      body: JSON.stringify({
        authMode: "mock",
        navigation: {
          items: [
            { id: "dashboard", path: "/dashboard", labelKey: "Oversikt", requiredRoles: [] },
            { id: "review", path: "/review", labelKey: "Vurdering", requiredRoles: ["SUBJECT_MATTER_OWNER"] },
            // #705-UX(D): a REAL i18n key — the classes page must resolve it via tNav, not render
            // the raw key. (The earlier mock used display strings as labelKeys, hiding the bug.)
            { id: "adminContent", path: "/admin-content/courses", labelKey: "nav.adminContent", requiredRoles: [] },
          ],
          workspaceItems: [],
        },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }),
  );
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["ADMINISTRATOR", "SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [] }) }),
  );
  await page.goto("/admin-content/classes");
  await expect(page.locator("#importUsersBtn")).toBeVisible();
  await expect(page.locator("#syncEntraBtn")).toBeVisible();
  // Top workspace nav renders both the open item and the role-gated one (live roles applied).
  await expect(page.locator("#workspaceNav")).toBeVisible();
  await expect(page.locator('#workspaceNav a', { hasText: "Oversikt" })).toBeVisible();
  await expect(page.locator('#workspaceNav a', { hasText: "Vurdering" })).toBeVisible();
  // #705-UX(D): the real i18n key must be resolved (translated), never rendered raw.
  await expect(page.locator("#workspaceNav")).not.toContainText("nav.adminContent");
});

// #690 fallback: ADMINISTRATOR imports users from a JSON file → POST /api/admin/sync/org/delta.
test("classes admin: importing a users file posts to the delta sync endpoint", async ({ page }) => {
  await mockBaseApis(page, ["ADMINISTRATOR"]);
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [] }) }),
  );
  let deltaBody: unknown = null;
  await page.route("**/api/admin/sync/org/delta", (route: Route) => {
    deltaBody = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: { createdCount: 2, updatedCount: 0, failedCount: 0 } }) });
  });

  await page.goto("/admin-content/classes");
  await expect(page.locator("#importUsersBtn")).toBeVisible();

  // Provide the file directly to the hidden input (no OS picker).
  await page.locator("#importUsersFile").setInputFiles({
    name: "entra-export.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        source: "entra_manual_export",
        users: [
          { externalId: "oid-1", email: "a@x.no", name: "A", activeStatus: true },
          { externalId: "oid-2", email: "b@x.no", name: "B", activeStatus: true },
        ],
      }),
    ),
  });

  await expect.poll(() => deltaBody).not.toBeNull();
  expect((deltaBody as { source: string }).source).toBe("entra_manual_export");
  expect((deltaBody as { users: unknown[] }).users).toHaveLength(2);
});
