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
  // responsibility is confirmed by default (a hidden input inside its tile)
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
  // responsibility is confirmed by default (a hidden input inside its tile)
  await expect(page.locator("#createSubmission")).toBeDisabled();

  // Choose "AI wrote most of it" tile → button enables.
  await page.locator('.ai-declaration-opt[data-v="autonomous"]').click();
  await expect(page.locator("#createSubmission")).toBeEnabled();

  // 2.134.1: siden sier hva valget gjør FØR deltakeren leverer. En deltaker følte seg lurt av «Påvirker ikke karakteren».
  await expect(page.locator("#aiDeclaration")).toContainText("Påvirker ikke poengene dine");
  await expect(page.locator("#aiDeclarationReviewNotice")).toBeVisible();
  await expect(page.locator('.ai-declaration-opt[data-v="autonomous"]')).toContainText("En sensor leser da besvarelsen");

  // Submitting shows the reflective nudge; choosing "go back" cancels — nothing is submitted.
  await page.locator("#createSubmission").click();
  const nudge = page.locator(".ai-nudge-overlay");
  await expect(nudge).toBeVisible();
  await expect(nudge).toContainText("leser en sensor besvarelsen før du får resultatet");
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

for (const [navn, aiInfluence, policy] of [
  ["skyggemodus globalt", { enabled: true, shadowMode: true }, null],
  ["modulen er i skyggemodus, selv om regelen er aktiv globalt", { enabled: true, shadowMode: false }, { aiInfluence: { shadowMode: true } }],
] as const) {
  test(`2.134.1, ${navn}: ingen rutes til sensor, så valget lover det ikke`, async ({ page }) => {
    await mockBase(page, aiInfluence);
    await page.route("**/api/modules**", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: [{ ...ESSAY_MODULE, assessmentPolicy: policy }] }) }),
    );
    await page.addInitScript(() => {
      try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
    });
    await selectEssayModule(page);
    await expect(page.locator("#aiDeclaration")).toBeVisible();
    await expect(page.locator("#aiDeclaration")).toContainText("Påvirker ikke poengene dine");
    await expect(page.locator("#aiDeclarationReviewNotice")).toBeHidden();
  });
}

for (const [navn, aiInfluence, policy, synlig] of [
  ["modulen har slått regelen av", { enabled: true, shadowMode: false }, { aiInfluence: { enabled: false } }, false],
  ["regelen er av globalt, men modulen har slått den på", { enabled: false, shadowMode: false }, { aiInfluence: { enabled: true } }, true],
] as const) {
  test(`2.136.0, ${navn}: spørsmålet følger modulens innstilling, som på serveren`, async ({ page }) => {
    await mockBase(page, aiInfluence);
    await page.route("**/api/modules**", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: [{ ...ESSAY_MODULE, assessmentPolicy: policy }] }) }),
    );
    await page.addInitScript(() => {
      try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
    });
    await selectEssayModule(page);
    if (synlig) {
      await expect(page.locator("#aiDeclaration")).toBeVisible();
      await expect(page.locator("#aiDeclarationReviewNotice")).toBeVisible();
    } else {
      await expect(page.locator("#aiDeclaration")).toBeHidden();
    }
  });
}

test("2.136.1: svaret om KI følger ikke med til neste modul, og leveringen er sperret til deltakeren har svart der", async ({ page }) => {
  await mockBase(page, { enabled: true, shadowMode: false });
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: [ESSAY_MODULE, { ...ESSAY_MODULE, id: "m-annen", title: "Annen Modul" }] }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
  await selectEssayModule(page);
  await page.locator('.ai-declaration-opt[data-v="autonomous"]').click();
  await expect(page.locator('input[name="aiDeclaration"]:checked')).toHaveCount(1);

  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "Annen Modul" }).click();
  await expect(page.locator("#aiDeclaration")).toBeVisible();
  await expect(page.locator('input[name="aiDeclaration"]:checked')).toHaveCount(0);
  await expect(page.locator(".ai-declaration-opt.sel")).toHaveCount(0);
  for (const ta of await page.locator("#submissionFields textarea").all()) {
    await ta.fill("Et tilstrekkelig langt fritekstsvar for vurdering.");
  }
  await expect(page.locator("#createSubmission")).toBeDisabled();
});

