import { test, expect, type Page, type Route } from "@playwright/test";

// #1077: «velg alle som stemmer» hos deltakeren — den ekte participant.js i Chromium mot mockede API-er.
// Det som måles, er det supertest ikke ser: at spørsmålet tegnes med avkrysning (ikke radio), at
// innsendingen sender `selectedAnswers` for det og `selectedAnswer` for et vanlig spørsmål ved siden
// av, at et ubesvart «velg alle» stoppes før innsending, og at gjennomgangen viser alle valgte og alle
// riktige.

async function mockBase(page: Page) {
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
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
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill(json({
      modules: [
        { id: "m-mcq", title: "Flervalg 1077", description: null, assessmentMode: "MCQ_ONLY", submissionSchema: null, assessmentPolicy: { mcq: { reviewAfterSubmit: true } }, taskText: null, activeVersion: { versionNo: 1 }, participantStatus: null },
      ],
    })),
  );
  await page.route("**/api/submissions", (route: Route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) }));
  await page.route("**/api/modules/*/mcq/start**", (route: Route) =>
    route.fulfill(json({
      attemptId: "a1",
      questions: [
        { id: "q-single", questionType: "single", stem: "Hvem bestemmer?", options: ["Den behandlingsansvarlige", "Databehandleren"] },
        { id: "q-multi", questionType: "multiple", stem: "Hva må protokollen inneholde?", options: ["Formål", "Farge", "Behandlingsgrunnlag", "Skrifttype"] },
      ],
    })),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

test("«velg alle som stemmer» tegnes med avkrysning og sendes som flere svar; et vanlig spørsmål som før", async ({ page }) => {
  await mockBase(page);
  let submitted: { responses: Array<Record<string, unknown>> } | null = null;
  await page.route("**/api/modules/*/mcq/submit", (route: Route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assessmentComplete: true }) });
  });
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "COMPLETED", decision: { passFailTotal: true, decisionType: "AUTOMATIC" }, scoreComponents: { totalScore: 100, mcqScaledScore: 30, mcqPercentScore: 100, practicalScaledScore: 0 }, participantGuidance: {} }) }),
  );

  await page.goto("/participant");
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "Flervalg 1077" }).click();

  // Typen bestemmer kontrollen: radio for det vanlige, avkrysning for «velg alle», og hintet bare der.
  await expect(page.locator("input[name='q_q-single']").first()).toHaveAttribute("type", "radio");
  await expect(page.locator("input[name='q_q-multi']")).toHaveCount(4);
  for (const input of await page.locator("input[name='q_q-multi']").all()) await expect(input).toHaveAttribute("type", "checkbox");
  const multiCard = page.locator(".mcq-question-card", { hasText: "Hva må protokollen inneholde?" });
  const singleCard = page.locator(".mcq-question-card", { hasText: "Hvem bestemmer?" });
  await expect(multiCard).toContainText("Velg alle som stemmer.");
  await expect(singleCard).not.toContainText("Velg alle som stemmer.");

  // Et «velg alle» uten valg er ubesvart — stoppes her, ikke av en Zod-dump fra tjeneren.
  await page.locator("input[name='q_q-single'][value='Den behandlingsansvarlige']").check();
  await page.locator("#submitMcq").click();
  await expect(multiCard).toHaveClass(/mcq-question-card--unanswered/);
  expect(submitted).toBeNull();

  // To avkrysninger — og avkrysning nummer to fjerner ikke den første (det ville en radio gjort).
  await multiCard.locator("input[value='Formål']").check();
  await multiCard.locator("input[value='Behandlingsgrunnlag']").check();
  await expect(multiCard.locator("input[value='Formål']")).toBeChecked();
  await page.locator("#submitMcq").click();

  await expect.poll(() => submitted).not.toBeNull();
  const responses = submitted!.responses;
  expect(responses).toContainEqual({ questionId: "q-single", selectedAnswer: "Den behandlingsansvarlige" });
  expect(responses).toContainEqual({ questionId: "q-multi", selectedAnswers: ["Formål", "Behandlingsgrunnlag"] });
});

test("gjennomgangen viser alle valgte og alle riktige i «velg alle som stemmer»", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/modules/*/mcq/submit", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assessmentComplete: true }) }),
  );
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ submissionId: "s1", status: "COMPLETED", decision: { passFailTotal: false, decisionType: "AUTOMATIC" }, scoreComponents: { totalScore: 50, mcqScaledScore: 15, mcqPercentScore: 50, practicalScaledScore: 0 }, participantGuidance: {} }) }),
  );
  await page.route("**/api/submissions/*/mcq-review", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        questions: [
          { id: "q-multi", questionType: "multiple", stem: "Hva må protokollen inneholde?", options: ["Formål", "Farge", "Behandlingsgrunnlag", "Skrifttype"], selectedAnswer: "Formål · Farge", selectedAnswers: ["Formål", "Farge"], correctAnswer: "Formål", correctAnswers: ["Formål", "Behandlingsgrunnlag"], isCorrect: false, rationale: "Art. 30." },
          { id: "q-single", questionType: "single", stem: "Hvem bestemmer?", options: ["Den behandlingsansvarlige", "Databehandleren"], selectedAnswer: "Den behandlingsansvarlige", correctAnswer: "Den behandlingsansvarlige", isCorrect: true, rationale: null },
        ],
      }),
    }),
  );

  await page.goto("/participant");
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "Flervalg 1077" }).click();
  await page.locator("input[name='q_q-single']").first().check();
  await page.locator("input[name='q_q-multi'][value='Formål']").check();
  await page.locator("#submitMcq").click();

  const wrong = page.locator(".mcq-review-item.is-wrong", { hasText: "Hva må protokollen inneholde?" });
  await expect(wrong).toContainText("Formål · Farge");
  await expect(wrong).toContainText("Formål · Behandlingsgrunnlag");
  // Kontroll: det vanlige spørsmålet vises som før.
  await expect(page.locator(".mcq-review-item.is-correct", { hasText: "Hvem bestemmer?" })).toContainText("Den behandlingsansvarlige");
});
