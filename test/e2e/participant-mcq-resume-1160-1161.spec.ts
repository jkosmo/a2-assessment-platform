import { test, expect, type Page, type Route } from "@playwright/test";

// #1160 — en påbegynt flervalgstest mister ikke avkrysningene ved oppfriskning eller pause.
// #1161 — ingen tekniske meldinger i modulen: ingen «Opprett innlevering: <id>» når den åpnes, ingen engelsk «Request
//         completed.» etter levering, og ingen «Forsøks-ID: <id>» under «Send test».
//
// Kjører den ekte participant.js mot falske API-er. Serveren gir det ÅPNE forsøket tilbake fra `mcq/start` (idempotent), så
// falsken gjør det samme: samme innlevering gir samme forsøk.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const DRAFT_KEY = "participant.moduleDrafts.v1";

// Spørsmålene på det språket forespørselen ber om (`x-locale`), slik tjeneren lokaliserer dem. q3 er «sett i rekkefølge».
const QUESTIONS_BY_LOCALE: Record<string, Array<Record<string, unknown>>> = {
  nb: [
    { id: "q1", stem: "Spørsmål én", options: ["Alfa", "Beta", "Gamma"] },
    { id: "q2", stem: "Spørsmål to", options: ["Rød", "Grønn"] },
    { id: "q3", stem: "Sett i rekkefølge", questionType: "order", options: ["Først", "Så", "Til slutt"] },
  ],
  "en-GB": [
    { id: "q1", stem: "Question one", options: ["Alpha", "Bravo", "Charlie"] },
    { id: "q2", stem: "Question two", options: ["Red", "Green"] },
    { id: "q3", stem: "Put in order", questionType: "order", options: ["First", "Then", "Finally"] },
  ],
};

type State = {
  versionId: string;
  submissions: Array<Record<string, unknown>>;
  starts: string[];
  mcqSubmits: number;
  /** Innleveringer serveren ikke lenger gir et åpent forsøk på (levert og vurdert). */
  closed: Set<string>;
  /** Språket hvert `mcq/start` ba om. */
  startLocales: string[];
  /** De neste kallene på `mcq/start` feiler forbigående: «503» eller «abort» (nettverksbrudd). */
  transient: Array<"503" | "abort">;
};

async function mock(page: Page, state: State) {
  // Bare første gang: en test som bytter språk, skal ha det nye språket etter en oppfriskning.
  await page.addInitScript(() => {
    try { if (!localStorage.getItem("participant.locale")) localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ }
  });
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
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill(json({ courses: [{ id: "c1", title: "Kurset", description: null, moduleCount: 1, progress: { completed: 0, total: 1, moduleCompleted: 0, moduleTotal: 1, sectionCompleted: 0, sectionTotal: 0, courseStatus: "IN_PROGRESS" } }] })),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/enrollments", (route: Route) => route.fulfill(json({ enrollments: [] })));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill(json({
      course: {
        id: "c1",
        title: "Kurset",
        discussionsEnabled: false,
        modules: [],
        items: [{ type: "MODULE", moduleId: "m1", courseItemId: "i1", title: "Flervalget", moduleStatus: "IN_PROGRESS", available: true, required: true }],
      },
    })),
  );
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill(json({
      modules: [{
        id: "m1",
        title: "Flervalget",
        description: null,
        assessmentMode: "MCQ_ONLY",
        submissionSchema: null,
        assessmentPolicy: null,
        taskText: null,
        activeVersion: { id: state.versionId, versionNo: 1 },
        participantStatus: null,
      }],
    })),
  );
  await page.route("**/api/submissions", (route: Route) => {
    state.submissions.push(route.request().postDataJSON());
    return route.fulfill(json({ submission: { id: `s-${state.submissions.length}`, submissionStatus: "SUBMITTED" } }, 201));
  });
  await page.route("**/api/modules/m1/mcq/start**", (route: Route) => {
    const submissionId = new URL(route.request().url()).searchParams.get("submissionId") ?? "";
    state.starts.push(submissionId);
    const locale = route.request().headers()["x-locale"] === "en-GB" ? "en-GB" : "nb";
    state.startLocales.push(locale);
    const failure = state.transient.shift();
    if (failure === "abort") return route.abort("failed");
    if (failure === "503") return route.fulfill(json({ error: "service_unavailable", message: "Service unavailable." }, 503));
    // Det endelige avslaget slik tjeneren gir det (mcqService.startMcqAttempt): 409 med egen kode.
    if (state.closed.has(submissionId)) {
      return route.fulfill(json({ error: "mcq_attempt_closed", message: "MCQ attempt cannot be started: assessment is already completed or under review." }, 409));
    }
    return route.fulfill(json({ attemptId: `a-${submissionId}`, questions: QUESTIONS_BY_LOCALE[locale] }));
  });
  await page.route("**/api/modules/m1/mcq/submit", (route: Route) => {
    state.mcqSubmits += 1;
    state.closed.add(String(route.request().postDataJSON()?.submissionId));
    return route.fulfill(json({ assessmentComplete: true }));
  });
  await page.route("**/api/submissions/*/result", (route: Route) =>
    route.fulfill(json({ status: "COMPLETED", decision: { passFailTotal: true, decisionType: "AUTOMATIC" }, scoreComponents: { totalScore: 100, mcqScaledScore: 100, practicalScaledScore: 0 }, participantGuidance: {} })),
  );
  await page.route("**/api/submissions/*/mcq-review", (route: Route) => route.fulfill(json({ enabled: false, questions: [] })));
}

