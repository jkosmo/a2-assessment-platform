import { test, expect, type Page, type Route } from "@playwright/test";

// #1124: deltakeren ser kriteriene med trinnene før levering, og poengene per kriterium etter
// vurderingen — kjørt gjennom den EKTE participant.js i Chromium, mot mockede API-er.
//
// Serveren har allerede holdt tilbake skjulte kriterier og regnet om skalaen (prøvd i
// test/unit/participant-criteria-1124.test.ts og gjennom rutene i test/participant-criteria-1124.test.ts).
// Her prøves det bare serveren ikke kan se: at klienten faktisk tegner feltene, og at det fungerer
// på en telefon.

const CRITERIA = [
  {
    id: "vedtak", label: "Vedtakene", scaleMax: 2, intro: null,
    steps: [
      { score: 0, text: "vedtakene mangler eller er feil" },
      { score: 1, text: "vedtakene står der, men blandet med diskusjonen" },
      { score: 2, text: "vedtakene står først, presist og hver for seg" },
    ],
  },
  {
    id: "oppfolging", label: "Oppfølgingen", scaleMax: 2, intro: null,
    steps: [
      { score: 0, text: "ingen oppfølgingspunkter" },
      { score: 1, text: "punktene står der, men uten ansvarlig eller frist" },
      { score: 2, text: "hvert punkt har ansvarlig og frist" },
    ],
  },
  {
    id: "kontroll", label: "Kontroll mot notatene", scaleMax: 2, intro: "Sammenlign med notatene dine",
    steps: [
      { score: 0, text: "feil fra utkastet står igjen" },
      { score: 1, text: "noen feil er rettet" },
      { score: 2, text: "alt stemmer med notatene; det som ikke er avklart, står som «uklart»" },
    ],
  },
];

function essayModule(assessmentCriteria: unknown) {
  return {
    id: "m-fto",
    title: "Essay Modul",
    description: null,
    assessmentMode: "FREETEXT_ONLY",
    submissionSchema: null,
    assessmentPolicy: null,
    taskText: "KI har laget et utkast til referat fra styremøtet. Skriv det ferdige referatet.",
    activeVersion: { versionNo: 1 },
    participantStatus: null,
    ...(assessmentCriteria === undefined ? {} : { assessmentCriteria }),
  };
}

const RESULT = {
  submissionId: "s1",
  status: "COMPLETED",
  assessmentMode: "FREETEXT_ONLY",
  decision: { passFailTotal: true, decisionType: "AUTOMATIC" },
  scoreComponents: { totalScore: 83, mcqScaledScore: null, mcqPercentScore: null, practicalScaledScore: 83 },
  requirement: { mcqMinPercent: null, totalMin: 60, practicalMinPercent: null },
  participantGuidance: {
    decisionReason: null, decisionReasonCode: null, decisionReasonParams: {}, confidenceNote: null,
    improvementAdvice: [],
    criterionRationales: {
      vedtak: "Vedtaket om budsjettet står først og for seg selv.",
      oppfolging: "Ola har oppgaven med frist 1. november.",
      kontroll: "Referatet sier fortsatt at Kari bestiller lokale — notatene sier at det ikke er avklart.",
      // Et kriterium serveren ikke sendte poeng for (skjult): begrunnelsen står i lista som før.
      eldre_kriterium: "Begrunnelse uten poeng.",
    },
    criterionScores: [
      { id: "vedtak", label: "Vedtakene", score: 2, maxScore: 2, topStep: null },
      { id: "oppfolging", label: "Oppfølgingen", score: 2, maxScore: 2, topStep: null },
      { id: "kontroll", label: "Kontroll mot notatene", score: 1, maxScore: 2, topStep: "alt stemmer med notatene; det som ikke er avklart, står som «uklart»" },
    ],
  },
};

async function mockBase(page: Page, module: unknown, result: unknown = RESULT) {
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
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: [module] }) }),
  );
  await page.route("**/api/submissions", (route: Route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) }),
  );
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
}

async function openModule(page: Page) {
  await page.goto("/participant");
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "Essay Modul" }).click();
  await expect(page.locator("#submissionFields textarea").first()).toBeVisible();
}

async function submitAndShowResult(page: Page) {
  for (const ta of await page.locator("#submissionFields textarea").all()) {
    await ta.fill("Et tilstrekkelig langt fritekstsvar for vurdering.");
  }
  await page.locator("#createSubmission").click();
  await expect(page.locator("#checkResult")).toBeVisible();
  await page.locator("#checkResult").click();
  await expect(page.locator("#resultSummary .result-headline")).toBeVisible();
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "siden skal ikke kunne rulles sideveis").toBeLessThanOrEqual(0);
}

