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

  // #591: en ren flervalgsmodul viser IKKE den (alltid 0) praktiske poengsummen.
  //
  // ⚠️ #940 flyttet poengsummen fra en rad til overskrifta, så invarianten prøves der den nå står.
  // Blokkeringen har en makker: uten «Bestått»-påstanden ville «ingen praktisk poengsum» vært sann
  // også for et kort som aldri ble rendret.
  const result = page.locator("#resultSummary");
  await expect(result.locator(".result-headline")).toContainText("Bestått");
  await expect(result).not.toContainText("Praktisk");
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

  // #940: for en fritekstmodul ER den praktiske poengsummen totalen, og den står i overskrifta.
  // Å vise den to ganger — som total OG som delpoeng — er nøyaktig gjentakelsen saken fjernet.
  //
  // ⚠️ Påstanden er på TALLET, ikke på at overskrifta finnes. En `toBeVisible` ville vært grønn
  // for et kort som viste hva som helst.
  const result = page.locator("#resultSummary");
  await expect(result.locator(".result-headline")).toContainText("85");
  // Den (alltid 0) flervalgsdelen finnes ikke for denne modultypen, verken som rad eller delpoeng.
  await expect(result).not.toContainText("Flervalg");
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

  // #940: en blandet modul har EKTE delpoeng, og de blir stående — nå på underlinja under
  // totalen, ikke som to egne rader. Påstanden er på underlinja, ikke på kortet som helhet: en
  // treffordet-hvor-som-helst-sjekk ville også vært grønn om de sto som rader igjen.
  const result = page.locator("#resultSummary");
  const subline = result.locator(".result-subline");
  await expect(subline).toContainText("Flervalg");
  await expect(subline).toContainText("Praktisk");
});

// #988 — en kandidat som glemte ett spørsmål fikk `{"code":"too_small","path":["responses",3]}`.
//
// Sjekken FANTES allerede, men bare i forhåndsvisningsmodus (`previewModeEnabled`): en forfatter som
// testet modulen fikk en vennlig melding, mens en ekte kandidat fikk rå Zod. Plattformen visste at
// kontrollen trengtes og la den på feil sti.

async function startTwoQuestionMcq(page: Page) {
  await page.route("**/api/submissions", (route: Route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) }),
  );
  await page.route("**/api/modules/*/mcq/start**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        attemptId: "a1",
        questions: [
          { id: "q1", stem: "Spørsmål 1", options: ["A", "B"] },
          { id: "q2", stem: "Spørsmål 2", options: ["A", "B"] },
        ],
      }),
    }),
  );
  await page.goto("/participant");
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "MCQ Modul" }).click();
}

test("#988: ubesvart spørsmål stoppes lokalt, navngis, og markeres", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  let submitCalled = false;
  await page.route("**/api/modules/*/mcq/submit", (route: Route) => {
    submitCalled = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assessmentComplete: true }) });
  });

  await startTwoQuestionMcq(page);

  // Svar bare på det FØRSTE, og lever inn.
  await page.locator("input[name='q_q1']").first().check();
  await page.locator("#submitMcq").click();

  // ⚠️ Kjernen: ingen nettverksrundtur. Serveren skal aldri se en ufullstendig besvarelse, og
  // deltakeren skal ikke vente på et svar for å få vite noe klienten allerede visste.
  await expect.poll(() => submitCalled).toBe(false);

  // Meldingen navngir spørsmålet. «Fyll ut alle feltene» hjelper ikke i en liste på tjue.
  await expect(page.locator("#outputStatus")).toContainText("Spørsmål 2");
  await expect(page.locator("#outputStatus")).not.toContainText("too_small");

  // Og kortet er markert, så deltakeren ser HVOR det er.
  const cards = page.locator(".mcq-question-card");
  await expect(cards.nth(1)).toHaveClass(/mcq-question-card--unanswered/);
  // Kontrollcase: det besvarte skal IKKE markeres. Uten dette ville «marker alle» bestått.
  await expect(cards.nth(0)).not.toHaveClass(/mcq-question-card--unanswered/);
});

test("#988: markeringen forsvinner idet spørsmålet besvares", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
  await page.route("**/api/modules/*/mcq/submit", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assessmentComplete: true }) }),
  );

  await startTwoQuestionMcq(page);
  await page.locator("input[name='q_q1']").first().check();
  await page.locator("#submitMcq").click();

  const second = page.locator(".mcq-question-card").nth(1);
  await expect(second).toHaveClass(/mcq-question-card--unanswered/);

  // Uten dette ville kortet blitt stående rødt til neste innsending, og deltakeren ville lett etter
  // en feil som allerede var rettet.
  await page.locator("input[name='q_q2']").first().check();
  await expect(second).not.toHaveClass(/mcq-question-card--unanswered/);
});

test("#988: en servervalideringsfeil vises som en setning, ikke som Zod-utdata", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  // Serveren avviser likevel — f.eks. fordi forsøket er utløpt. Deltakeren skal ikke se maskineriet.
  await page.route("**/api/modules/*/mcq/submit", (route: Route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "validation_error",
        issues: [{ code: "too_small", minimum: 1, path: ["responses", 1, "selectedAnswer"] }],
      }),
    }),
  );

  await startTwoQuestionMcq(page);
  await page.locator("input[name='q_q1']").first().check();
  await page.locator("input[name='q_q2']").first().check();
  await page.locator("#submitMcq").click();

  const status = page.locator("#outputStatus");
  await expect(status).toContainText(/skjemaet/i);
  // ⚠️ Ingenting av maskineriet skal nå deltakeren. Dette er #972-klassen på den flaten der den er
  // verst: en kandidat midt i en test kan ikke tyde en Zod-sti.
  await expect(status).not.toContainText("too_small");
  await expect(status).not.toContainText("responses");
  await expect(status).not.toContainText("400:");
});