async function byttModul(page: Page, tittel: string) {
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: tittel }).click();
  await expect(page.locator("#submissionFields textarea").first()).toBeVisible();
}

const ANNEN_MODUL = { ...ESSAY_MODULE, id: "m-annen", title: "Annen Modul" };

async function toModuler(page: Page) {
  await mockBase(page, { enabled: true, shadowMode: false });
  const moduler = { første: ESSAY_MODULE as typeof ESSAY_MODULE | Record<string, unknown> };
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: [moduler.første, ANNEN_MODUL] }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
  await selectEssayModule(page);
  await page.locator('.ai-declaration-opt[data-v="autonomous"]').click();
  await page.locator("#aiDeclarationText").fill("Jeg brukte KI til utkastet.");
  return moduler;
}

test("2.136.1: svaret og forklaringen står der når deltakeren kommer tilbake, også etter omlasting", async ({ page }) => {
  await toModuler(page);
  // Samme modul åpnet på nytt før levering: ingenting forsvinner.
  await byttModul(page, "Essay Modul");
  await expect(page.locator('input[name="aiDeclaration"]:checked')).toHaveValue("autonomous");
  await expect(page.locator("#aiDeclarationText")).toHaveValue("Jeg brukte KI til utkastet.");
  await byttModul(page, "Annen Modul");
  await expect(page.locator('input[name="aiDeclaration"]:checked')).toHaveCount(0);
  await expect(page.locator("#aiDeclarationText")).toHaveValue("");

  await byttModul(page, "Essay Modul");
  await expect(page.locator('input[name="aiDeclaration"]:checked')).toHaveValue("autonomous");
  await expect(page.locator('.ai-declaration-opt[data-v="autonomous"]')).toHaveClass(/sel/);
  await expect(page.locator("#aiDeclarationText")).toHaveValue("Jeg brukte KI til utkastet.");
  await expect(page.locator("#aiDeclarationText")).toBeVisible();

  // Valg og tekst lagres mens deltakeren svarer, ikke bare ved bytte og `beforeunload`, som ikke kjører når en mobilfane blir drept.
  const lagret = () => page.evaluate(() => Object.values({ ...localStorage }).join(" "));
  await page.locator('.ai-declaration-opt[data-v="ideas"]').click();
  await expect.poll(lagret).toContain('"value":"ideas"');
  await page.locator("#aiDeclarationText").fill("Bare ideer.");
  await expect.poll(lagret).toContain("Bare ideer.");
  await selectEssayModule(page);
  await expect(page.locator('input[name="aiDeclaration"]:checked')).toHaveValue("ideas");
  await expect(page.locator("#aiDeclarationText")).toHaveValue("Bare ideer.");
});

test("2.136.1: er spørsmålet slått av i modulen siden, kommer ikke svaret tilbake", async ({ page }) => {
  const moduler = await toModuler(page);
  await byttModul(page, "Annen Modul");
  moduler.første = { ...ESSAY_MODULE, assessmentPolicy: { aiInfluence: { enabled: false } } };
  await byttModul(page, "Essay Modul");
  await expect(page.locator("#aiDeclaration")).toBeHidden();
  await expect(page.locator('input[name="aiDeclaration"]:checked')).toHaveCount(0);
});

test("2.136.1: et levert svar kommer ikke tilbake som svar på neste forsøk", async ({ page }) => {
  await toModuler(page);
  await page.route("**/api/submissions", (route: Route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) }),
  );
  for (const ta of await page.locator("#submissionFields textarea").all()) {
    await ta.fill("Et tilstrekkelig langt fritekstsvar for vurdering.");
  }
  await page.locator("#createSubmission").click();
  await page.locator('.ai-nudge-overlay [data-nudge="insist"]').click();
  await expect(page.locator("#submissionId")).toHaveText("s1");
  // Samme modul åpnet på nytt, slik et nytt forsøk fra kurset gjør.
  await byttModul(page, "Essay Modul");
  await expect(page.locator('input[name="aiDeclaration"]:checked')).toHaveCount(0);
  await expect(page.locator("#aiDeclarationText")).toHaveValue("");
  await byttModul(page, "Annen Modul");
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "Essay Modul" }).click();
  await page.waitForTimeout(300);
  await expect(page.locator('input[name="aiDeclaration"]:checked')).toHaveCount(0);
});