test.describe("#1124 — før levering: «Slik vurderes svaret ditt»", () => {
  test("panelet står under oppgaven, åpent, med skala og trinn per kriterium — og kan foldes sammen", async ({ page }) => {
    await mockBase(page, essayModule(CRITERIA));
    await openModule(page);

    const panel = page.locator("#selectedModuleBrief details.criteria-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("open", "");
    await expect(panel.locator("summary")).toHaveText("Slik vurderes svaret ditt");

    const items = panel.locator(".criteria-item");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0).locator(".criteria-item-label")).toHaveText("Vedtakene");
    await expect(items.nth(0).locator(".criteria-item-scale")).toHaveText("0–2 poeng");
    await expect(items.nth(0).locator(".criteria-steps li")).toHaveText([
      "0 — vedtakene mangler eller er feil",
      "1 — vedtakene står der, men blandet med diskusjonen",
      "2 — vedtakene står først, presist og hver for seg",
    ]);
    await expect(items.nth(2).locator(".criteria-item-intro")).toHaveText("Sammenlign med notatene dine");

    // Trykkflaten er minst 44 px høy.
    const box = await panel.locator("summary").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await panel.locator("summary").click();
    await expect(panel).not.toHaveAttribute("open", "");
    await expect(items.first()).toBeHidden();
  });

  test("ingen kriterier å vise (eller en eldre server uten feltet): ingen panel", async ({ page }) => {
    await mockBase(page, essayModule([]));
    await openModule(page);
    // `toBeHidden` alene er blind her: en tom boks har null høyde og regnes som skjult — men den står
    // likevel i rutenettet og gir et ekstra mellomrom under oppgaven.
    await expect(page.locator("#selectedModuleCriteria")).toHaveJSProperty("hidden", true);
    await expect(page.locator("details.criteria-panel")).toHaveCount(0);
  });

  test("på 390 px: ingen sideveis rulling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockBase(page, essayModule(CRITERIA));
    await openModule(page);
    await expect(page.locator("details.criteria-panel")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe("#1124 — etter vurdering: poeng per kriterium", () => {
  test("«1 av 2» per kriterium med begrunnelsen, og «For 2 poeng: …» bare der deltakeren ikke fikk fullt", async ({ page }) => {
    await mockBase(page, essayModule(CRITERIA));
    await openModule(page);
    await submitAndShowResult(page);

    const scores = page.locator("#resultSummary .criterion-score");
    await expect(scores).toHaveCount(3);
    await expect(scores.nth(0).locator(".criteria-item-label")).toHaveText("Vedtakene");
    await expect(scores.nth(0).locator(".criterion-score-value")).toHaveText("2 av 2");
    await expect(scores.nth(0).locator(".criterion-score-rationale")).toHaveText("Vedtaket om budsjettet står først og for seg selv.");
    await expect(scores.nth(0).locator(".criterion-score-top")).toHaveCount(0);

    await expect(scores.nth(2)).toHaveClass(/is-short/);
    await expect(scores.nth(2).locator(".criterion-score-value")).toHaveText("1 av 2");
    await expect(scores.nth(2).locator(".criterion-score-top")).toHaveText(
      "For 2 poeng: alt stemmer med notatene; det som ikke er avklart, står som «uklart»",
    );

    // Begrunnelsene for kriteriene med poeng står ikke to ganger; den uten poeng står i lista som før.
    const rest = page.locator("#resultSummary .summary-list li", { hasText: "Begrunnelse uten poeng." });
    await expect(rest).toHaveCount(1);
    await expect(page.locator("#resultSummary .summary-list li", { hasText: "Vedtaket om budsjettet" })).toHaveCount(0);
  });

  test("en vurderer overstyrte: merknaden står over kortene; ellers står den ikke", async ({ page }) => {
    await mockBase(page, essayModule(CRITERIA), {
      ...RESULT,
      decision: { passFailTotal: false, decisionType: "MANUAL_OVERRIDE" },
      participantGuidance: { ...RESULT.participantGuidance, finalDecisionByAssessor: true },
    });
    await openModule(page);
    await submitAndShowResult(page);
    const note = page.locator("#resultSummary .criterion-score-note");
    await expect(note).toHaveText("Poengene er KI-ens; den endelige avgjørelsen er tatt av en vurderer.");
    // Over kortene, i samme kort som dem.
    const order = await page.locator("#resultSummary .criterion-score-note + .criterion-score-list").count();
    expect(order).toBe(1);
  });

  test("ingen overstyring: ingen merknad", async ({ page }) => {
    await mockBase(page, essayModule(CRITERIA), {
      ...RESULT,
      participantGuidance: { ...RESULT.participantGuidance, finalDecisionByAssessor: false },
    });
    await openModule(page);
    await submitAndShowResult(page);
    await expect(page.locator("#resultSummary .criterion-score").first()).toBeVisible();
    await expect(page.locator("#resultSummary .criterion-score-note")).toHaveCount(0);
  });

  test("en eldre server uten criterionScores: begrunnelsene som før", async ({ page }) => {
    const { criterionScores: _drop, ...guidance } = RESULT.participantGuidance;
    await mockBase(page, essayModule(CRITERIA), { ...RESULT, participantGuidance: guidance });
    await openModule(page);
    await submitAndShowResult(page);
    await expect(page.locator("#resultSummary .criterion-score")).toHaveCount(0);
    await expect(page.locator("#resultSummary .summary-list li", { hasText: "Vedtaket om budsjettet" })).toHaveCount(1);
  });

  test("på 390 px: ingen sideveis rulling i resultatet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockBase(page, essayModule(CRITERIA));
    await openModule(page);
    await submitAndShowResult(page);
    await expect(page.locator("#resultSummary .criterion-score").first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
