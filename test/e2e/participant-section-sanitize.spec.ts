import { test, expect, type Page, type Route } from "@playwright/test";

// #814: the section reader re-sanitizes server HTML client-side (defense-in-depth) with the SAME policy
// as the server (sectionContent.ts) — so injected <script>/on*-handlers and non-allowlisted iframes are
// stripped, while allowed content (incl. YouTube/Vimeo embeds) survives (NOT a blanket DOMPurify default).
// Runs the real participant.js + the vendored DOMPurify in Chromium against mocked APIs.

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
}

test("participant: the section reader strips dangerous markup but keeps allowed embeds (#814)", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 1, progress: { completed: 0, total: 1, courseStatus: "NOT_STARTED" } }] }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ course: { id: "c1", title: "Kurs", items: [{ type: "SECTION", sectionId: "s1", title: "Seksjon", read: false }] } }),
    }),
  );
  // Malicious + allowed HTML mixed. If the client only trusted the server, an unsanitized response like
  // this would inject markup. The client sanitizer must strip the script/onerror/evil-iframe and keep
  // the paragraph, the bold text, and the allowlisted YouTube embed.
  const sectionHtml = [
    "<p>Trygt innhold</p>",
    "<strong>uthevet</strong>",
    "<script>window.__pwned = true;</script>",
    '<img src="x" onerror="window.__pwned = true">',
    '<iframe src="https://evil.example.com/x"></iframe>',
    '<iframe src="https://www.youtube.com/embed/abc123" allowfullscreen></iframe>',
  ].join("");
  await page.route("**/api/courses/c1/sections/s1", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "Seksjon", html: sectionHtml }) }),
  );

  await page.goto("/participant");
  await expect(page.locator("#loadCoursesBtn")).toBeEnabled();
  await page.locator("#loadCoursesBtn").click();
  await page.locator(".course-accordion-header").click();
  await page.locator(".course-module-row").click();

  const body = page.locator("#sectionReaderBody");
  await expect(body).toContainText("Trygt innhold");

  // Allowed content survives.
  await expect(body.locator("strong")).toHaveText("uthevet");
  // Allowlisted YouTube embed is preserved (matching policy, not a blanket default that strips iframes).
  await expect(body.locator('iframe[src*="youtube.com"]')).toHaveCount(1);

  // Dangerous / non-allowlisted content is stripped.
  await expect(body.locator("script")).toHaveCount(0);
  await expect(body.locator('iframe[src*="evil.example.com"]')).toHaveCount(0);
  const img = body.locator("img");
  if (await img.count()) {
    expect(await img.first().getAttribute("onerror")).toBeNull();
  }
  // The injected script never executed.
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned ?? false)).toBe(false);
});