const newState = (versionId = "mv-1"): State => ({ versionId, submissions: [], starts: [], mcqSubmits: 0, closed: new Set(), startLocales: [], transient: [] });
const orderItems = (page: Page) => page.locator('#mcqQuestions [data-order-list="q3"] [data-order-item]');
const draftResponses = (page: Page) => page.evaluate((key) => {
  try { return JSON.parse(localStorage.getItem(key) ?? "{}").modules?.m1?.mcq?.responses ?? null; } catch { return null; }
}, DRAFT_KEY);
const option = (page: Page, questionId: string, value: string) => page.locator(`#mcqQuestions input[name="q_${questionId}"][value="${value}"]`);
const workspace = (page: Page) => page.locator("#courseDetail_c1 .course-inline-panel #moduleWorkspace");

async function openModule(page: Page) {
  await page.goto("/participant?courseId=c1");
  await page.locator('#courseDetail_c1 .course-item[data-type="MODULE"] .course-module-row').click();
  await expect(workspace(page)).toBeVisible();
  await expect(option(page, "q1", "Beta")).toBeVisible();
}

/** Venter til autolagringen (et kvart sekund) har skrevet avkrysningen i kladden. */
async function waitForDraft(page: Page, questionId: string) {
  await expect.poll(() => page.evaluate(([key, q]) => {
    try { return JSON.parse(localStorage.getItem(key) ?? "{}").modules?.m1?.mcq?.responses?.[q] ?? null; } catch { return null; }
  }, [DRAFT_KEY, questionId] as const)).not.toBeNull();
}

