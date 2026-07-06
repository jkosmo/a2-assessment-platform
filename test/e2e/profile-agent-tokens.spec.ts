import { test, expect, type Page, type Route } from "@playwright/test";

// #731 (AA-3): the "Agent access" section on the profile page — issue a short-
// lived agent authoring token (secret shown once), list own tokens, revoke.
// Runs the real profile.js against mocked APIs; asserts role gating (hidden for
// PARTICIPANT, visible for SUBJECT_MATTER_OWNER), the issue POST body, the
// one-time secret reveal, and the revoke POST + re-render.

type TokenRecord = {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

async function mockProfile(page: Page, roles: string[]) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: {
          participant: { userId: "user-1", email: "u@x.no", name: "U", department: "X", roles },
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
      body: JSON.stringify({
        user: { id: "user-1", name: "U", email: "u@x.no", roles },
        consent: { accepted: true, currentVersion: "1.0" },
      }),
    }),
  );
  await page.route("**/api/queue-counts", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: {} }) }),
  );
  await page.route("**/api/modules/completed**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: [] }) }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );
  await page.addInitScript(() => {
    try {
      localStorage.setItem("participant.locale", "en-GB");
    } catch {
      /* ignore */
    }
  });
}

// Stateful mock for the three token endpoints (GET list, POST create, POST revoke).
function mockTokenApi(page: Page) {
  const state: { tokens: TokenRecord[]; lastCreateBody: unknown } = { tokens: [], lastCreateBody: null };
  page.route("**/api/admin/content/agent-authoring/tokens**", (route: Route) => {
    const url = route.request().url();
    const method = route.request().method();
    const revokeMatch = url.match(/\/tokens\/([^/?]+)\/revoke/);

    if (method === "POST" && revokeMatch) {
      const token = state.tokens.find((entry) => entry.id === revokeMatch[1]);
      if (token) token.revokedAt = new Date().toISOString();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token: { id: revokeMatch[1], revokedAt: token?.revokedAt ?? null } }),
      });
    }
    if (method === "POST") {
      state.lastCreateBody = route.request().postDataJSON();
      const body = state.lastCreateBody as { label?: string; ttlMinutes?: number };
      const record: TokenRecord = {
        id: `tok-${state.tokens.length + 1}`,
        label: body.label ?? null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + (body.ttlMinutes ?? 60) * 60_000).toISOString(),
        revokedAt: null,
        lastUsedAt: null,
      };
      state.tokens.push(record);
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          token: "aat_e2e0000000000000000000000000000000000000000000",
          id: record.id,
          label: record.label,
          expiresAt: record.expiresAt,
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tokens: state.tokens }),
    });
  });
  return state;
}

test("profile: agent access section is hidden for participants", async ({ page }) => {
  await mockProfile(page, ["PARTICIPANT"]);
  await page.goto("/profile");
  await expect(page.locator("#profileName")).toHaveText("U");
  await expect(page.locator("#agentTokensSection")).toBeHidden();
});

test("profile: SMO can issue a token (secret shown once) and revoke it", async ({ page }) => {
  await mockProfile(page, ["SUBJECT_MATTER_OWNER"]);
  const api = mockTokenApi(page);

  await page.goto("/profile");
  const section = page.locator("#agentTokensSection");
  await expect(section).toBeVisible();
  await expect(section.locator("h2")).toHaveText("Agent access");
  await expect(page.locator("#agentTokensBody")).toContainText("No tokens yet.");

  // Issue with label + 30 min TTL.
  await page.fill("#agentTokenLabel", "ChatGPT-økt");
  await page.selectOption("#agentTokenTtl", "30");
  await page.click("#issueAgentTokenBtn");

  await expect(page.locator("#agentTokenReveal")).toBeVisible();
  await expect(page.locator("#agentTokenSecret")).toContainText(/^aat_/);
  await expect.poll(() => api.lastCreateBody).toEqual({ label: "ChatGPT-økt", ttlMinutes: 30 });

  // The list refreshed with the new active token and a revoke action.
  const row = page.locator("#agentTokensBody tr").first();
  await expect(row).toContainText("ChatGPT-økt");
  await expect(row).toContainText("Active");
  const revokeBtn = row.locator("button");
  await expect(revokeBtn).toHaveText("Revoke");

  await revokeBtn.click();
  await expect.poll(() => api.tokens[0]?.revokedAt).not.toBeNull();
  await expect(page.locator("#agentTokensBody tr").first()).toContainText("Revoked");
  await expect(page.locator("#agentTokensBody button")).toHaveCount(0);
});
