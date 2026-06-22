import { test, expect, type Page, type Route } from "@playwright/test";

// #525 participant UI: an MCQ-only module must skip the free-text submission step — no answer
// fields, no acknowledgement — while a normal free-text module still renders them. Runs the real
// participant.js in mock-auth mode against mocked APIs (client-layer behavior invisible to supertest).

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
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          { id: "m-mcq", title: "MCQ Modul", description: null, assessmentMode: "MCQ_ONLY", submissionSchema: null, assessmentPolicy: null, taskText: null, activeVersion: { versionNo: 1 }, participantStatus: null },
          { id: "m-ft", title: "Fritekst Modul", description: null, assessmentMode: "FREETEXT_PLUS_MCQ", submissionSchema: null, assessmentPolicy: null, taskText: "Skriv et svar", activeVersion: { versionNo: 1 }, participantStatus: null },
        ],
      }),
    }),
  );
}

test("participant: MCQ-only module hides the free-text step; free-text module keeps it", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  // #546: selecting an MCQ-only module auto-creates the (empty) submission + starts the MCQ — no
  // manual "create submission" click. Capture the auto-creation.
  let submissionCreated = false;
  await page.route("**/api/submissions", (route: Route) => {
    submissionCreated = true;
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) });
  });
  await page.route("**/api/modules/*/mcq/start**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ attemptId: "a1", questions: [] }) }),
  );

  await page.goto("/participant");
  await page.locator("#loadModules").click();

  // Select the MCQ-only module → no free-text textarea, the MCQ-only note is shown, ack hidden.
  await page.locator(".module-card", { hasText: "MCQ Modul" }).click();
  await expect(page.locator("#submissionFields textarea")).toHaveCount(0);
  await expect(page.locator("#submissionFields")).toContainText("flervalgsspørsmål");
  await expect(page.locator("#ack")).toBeHidden();
  // #525 follow-up: MCQ-only has no taskText, so the OPPGAVE/VEILEDNING brief must be hidden
  // (regression guard for the .module-brief display:grid vs .hidden cascade bug).
  await expect(page.locator("#selectedModuleBrief")).toBeHidden();
  // #546: submission auto-created on select (MCQ shown directly, no extra click).
  await expect.poll(() => submissionCreated).toBe(true);

  // Switch to the free-text module → the answer textarea + acknowledgement + brief come back.
  // (Selecting a module collapses the list, so re-expand it first.)
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "Fritekst Modul" }).click();
  await expect(page.locator("#submissionFields textarea")).not.toHaveCount(0);
  await expect(page.locator("#ack")).toBeVisible();
  await expect(page.locator("#selectedModuleBrief")).toBeVisible();
});

// Feedback (#549/#525): after an MCQ-only auto-pass the result is ready, so the retry button must
// be present (not "completely gone") and de-emphasised (discreet) rather than a prominent danger
// button. Regression guard for the resultStatus-never-synced bug.
test("participant: MCQ-only auto-pass shows a discreet retry button", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  await page.route("**/api/submissions", (route: Route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) }),
  );
  await page.route("**/api/modules/*/mcq/start**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ attemptId: "a1", questions: [{ id: "q1", stem: "Spørsmål 1", options: ["A", "B"] }] }),
    }),
  );
  await page.route("**/api/modules/*/mcq/submit", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assessmentComplete: true }) }),
  );
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "COMPLETED",
        decision: { passFailTotal: true, decisionType: "AUTOMATIC" },
        scoreComponents: { totalScore: 100, mcqScaledScore: 100, practicalScaledScore: 0 },
        participantGuidance: {},
      }),
    }),
  );

  await page.goto("/participant");
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "MCQ Modul" }).click();

  // Answer the question and submit the MCQ.
  await page.locator("input[name='q_q1']").first().check();
  await page.locator("#submitMcq").click();

  // The retry button is visible (result is ready) and discreet (passed) — not the prominent danger button.
  const retry = page.locator("#resetSubmissionFlow");
  await expect(retry).toBeVisible();
  await expect(retry).toHaveClass(/reset-flow-discreet/);

  // #591: MCQ-only result shows the MCQ score but NOT the (always-0) practical score row.
  const result = page.locator("#resultSummary");
  await expect(result).toContainText("MCQ-poeng");
  await expect(result).not.toContainText("Praktisk poeng");
});