test.describe("#1160 avkrysningene overlever", () => {
  test("oppfriskning: samme forsøk fortsetter med avkrysningene, uten en ny innlevering og uten at noe sendes", async ({ page }) => {
    const state = newState();
    await mock(page, state);
    await openModule(page);
    expect(state.submissions).toHaveLength(1);
    await option(page, "q1", "Beta").check();
    await option(page, "q2", "Grønn").check();
    await waitForDraft(page, "q2");

    await page.reload();
    await expect(workspace(page)).toBeVisible();
    await expect(option(page, "q1", "Beta")).toBeChecked();
    await expect(option(page, "q2", "Grønn")).toBeChecked();
    await expect(option(page, "q1", "Alfa")).not.toBeChecked();
    // Forsøket på den første innleveringen ble hentet, ikke et nytt startet. Ingen svar er sendt.
    expect(state.submissions).toHaveLength(1);
    expect(state.starts).toEqual(["s-1", "s-1"]);
    expect(state.mcqSubmits).toBe(0);
    await expect(page.locator("#submitMcq")).toBeVisible();
  });

  test("pause: lukket og åpnet igjen i samme økt, avkrysningene står", async ({ page }) => {
    const state = newState();
    await mock(page, state);
    await openModule(page);
    await option(page, "q1", "Gamma").check();
    await page.locator(".course-inline-panel-close").click();
    await expect(workspace(page)).toHaveCount(0);
    await page.locator('#courseDetail_c1 .course-item[data-type="MODULE"] .course-module-row').click();
    await expect(option(page, "q1", "Gamma")).toBeChecked();
    expect(state.submissions).toHaveLength(1);
  });

  test("levert: kladden for flervalget er tømt, og neste åpning starter et nytt forsøk uten de gamle avkrysningene", async ({ page }) => {
    const state = newState();
    await mock(page, state);
    await openModule(page);
    await option(page, "q1", "Beta").check();
    await option(page, "q2", "Rød").check();
    await page.locator("#submitMcq").click();
    await expect(page.locator("#resultSummary .result-headline")).toContainText("Bestått");
    expect(state.mcqSubmits).toBe(1);
    await expect.poll(() => page.evaluate((key) => {
      try { return JSON.parse(localStorage.getItem(key) ?? "{}").modules?.m1?.mcq ?? null; } catch { return "?"; }
    }, DRAFT_KEY)).toBeNull();
  });

  for (const failure of ["503", "abort"] as const) {
    test(`forbigående feil (${failure}) når forsøket hentes: svarene beholdes, ingen ny innlevering, og å åpne igjen henter dem`, async ({ page }) => {
      const state = newState();
      await mock(page, state);
      await openModule(page);
      await option(page, "q1", "Beta").check();
      await waitForDraft(page, "q1");

      state.transient.push(failure);
      await page.reload();
      // Samme vei som en åpning som feiler: en melding, modulen lukket, raden kan trykkes igjen.
      await expect(page.locator(".toast").last()).toContainText("Vi fikk ikke hentet testen du har begynt på");
      await expect(workspace(page)).toHaveCount(0);
      await expect(page).toHaveURL(/\/participant\?courseId=c1$/);
      expect(state.submissions).toHaveLength(1);
      expect(await draftResponses(page)).toMatchObject({ q1: "Beta" });

      await page.locator('#courseDetail_c1 .course-item[data-type="MODULE"] .course-module-row').click();
      await expect(option(page, "q1", "Beta")).toBeChecked();
      expect(state.submissions).toHaveLength(1);
      expect(state.starts).toEqual(["s-1", "s-1", "s-1"]);
      expect(state.mcqSubmits).toBe(0);
    });
  }

  test("språkbytte midt i testen: etter en oppfriskning står avkrysningene og rekkefølgen, på språket testen ble besvart på", async ({ page }) => {
    const state = newState();
    await mock(page, state);
    await openModule(page);
    await option(page, "q1", "Beta").check();
    // Rekkefølgen: «Først» flyttes ned ett hakk.
    await orderItems(page).first().locator('[data-order-move="down"]').click();
    await expect(orderItems(page)).toHaveText([/Så/, /Først/, /Til slutt/]);
    await waitForDraft(page, "q3");

    await page.locator("#localeSelect").selectOption("en-GB");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await page.reload();
    await expect(workspace(page)).toBeVisible();
    await expect(option(page, "q1", "Beta")).toBeChecked();
    await expect(orderItems(page)).toHaveText([/Så/, /Først/, /Til slutt/]);
    // Forsøket ble hentet på bokmål, språket svarene ble gitt på, mens siden rundt er engelsk.
    expect(state.startLocales.at(-1)).toBe("nb");
    expect(state.submissions).toHaveLength(1);
  });

  test("modulen har fått ny versjon: avkrysningene settes ikke inn, og et nytt forsøk starter", async ({ page }) => {
    const state = newState("mv-1");
    await mock(page, state);
    await openModule(page);
    await option(page, "q1", "Beta").check();
    await waitForDraft(page, "q1");

    state.versionId = "mv-2";
    await page.reload();
    await expect(workspace(page)).toBeVisible();
    await expect(option(page, "q1", "Beta")).toBeVisible();
    await expect(page.locator("#mcqQuestions input:checked")).toHaveCount(0);
    expect(state.submissions).toHaveLength(2);
    expect(state.submissions[1]).toMatchObject({ moduleVersionId: "mv-2" });
  });

  test("serveren avviser forsøket for godt (409, levert et annet sted): det glemmes, og et nytt forsøk starter", async ({ page }) => {
    const state = newState();
    await mock(page, state);
    await openModule(page);
    await option(page, "q1", "Beta").check();
    await waitForDraft(page, "q1");

    state.closed.add("s-1");
    await page.reload();
    await expect(workspace(page)).toBeVisible();
    await expect(option(page, "q1", "Beta")).toBeVisible();
    await expect(page.locator("#mcqQuestions input:checked")).toHaveCount(0);
    expect(state.submissions).toHaveLength(2);
    expect(state.starts).toEqual(["s-1", "s-1", "s-2"]);
    // Ingen feilmelding: deltakeren kan ikke gjøre noe med det, og modulen virker.
    await expect(page.locator(".toast")).toHaveCount(0);
  });
});