test("2.136.1: «start på nytt» tømmer svaret om KI sammen med resten av kladden", async ({ page }) => {
  await toModuler(page);
  await page.route("**/api/submissions", (route: Route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) }),
  );
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        submissionId: "s1",
        status: "COMPLETED",
        decision: { passFailTotal: false, decisionType: "AUTOMATIC" },
        scoreComponents: { totalScore: 20, practicalScaledScore: 20 },
        participantGuidance: {},
      }),
    }),
  );
  for (const ta of await page.locator("#submissionFields textarea").all()) {
    await ta.fill("Et tilstrekkelig langt fritekstsvar for vurdering.");
  }
  await page.locator("#createSubmission").click();
  await page.locator('.ai-nudge-overlay [data-nudge="insist"]').click();
  await expect(async () => {
    for (const knapp of [page.locator("#queueAssessment"), page.locator("#checkResult")]) {
      if ((await knapp.isVisible()) && (await knapp.isEnabled())) await knapp.click();
    }
    await expect(page.locator("#resetSubmissionFlow")).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await page.locator("#resetSubmissionFlow").click();
  await expect(page.locator('input[name="aiDeclaration"]:checked')).toHaveCount(0);
  await expect(page.locator("#aiDeclarationText")).toHaveValue("");
});

test("2.134.1, modulen er i skyggemodus: ingen dialog, og ingen rutes", async ({ page }) => {
  await mockBase(page, { enabled: true, shadowMode: false });
  let posted: Record<string, unknown> | null = null;
  await page.route("**/api/submissions", (route: Route) => {
    posted = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) });
  });
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: [{ ...ESSAY_MODULE, assessmentPolicy: { aiInfluence: { shadowMode: true } } }] }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
  await selectEssayModule(page);
  for (const ta of await page.locator("#submissionFields textarea").all()) {
    await ta.fill("Et tilstrekkelig langt fritekstsvar for vurdering.");
  }
  await page.locator('.ai-declaration-opt[data-v="autonomous"]').click();
  await page.locator("#createSubmission").click();
  await expect.poll(() => posted !== null).toBe(true);
  await expect(page.locator(".ai-nudge-overlay")).toHaveCount(0);
  expect(posted).toMatchObject({ processSignals: { declaration: "autonomous", insistedAfterPrompt: false } });
});

test("2.134.1, skyggemodus globalt, men modulen har regelen aktiv: valget og dialogen sier det, og rutingen følger", async ({ page }) => {
  await mockBase(page, { enabled: true, shadowMode: true });
  let posted: Record<string, unknown> | null = null;
  await page.route("**/api/submissions", (route: Route) => {
    posted = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id: "s1" } }) });
  });
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: [{ ...ESSAY_MODULE, assessmentPolicy: { aiInfluence: { shadowMode: false } } }] }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
  await selectEssayModule(page);
  await expect(page.locator("#aiDeclarationReviewNotice")).toBeVisible();
  for (const ta of await page.locator("#submissionFields textarea").all()) {
    await ta.fill("Et tilstrekkelig langt fritekstsvar for vurdering.");
  }
  await page.locator('.ai-declaration-opt[data-v="autonomous"]').click();
  await page.locator("#createSubmission").click();
  const nudge = page.locator(".ai-nudge-overlay");
  await expect(nudge).toContainText("leser en sensor besvarelsen før du får resultatet");
  await nudge.locator('[data-nudge="insist"]').click();
  await expect.poll(() => posted !== null).toBe(true);
  expect(posted).toMatchObject({ processSignals: { declaration: "autonomous", insistedAfterPrompt: true } });
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
  // responsibility is confirmed by default (a hidden input inside its tile)
  await page.locator('.ai-declaration-opt[data-v="ideas"]').click();
  await page.locator("#createSubmission").click();

  // No nudge for non-autonomous declarations; it submits straight through.
  await expect(page.locator(".ai-nudge-overlay")).toHaveCount(0);
  await expect.poll(() => postedBody !== null).toBe(true);
  expect(postedBody).toMatchObject({ processSignals: { declaration: "ideas", insistedAfterPrompt: false } });
});
