import { test, expect, type Page, type Route } from "@playwright/test";

// Browser e2e for the section editor (U1/U2, #483/#524). Runs the REAL front-end JS in Chromium
// against mocked APIs — covering the client-layer bugs supertest/integration tests can't see:
//  - raw i18n/label keys leaking into the UI (t()/L() returning the key)
//  - the image-upload request being sent with the wrong Content-Type (FormData must be multipart,
//    not application/json — the 500 we hit in manual testing)
//  - markdown live-preview wiring

async function mockBaseApis(page: Page) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: {
          contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] },
        },
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
      // The consent guard (#540) reads consent.accepted; without it init throws.
      body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }),
    }),
  );
}

test("section editor: no raw i18n keys, and image upload is sent as multipart", async ({ page }) => {
  await mockBaseApis(page);

  await page.route("**/api/admin/content/sections", (route: Route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ section: { id: "sec1", versionNo: 1 } }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) });
  });
  await page.route("**/api/admin/content/sections/preview", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>preview-ok</p>" }) }),
  );

  let uploadContentType: string | null = null;
  await page.route("**/api/admin/content/sections/sec1/assets", (route: Route) => {
    uploadContentType = route.request().headers()["content-type"] ?? null;
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ asset: { id: "a1", ref: "asset:a1", sectionId: "sec1", filename: "x.png", mimeType: "image/png", sizeBytes: 10 } }) });
  });

  // Force a deterministic locale (the test browser would otherwise default to en-GB).
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
  await page.goto("/admin-content/sections");

  // List heading must be a real label, not the raw key "heading".
  await expect(page.locator("h1")).toContainText("Seksjon");

  await page.getByRole("button", { name: /Ny seksjon/ }).click();

  // Editor controls show real labels, never the raw L() keys.
  const bodyText = await page.locator("#main-content").innerText();
  for (const rawKey of ["uploadImage", "saveFirst", "titleLabel", "courses.section"]) {
    expect(bodyText).not.toContain(rawKey);
  }

  await page.locator("#titleInput").fill("Tittel");
  await page.locator("#markdownInput").fill("# Hei");
  // Save so the section gets an id (upload requires a saved section).
  await page.getByRole("button", { name: /Lagre ny versjon/ }).click();

  // The alt-text prompt — accept it.
  page.on("dialog", (dialog) => dialog.accept("alt-tekst"));

  await page.getByRole("button", { name: /Last opp bilde/ }).click();
  await page.locator("#imageFileInput").setInputFiles({ name: "x.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });

  await expect.poll(() => uploadContentType).not.toBeNull();
  expect(uploadContentType).toContain("multipart/form-data");
  expect(uploadContentType).not.toContain("application/json");

  // The asset reference is inserted into the markdown.
  await expect(page.locator("#markdownInput")).toHaveValue(/asset:a1/);
});

// #540: the section editor must show the blocking consent dialog when consent is not yet
// accepted — not dump the raw "403 consent_required" JSON into the content area.
test("section editor: shows consent dialog (not raw 403) when consent not accepted", async ({ page }) => {
  await mockBaseApis(page);
  // Override /api/me to report consent NOT accepted.
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: false, currentVersion: "1.0" } }),
    }),
  );
  // The consent text endpoint (GET) the guard fetches to render the modal.
  await page.route("**/api/me/consent", (route: Route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: "1.0", body: "Personvern", platformName: "A2" }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/admin/content/sections", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) }),
  );

  await page.goto("/admin-content/sections");

  // The blocking consent modal must appear …
  await expect(page.locator("#consent-modal-overlay")).toBeVisible();
  // … and the raw error must NOT be shown anywhere.
  await expect(page.locator("#main-content")).not.toContainText("consent_required");
});

// #542: in mock mode the participant console must send the x-user-* identity headers when
// loading courses. The bug passed the header OBJECT to apiFetch (which expects a function),
// so apiFetch silently dropped the headers → backend fell back to a roleless default user → 403.
// On Entra the Bearer token hid this; only mock mode (local) exposes it.
test("participant: course load sends x-user-* identity headers in mock mode", async ({ page }) => {
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

  let coursesUserId: string | undefined;
  let coursesRoles: string | undefined;
  await page.route("**/api/courses", (route: Route) => {
    const h = route.request().headers();
    coursesUserId = h["x-user-id"];
    coursesRoles = h["x-user-roles"];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 1, progress: { completed: 0, total: 1, courseStatus: "NOT_STARTED" } }] }),
    });
  });
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );

  await page.goto("/participant");
  await page.locator("#loadCoursesBtn").click();

  await expect.poll(() => coursesUserId).toBe("participant-1");
  expect(coursesRoles).toContain("PARTICIPANT");
});
