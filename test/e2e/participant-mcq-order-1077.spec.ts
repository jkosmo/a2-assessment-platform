import { test, expect, type Page, type Route } from "@playwright/test";

// #1077 leveranse 2: «sett i riktig rekkefølge» hos deltakeren — den ekte participant.js i Chromium mot
// mockede API-er. Det som måles: elementene står som en nummerert liste med «Flytt opp» / «Flytt ned»
// (tastatur og skjermleser), en flytting beholder fokus på elementet, innsendingen sender hele
// rekkefølgen som `orderedAnswers`, og gjennomgangen viser deltakerens og den riktige rekkefølgen.

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
        { id: "m-mcq", title: "Rekkefølge 1077", description: null, assessmentMode: "MCQ_ONLY", submissionSchema: null, assessmentPolicy: { mcq: { reviewAfterSubmit: true } }, taskText: null, activeVersion: { versionNo: 1 }, participantStatus: null },
      ],
    })),
  );
  await page.route("**/api/submissions", (route: Route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) }));
  await page.route("**/api/modules/*/mcq/start**", (route: Route) =>
    route.fulfill(json({
      attemptId: "a1",
      questions: [
        { id: "q-order", questionType: "order", stem: "Sett stegene i rekkefølge.", options: ["Avgjøre", "Motta", "Arkivere", "Vurdere"] },
      ],
    })),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

const items = (page: Page) => page.locator("[data-order-list='q-order'] [data-order-item]").evaluateAll((lis) => lis.map((li) => (li as HTMLElement).dataset.orderItem));

async function open(page: Page) {
  await page.goto("/participant");
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "Rekkefølge 1077" }).click();
  await expect(page.locator("[data-order-list='q-order']")).toBeVisible();
}

test("elementene flyttes med knappene, fokus følger elementet, og hele rekkefølgen sendes", async ({ page }) => {
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

  const card = page.locator(".mcq-question-card", { hasText: "Sett stegene i rekkefølge." });
  await expect(card).toContainText("Sett elementene i riktig rekkefølge.");
  expect(await items(page)).toEqual(["Avgjøre", "Motta", "Arkivere", "Vurdere"]);
  // Første kan ikke flyttes opp, siste ikke ned.
  await expect(card.getByRole("button", { name: "Flytt opp: Avgjøre" })).toBeDisabled();
  await expect(card.getByRole("button", { name: "Flytt ned: Vurdere" })).toBeDisabled();

  // Med tastaturet: «Motta» opp — fokus står på samme knapp, så den kan trykkes på nytt.
  await card.getByRole("button", { name: "Flytt opp: Motta" }).focus();
  await page.keyboard.press("Enter");
  expect(await items(page)).toEqual(["Motta", "Avgjøre", "Arkivere", "Vurdere"]);
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Flytt ned: Motta");
  // «Vurdere» opp to ganger, «Arkivere» ned én: riktig rekkefølge.
  await card.getByRole("button", { name: "Flytt opp: Vurdere" }).click();
  await card.getByRole("button", { name: "Flytt opp: Vurdere" }).click();
  expect(await items(page)).toEqual(["Motta", "Vurdere", "Avgjøre", "Arkivere"]);
  await expect(card.locator(".mcq-order-position").first()).toHaveText("1.");

  await page.locator("#submitMcq").click();
  await expect.poll(() => submitted).not.toBeNull();
  expect(submitted!.responses).toEqual([{ questionId: "q-order", orderedAnswers: ["Motta", "Vurdere", "Avgjøre", "Arkivere"] }]);
});

test("knappene er store nok å treffe på telefon, og lista er innenfor skjermen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockBase(page);
  await open(page);
  const box = await page.locator(".mcq-order-move").first().boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("gjennomgangen viser deltakerens og den riktige rekkefølgen", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/modules/*/mcq/submit", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assessmentComplete: true }) }));
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ submissionId: "s1", status: "COMPLETED", decision: { passFailTotal: false, decisionType: "AUTOMATIC" }, scoreComponents: { totalScore: 0, mcqScaledScore: 0, mcqPercentScore: 0, practicalScaledScore: 0 }, participantGuidance: {} }) }));
  await page.route("**/api/submissions/*/mcq-review", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, questions: [
      { id: "q-order", questionType: "order", stem: "Sett stegene i rekkefølge.", options: ["Motta", "Vurdere", "Avgjøre", "Arkivere"], selectedAnswer: "Avgjøre → Motta → Arkivere → Vurdere", selectedOrder: ["Avgjøre", "Motta", "Arkivere", "Vurdere"], correctOrder: ["Motta", "Vurdere", "Avgjøre", "Arkivere"], correctAnswer: "Motta", isCorrect: false, rationale: "Motta først." },
    ] }) }));
  await open(page);
  await page.locator("#submitMcq").click();
  const wrong = page.locator(".mcq-review-item.is-wrong", { hasText: "Sett stegene i rekkefølge." });
  await expect(wrong).toContainText("Din rekkefølge: Avgjøre → Motta → Arkivere → Vurdere");
  await expect(wrong).toContainText("Riktig rekkefølge: Motta → Vurdere → Avgjøre → Arkivere");
});
