import { test, expect, type Page, type Route } from "@playwright/test";

// #1124 del 2: eksempelsvaret etter fritekstvurderingen, ved siden av deltakerens eget svar — kjørt
// gjennom den EKTE participant.js i Chromium, mot mockede API-er. Hjelperne er de samme som i
// participant-criteria-1124.spec.ts.
//
// Serveren avgjør om eksempelsvaret skal ut (test/model-answer-1124.test.ts). Her prøves bare det
// serveren ikke kan se: plasseringen i prototypen — på mobil etter kriteriene med eget svar sammenfoldet,
// på bred skjerm side om side over kriteriene — og at et avslått eller feilet kall ikke viser noe.

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

const MODEL = {
  enabled: true,
  modelAnswer: "Vedtak: Budsjettet ble godkjent.\nOppfølging: Ola sender budsjettet til revisor innen 1. november.",
  ownAnswer: ["Vedtak: Budsjettet ble godkjent. Kari bestiller lokale."],
};

async function mockModelAnswer(page: Page, body: unknown) {
  await page.route("**/api/submissions/*/model-answer", (route: Route) =>
    body === "fail"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "x" }) })
      : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

const card = (page: Page) => page.locator("#resultSummary .model-answer-card");

test.describe("#1124 del 2 — eksempelsvaret etter vurderingen", () => {
  test("mobil: etter kriteriene, eksempelsvaret først og eget svar sammenfoldet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await mockBase(page, essayModule(CRITERIA));
    await mockModelAnswer(page, MODEL);
    await openModule(page);
    await submitAndShowResult(page);

    await expect(card(page)).toBeVisible();
    await expect(card(page).locator(".summary-card-title")).toHaveText("Sammenlign med et sterkt svar");
    // Etter kortet med poengene per kriterium.
    const order = await page.locator("#resultSummary > .summary-card").evaluateAll((cards) =>
      cards.map((c) => (c.classList.contains("model-answer-card") ? "eksempel" : c.getAttribute("data-card") ?? "annet")));
    expect(order.indexOf("eksempel")).toBeGreaterThan(order.indexOf("criteria"));

    const example = card(page).locator(".model-answer-example");
    await expect(example.locator(".model-answer-head")).toHaveText("Eksempelsvar");
    await expect(example.locator(".model-answer-text")).toHaveText(MODEL.modelAnswer);
    await expect(example.locator(".model-answer-note")).toHaveText("Ett av flere gode svar. Det vises etter at ditt svar er vurdert.");
    // Eksempelsvaret står over eget svar, og eget svar er foldet sammen.
    const yours = card(page).locator("details.model-answer-own");
    await expect(yours).not.toHaveAttribute("open", "");
    const exampleBox = await example.boundingBox();
    const yoursBox = await yours.boundingBox();
    expect((exampleBox?.y ?? 0)).toBeLessThan(yoursBox?.y ?? 0);
    expect((await yours.locator("summary").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    if (process.env.SKJERMBILDE_DIR) await card(page).screenshot({ path: `${process.env.SKJERMBILDE_DIR}/eksempelsvar-390-lukket.png` });
    await yours.locator("summary").click();
    await expect(yours.locator(".model-answer-text")).toHaveText(MODEL.ownAnswer[0]);
    await expectNoHorizontalScroll(page);
    if (process.env.SKJERMBILDE_DIR) await card(page).screenshot({ path: `${process.env.SKJERMBILDE_DIR}/eksempelsvar-390.png` });
  });

  test("bred skjerm: eget svar og eksempelsvar side om side, over kriteriene", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await mockBase(page, essayModule(CRITERIA));
    await mockModelAnswer(page, MODEL);
    await openModule(page);
    await submitAndShowResult(page);

    await expect(card(page).locator(".summary-card-title")).toHaveText("Ditt svar ved siden av et sterkt svar");
    const order = await page.locator("#resultSummary > .summary-card").evaluateAll((cards) =>
      cards.map((c) => (c.classList.contains("model-answer-card") ? "eksempel" : c.getAttribute("data-card") ?? "annet")));
    expect(order.indexOf("eksempel")).toBeLessThan(order.indexOf("criteria"));

    const yours = card(page).locator("details.model-answer-own");
    await expect(yours).toHaveAttribute("open", "");
    const yoursBox = await yours.boundingBox();
    const exampleBox = await card(page).locator(".model-answer-example").boundingBox();
    // Side om side: eget svar til venstre, på samme høyde.
    expect(yoursBox && exampleBox).toBeTruthy();
    expect(yoursBox!.x).toBeLessThan(exampleBox!.x);
    expect(Math.abs(yoursBox!.y - exampleBox!.y)).toBeLessThan(4);
    if (process.env.SKJERMBILDE_DIR) await card(page).screenshot({ path: `${process.env.SKJERMBILDE_DIR}/eksempelsvar-1280.png` });
  });

  test("slått av: ingen eksempelsvar, resten av resultatet står", async ({ page }) => {
    await mockBase(page, essayModule(CRITERIA));
    await mockModelAnswer(page, { enabled: false, modelAnswer: null, ownAnswer: [] });
    await openModule(page);
    await submitAndShowResult(page);
    await expect(page.locator('#resultSummary [data-card="criteria"]')).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });

  test("kallet feiler: ingen eksempelsvar, og resultatet står", async ({ page }) => {
    await mockBase(page, essayModule(CRITERIA));
    await mockModelAnswer(page, "fail");
    await openModule(page);
    await submitAndShowResult(page);
    await expect(page.locator('#resultSummary [data-card="criteria"]')).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });
});
