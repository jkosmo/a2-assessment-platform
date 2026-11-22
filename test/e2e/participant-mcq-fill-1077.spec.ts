import { test, expect, type Page, type Route } from "@playwright/test";

// #1077 leveranse 3: «fyll inn ordet som mangler» hos deltakeren — den ekte participant.js i Chromium mot
// mockede API-er. Det som måles: spørsmålet med lukka og ett tekstfelt (beskrevet av spørsmålet for
// skjermleseren), at det skrevne sendes som `textAnswer`, at et tomt felt stopper innsendingen med
// nummeret, at kladden tar vare på det skrevne, og at gjennomgangen viser de godkjente svarene.

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
        { id: "m-mcq", title: "Fyll inn 1077", description: null, assessmentMode: "MCQ_ONLY", submissionSchema: null, assessmentPolicy: { mcq: { reviewAfterSubmit: true } }, taskText: null, activeVersion: { versionNo: 1 }, participantStatus: null },
      ],
    })),
  );
  await page.route("**/api/submissions", (route: Route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) }));
  await page.route("**/api/modules/*/mcq/start**", (route: Route) =>
    route.fulfill(json({
      attemptId: "a1",
      questions: [
        // Tjeneren sender aldri alternativene for «fill» — de er de godkjente svarene.
        { id: "q-fill", questionType: "fill", stem: "Fristen for å klage er ___ uker.", options: [] },
        { id: "q-one", questionType: "single", stem: "Hvem skriver referatet?", options: ["Sekretæren", "Lederen"] },
      ],
    })),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

async function open(page: Page) {
  await page.goto("/participant");
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "Fyll inn 1077" }).click();
  await expect(page.locator("[data-fill-input='q-fill']")).toBeVisible();
}

test("et tekstfelt under spørsmålet; det skrevne sendes som textAnswer", async ({ page }) => {
  await mockBase(page);
  let submitted: { responses: Array<Record<string, unknown>> } | null = null;
  await page.route("**/api/modules/*/mcq/submit", (route: Route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assessmentComplete: true }) });
  });
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "COMPLETED", decision: { passFailTotal: true, decisionType: "AUTOMATIC" }, scoreComponents: { totalScore: 100, mcqScaledScore: 30, mcqPercentScore: 100, practicalScaledScore: 0 }, participantGuidance: {} }) }),
  );
  await open(page);

  const card = page.locator(".mcq-question-card", { hasText: "Fristen for å klage er ___ uker." });
  // Ingen valg å gjøre — bare feltet, med en forklarende ledetekst, og spørsmålet som beskrivelse.
  await expect(card.locator("input[type=radio], input[type=checkbox]")).toHaveCount(0);
  const field = page.getByRole("textbox", { name: "Skriv ordet som mangler" });
  await expect(field).toBeVisible();
  await expect(field).toHaveAccessibleDescription("Fristen for å klage er ___ uker.");
  expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await field.fill("tre");
  await page.locator(".mcq-question-card", { hasText: "Hvem skriver referatet?" }).getByText("Sekretæren").click();
  await page.locator("#submitMcq").click();
  await expect.poll(() => submitted).not.toBeNull();
  expect(submitted!.responses).toEqual([
    { questionId: "q-fill", textAnswer: "tre" },
    { questionId: "q-one", selectedAnswer: "Sekretæren" },
  ]);
});

test("et tomt felt stopper innsendingen og sier hvilket spørsmål", async ({ page }) => {
  await mockBase(page);
  let submitted = false;
  await page.route("**/api/modules/*/mcq/submit", (route: Route) => { submitted = true; return route.fulfill({ status: 200, body: "{}" }); });
  await open(page);
  await page.locator("[data-fill-input='q-fill']").fill("   ");
  await page.locator(".mcq-question-card", { hasText: "Hvem skriver referatet?" }).getByText("Sekretæren").click();
  await page.locator("#submitMcq").click();
  await expect(page.locator(".mcq-question-card--unanswered")).toHaveCount(1);
  await expect(page.locator(".mcq-question-card--unanswered")).toContainText("Fristen for å klage er ___ uker.");
  expect(submitted).toBe(false);
  // Å skrive fjerner markeringen med én gang.
  await page.locator("[data-fill-input='q-fill']").fill("tre");
  await expect(page.locator(".mcq-question-card--unanswered")).toHaveCount(0);
});

test("på telefon er feltet innenfor skjermen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockBase(page);
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("gjennomgangen viser det deltakeren skrev og de godkjente svarene", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/modules/*/mcq/submit", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assessmentComplete: true }) }));
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ submissionId: "s1", status: "COMPLETED", decision: { passFailTotal: false, decisionType: "AUTOMATIC" }, scoreComponents: { totalScore: 0, mcqScaledScore: 0, mcqPercentScore: 0, practicalScaledScore: 0 }, participantGuidance: {} }) }));
  await page.route("**/api/submissions/*/mcq-review", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, questions: [
      { id: "q-fill", questionType: "fill", stem: "Fristen for å klage er ___ uker.", options: [], acceptedAnswers: ["tre", "3"], selectedAnswer: "fire", correctAnswer: "tre", isCorrect: false, rationale: "Forskriften sier tre uker." },
    ] }) }));
  await open(page);
  await page.locator("[data-fill-input='q-fill']").fill("fire");
  await page.locator(".mcq-question-card", { hasText: "Hvem skriver referatet?" }).getByText("Sekretæren").click();
  await page.locator("#submitMcq").click();
  const wrong = page.locator(".mcq-review-item.is-wrong", { hasText: "Fristen for å klage er ___ uker." });
  await expect(wrong).toContainText("Ditt svar: fire");
  await expect(wrong).toContainText("Godkjente svar: tre · 3");
});
