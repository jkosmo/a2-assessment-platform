import { test, expect, type Page, type Route } from "@playwright/test";

// #475 participant UI: the AI-use declaration. Runs the real participant.js in mock-auth mode against
// mocked APIs (the client layer — config gating, the reflective nudge, and the POST body shape — is
// invisible to supertest). Three guarantees:
//   1. Dormant by default: with the feature off, no declaration block appears and the POST carries no
//      processSignals (so the feature ships invisible to participants).
//   2. When live, declaring "autonomous" triggers the reflective nudge; "go back" cancels the submit.
//   3. Insisting after the nudge submits with processSignals { declaration: "autonomous",
//      insistedAfterPrompt: true }; a non-autonomous declaration submits directly.

const ESSAY_MODULE = {
  id: "m-fto",
  title: "Essay Modul",
  description: null,
  assessmentMode: "FREETEXT_ONLY",
  submissionSchema: null,
  assessmentPolicy: null,
  taskText: "Skriv et essay",
  activeVersion: { versionNo: 1 },
  participantStatus: null,
};

function configBody(aiInfluence?: { enabled: boolean; shadowMode: boolean }) {
  return {
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: {
      participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] },
    },
    calibrationWorkspace: { accessRoles: [] },
    flow: { autoStartAfterMcq: false },
    output: {},
    ...(aiInfluence ? { aiInfluence } : {}),
  };
}

async function mockBase(page: Page, aiInfluence?: { enabled: boolean; shadowMode: boolean }) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(configBody(aiInfluence)) }),
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
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: [ESSAY_MODULE] }) }),
  );
  // Assessment side-effects are irrelevant to this spec — stub them so nothing errors after submit.
  await page.route("**/api/assessments/*/run", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
  );
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "PROCESSING" }) }),
  );
}

async function selectEssayModule(page: Page) {
  await page.goto("/participant");
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "Essay Modul" }).click();
  await expect(page.locator("#submissionFields textarea").first()).toBeVisible();
}

test("participant: AI declaration is dormant when the feature is off (no block, no processSignals)", async ({ page }) => {
  await mockBase(page); // no aiInfluence → client default disabled
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  let postedBody: Record<string, unknown> | null = null;
  await page.route("**/api/submissions", (route: Route) => {
    postedBody = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) });
  });

  await selectEssayModule(page);
  await expect(page.locator("#aiDeclaration")).toBeHidden();

  for (const ta of await page.locator("#submissionFields textarea").all()) {
    await ta.fill("Et tilstrekkelig langt fritekstsvar for vurdering.");
  }
  await page.locator("#ack").check();
  await page.locator("#createSubmission").click();

  await expect.poll(() => postedBody !== null).toBe(true);
  expect(postedBody).not.toHaveProperty("processSignals");
});

test("participant: declaring autonomous shows the nudge; 'go back' cancels, 'submit anyway' sends the flag", async ({ page }) => {
  await mockBase(page, { enabled: true, shadowMode: false }); // live
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  let submitCount = 0;
  let postedBody: Record<string, unknown> | null = null;
  await page.route("**/api/submissions", (route: Route) => {
    submitCount += 1;
    postedBody = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) });
  });

  await selectEssayModule(page);
  // The declaration block is shown for this free-text module.
  await expect(page.locator("#aiDeclaration")).toBeVisible();

  // Fill the answer + acknowledge, but the submit button stays disabled until a declaration is chosen.
  for (const ta of await page.locator("#submissionFields textarea").all()) {
    await ta.fill("Et tilstrekkelig langt fritekstsvar for vurdering.");
  }
  await page.locator("#ack").check();
  await expect(page.locator("#createSubmission")).toBeDisabled();

  // Choose "AI generated most of it" → button enables.
  await page.locator('#aiDeclaration input[value="autonomous"]').check();
  await expect(page.locator("#createSubmission")).toBeEnabled();

  // Submitting shows the reflective nudge; choosing "go back" cancels — nothing is submitted.
  await page.locator("#createSubmission").click();
  const nudge = page.locator(".ai-nudge-overlay");
  await expect(nudge).toBeVisible();
  await nudge.locator('[data-nudge="back"]').click();
  await expect(nudge).toBeHidden();
  expect(submitCount).toBe(0);

  // Submit again, then insist → the submission is sent with the autonomous flag + insisted marker.
  await page.locator("#createSubmission").click();
  await expect(page.locator(".ai-nudge-overlay")).toBeVisible();
  await page.locator('.ai-nudge-overlay [data-nudge="insist"]').click();

  await expect.poll(() => submitCount).toBe(1);
  expect(postedBody).toMatchObject({
    processSignals: { declaration: "autonomous", insistedAfterPrompt: true },
  });
});

test("participant: a non-autonomous declaration submits directly with no nudge", async ({ page }) => {
  await mockBase(page, { enabled: true, shadowMode: false });
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  let postedBody: Record<string, unknown> | null = null;
  await page.route("**/api/submissions", (route: Route) => {
    postedBody = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) });
  });

  await selectEssayModule(page);
  for (const ta of await page.locator("#submissionFields textarea").all()) {
    await ta.fill("Et tilstrekkelig langt fritekstsvar for vurdering.");
  }
  await page.locator("#ack").check();
  await page.locator('#aiDeclaration input[value="ideas"]').check();
  await page.locator("#createSubmission").click();

  // No nudge for non-autonomous declarations; it submits straight through.
  await expect(page.locator(".ai-nudge-overlay")).toHaveCount(0);
  await expect.poll(() => postedBody !== null).toBe(true);
  expect(postedBody).toMatchObject({ processSignals: { declaration: "ideas", insistedAfterPrompt: false } });
});