// #578: FREETEXT_ONLY — the participant fills in free text (no MCQ section) and the assessment runs
// directly on the submission (no MCQ attempt is started; the server would 400 if one were).
test("participant: FREETEXT_ONLY module shows free-text, hides MCQ, assesses without MCQ", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  // Override the module list with a FREETEXT_ONLY module.
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          { id: "m-fto", title: "Essay Modul", description: null, assessmentMode: "FREETEXT_ONLY", submissionSchema: null, assessmentPolicy: null, taskText: "Skriv et essay", activeVersion: { versionNo: 1 }, participantStatus: null },
        ],
      }),
    }),
  );
  await page.route("**/api/submissions", (route: Route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) }),
  );
  let mcqStartCalled = false;
  await page.route("**/api/modules/*/mcq/start**", (route: Route) => {
    mcqStartCalled = true;
    return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "no_mcq" }) });
  });
  let runCalled = false;
  await page.route("**/api/assessments/*/run", (route: Route) => {
    runCalled = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "PROCESSING" }) }),
  );

  await page.goto("/participant");
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "Essay Modul" }).click();

  // Free-text fields + acknowledgement + task brief are shown; the MCQ section is hidden.
  await expect(page.locator("#submissionFields textarea").first()).toBeVisible();
  await expect(page.locator("#ack")).toBeVisible();
  await expect(page.locator("#selectedModuleBrief")).toBeVisible();
  await expect(page.locator("#mcqSection")).toBeHidden();

  // Fill the free-text answer(s) + acknowledge, then create the submission.
  for (const ta of await page.locator("#submissionFields textarea").all()) {
    await ta.fill("This is a sufficiently long free-text answer for assessment.");
  }
  await page.locator("#ack").check();
  await page.locator("#createSubmission").click();

  // The assessment runs directly; no MCQ attempt is ever started, and the MCQ section stays hidden.
  await expect.poll(() => runCalled).toBe(true);
  expect(mcqStartCalled).toBe(false);
  await expect(page.locator("#mcqSection")).toBeHidden();
});

// #591/#599 characterization: the FREETEXT_ONLY branch of renderResultSummary must show the
// practical score but HIDE the (always-0) MCQ score — the mirror of the MCQ-only case above. Made
// deterministic by disabling auto-assessment (config autoStartAfterMcq=false) so the "View result"
// button is enabled and we render a mocked COMPLETED result directly, instead of racing the poll.
test("participant: FREETEXT_ONLY result hides the MCQ score row, shows the practical score", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  // Override config: disable auto-assessment so #checkResult is clickable (not gated by the loop).
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
        flow: { autoStartAfterMcq: false },
        output: {},
      }),
    }),
  );
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          { id: "m-fto", title: "Essay Modul", description: null, assessmentMode: "FREETEXT_ONLY", submissionSchema: null, assessmentPolicy: null, taskText: "Skriv et essay", activeVersion: { versionNo: 1 }, participantStatus: null },
        ],
      }),
    }),
  );
  await page.route("**/api/submissions", (route: Route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) }),
  );
  // Completed result with a 0 MCQ component (as FREETEXT_ONLY always has).
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "COMPLETED",
        decision: { passFailTotal: true, decisionType: "AUTOMATIC" },
        scoreComponents: { totalScore: 85, mcqScaledScore: 0, practicalScaledScore: 85 },
        participantGuidance: {},
      }),
    }),
  );

  await page.goto("/participant");
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "Essay Modul" }).click();

  // Submit the free-text answer (no auto-assessment now), then view the result.
  for (const ta of await page.locator("#submissionFields textarea").all()) {
    await ta.fill("This is a sufficiently long free-text answer for assessment.");
  }
  await page.locator("#ack").check();
  await page.locator("#createSubmission").click();
  await page.locator("#checkResult").click();

  // The practical score row is shown; the (always-0) MCQ score row is hidden.
  const result = page.locator("#resultSummary");
  await expect(result).toContainText("Praktisk poeng");
  await expect(result).not.toContainText("MCQ-poeng");
});

// #591/#599 characterization: the default FREETEXT_PLUS_MCQ journey shows BOTH score rows — the
// third branch of renderResultSummary (neither freetext-only nor mcq-only). Completes the triad
// (MCQ_ONLY hides practical; FREETEXT_ONLY hides mcq; FREETEXT_PLUS_MCQ shows both). Deterministic
// via the MCQ-submit → already-assessed → fetch-result path (no auto-poll race).
test("participant: FREETEXT_PLUS_MCQ result shows both the MCQ and practical score rows", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  await page.route("**/api/submissions", (route: Route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) }),
  );
  await page.route("**/api/modules/*/mcq/start**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ attemptId: "a1", questions: [{ id: "q1", stem: "Spørsmål 1", options: ["A", "B"] }] }),
    }),
  );
  await page.route("**/api/modules/*/mcq/submit", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assessmentComplete: true }) }),
  );
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "COMPLETED",
        decision: { passFailTotal: true, decisionType: "AUTOMATIC" },
        scoreComponents: { totalScore: 88, mcqScaledScore: 90, practicalScaledScore: 86 },
        participantGuidance: {},
      }),
    }),
  );

  await page.goto("/participant");
  await page.locator("#loadModules").click();
  // m-ft is FREETEXT_PLUS_MCQ with task text → free-text fields are shown.
  await page.locator(".module-card", { hasText: "Fritekst Modul" }).click();

  for (const ta of await page.locator("#submissionFields textarea").all()) {
    await ta.fill("Et tilstrekkelig langt fritekstsvar for vurdering.");
  }
  await page.locator("#ack").check();
  await page.locator("#createSubmission").click();

  // MCQ auto-started after the submission; answer it and submit.
  await page.locator("input[name='q_q1']").first().check();
  await page.locator("#submitMcq").click();

  // Both score rows are shown for the combined free-text + MCQ mode.
  const result = page.locator("#resultSummary");
  await expect(result).toContainText("MCQ-poeng");
  await expect(result).toContainText("Praktisk poeng");
});