test.describe("#1161 ingen tekniske meldinger i modulen", () => {
  test("åpne og levere gir ingen id-er, ingen engelsk «Request completed.», og ingen Forsøks-ID-linje", async ({ page }) => {
    const state = newState();
    await mock(page, state);
    const toasts: string[] = [];
    await page.exposeFunction("__toast", (text: string) => { toasts.push(text); });
    await page.addInitScript(() => {
      new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains("toast")) (window as unknown as { __toast: (t: string) => void }).__toast(node.innerText);
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await openModule(page);
    expect(state.submissions).toHaveLength(1);
    // Forsøks-ID-en og innleverings-ID-en finnes (siden leser dem), men vises ikke.
    await expect(page.locator("#attemptIdLine")).toHaveCount(1);
    await expect(page.locator("#attemptIdLine")).toBeHidden();
    await expect(page.locator("#submissionIdLine")).toBeHidden();
    await expect(page.locator("#attemptId")).toHaveText("a-s-1");

    // Makkeren: en feil sier fortsatt fra (et ubesvart spørsmål), på norsk.
    await option(page, "q1", "Beta").check();
    await page.locator("#submitMcq").click();
    await expect(page.locator(".toast").last()).toContainText("Spørsmål 2 mangler svar");
    const errorToasts = toasts.length;
    expect(errorToasts).toBeGreaterThan(0);

    await option(page, "q2", "Rød").check();
    await page.locator("#submitMcq").click();
    await expect(page.locator("#resultSummary .result-headline")).toContainText("Bestått");
    await page.waitForTimeout(300);
    // Ingen ny toast etter en vellykket levering — resultatet står på siden.
    expect(toasts.slice(errorToasts)).toEqual([]);
    for (const text of toasts) {
      expect(text).not.toContain("Opprett innlevering");
      expect(text).not.toContain("Request completed");
      expect(text).not.toContain("s-1");
    }
  });

  test("med ?debug=1 vises Forsøks-ID-en, som før", async ({ page }) => {
    const state = newState();
    await mock(page, state);
    await page.goto("/participant?debug=1&courseId=c1");
    await page.locator('#courseDetail_c1 .course-item[data-type="MODULE"] .course-module-row').click();
    await expect(option(page, "q1", "Beta")).toBeVisible();
    await expect(page.locator("#attemptIdLine")).toBeVisible();
    await expect(page.locator("#attemptIdLine")).toContainText("a-s-1");
  });
});
