import { test, expect, type Page, type Route } from "@playwright/test";

// 2.126.0 — produkteier 2026-11-01: «Man bør ha mulighet for å kunne senere anke på et resultat, det
// bør ikke være en beslutning man må ta der og da. Men å anke på en modul eller kurs man har bestått
// gir ingen mening.»
//
// Før ble modulen nullstilt hver gang den ble åpnet: forrige resultat ble ikke lastet, anke-knappen kom
// aldri, og en flervalgsmodul startet et nytt forsøk med en gang. Den eneste veien til en senere anke
// var «Fullførte»-siden. Nå vises siste resultat — anke ved stryk, ikke ved bestått — med mindre
// deltakeren har begynt på et nytt forsøk.

type Status = { latestSubmissionId: string; latestStatus: string; latestDecision: { passFailTotal: boolean } | null } | null;

const FAILED: Status = { latestSubmissionId: "s-old", latestStatus: "COMPLETED", latestDecision: { passFailTotal: false } };
const PASSED: Status = { latestSubmissionId: "s-old", latestStatus: "COMPLETED", latestDecision: { passFailTotal: true } };

function result(passed: boolean) {
  return {
    status: "COMPLETED",
    decision: { passFailTotal: passed, decisionType: "AUTOMATIC" },
    scoreComponents: { totalScore: passed ? 90 : 30, mcqScaledScore: passed ? 90 : 30, practicalScaledScore: 0 },
    participantGuidance: {},
  };
}

type Opts = {
  mcqStatus?: Status; ftStatus?: Status; passed?: boolean; staticList?: boolean;
  /** Hold svaret på /result (eller /mcq-review) igjen til testen slipper det. */
  holdResult?: Promise<void>; holdReview?: Promise<void>;
  /** Det leverte svaret, slik tjeneren lagret det (standard: feltet «response»). */
  oldResponse?: Record<string, string>;
};

/** Et løfte testen selv avgjør når holdes og slippes. */
function hold() {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release: () => release() };
}

async function mockBase(page: Page, opts: Opts = {}) {
  const calls = { created: 0, results: [] as string[], appeals: [] as string[] };
  // Som tjeneren: modullista bærer siste innlevering, også en levert i denne økta («Last moduler»
  // henter lista på nytt).
  const status: Record<string, Status> = { "m-mcq": opts.mcqStatus ?? null, "m-ft": opts.ftStatus ?? null };
  const moduleOf: Record<string, string> = {};
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
        calibrationWorkspace: { accessRoles: [] },
        flow: {},
        output: {},
      }),
    }),
  );
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: {} }) }));
  // Rutene for mcq/start og mcq/submit registreres etterpå og går foran denne.
  await page.route("**/api/modules**", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          { id: "m-mcq", title: "MCQ Modul", description: null, assessmentMode: "MCQ_ONLY", submissionSchema: null, assessmentPolicy: null, taskText: null, activeVersion: { versionNo: 1 }, participantStatus: status["m-mcq"] },
          { id: "m-ft", title: "Fritekst Modul", description: null, assessmentMode: "FREETEXT_ONLY", submissionSchema: null, assessmentPolicy: null, taskText: "Skriv et svar", activeVersion: { versionNo: 1 }, participantStatus: status["m-ft"] },
          { id: "m-ny", title: "Ny flervalg", description: null, assessmentMode: "MCQ_ONLY", submissionSchema: null, assessmentPolicy: null, taskText: null, activeVersion: { versionNo: 1 }, participantStatus: null },
        ],
      }),
    });
  });
  await page.route("**/api/submissions", (route: Route) => {
    calls.created += 1;
    const id = `s-new-${calls.created}`;
    const moduleId = (route.request().postDataJSON() as { moduleId: string }).moduleId;
    moduleOf[id] = moduleId;
    if (!opts.staticList) status[moduleId] = { latestSubmissionId: id, latestStatus: "SUBMITTED", latestDecision: null };
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission: { id, submissionStatus: "SUBMITTED" } }) });
  });
  await page.route("**/api/submissions/*/result", async (route: Route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3];
    calls.results.push(id);
    if (moduleOf[id] && !opts.staticList) status[moduleOf[id]] = { latestSubmissionId: id, latestStatus: "COMPLETED", latestDecision: { passFailTotal: opts.passed === true } };
    if (opts.holdResult) await opts.holdResult;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...result(opts.passed === true), submissionId: id }) });
  });
  await page.route("**/api/submissions/*/mcq-review", async (route: Route) => {
    if (opts.holdReview) await opts.holdReview;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, questions: [{ id: "q1", stem: "Spørsmål fra modul A", isCorrect: false, selectedAnswer: "A", correctAnswer: "B" }] }) });
  });
  await page.route(/\/api\/submissions\/s-old$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ submission: { id: "s-old", response: opts.oldResponse ?? { response: "Mitt leverte svar" } } }) }),
  );
  await page.route("**/api/submissions/*/appeals", (route: Route) => {
    calls.appeals.push(new URL(route.request().url()).pathname.split("/")[3]);
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ appeal: { id: "ap-1", appealStatus: "OPEN" } }) });
  });
  await page.route("**/api/modules/*/mcq/start**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ attemptId: "a1", questions: [{ id: "q1", stem: "Spørsmål 1", options: ["A", "B"] }] }) }),
  );
  await page.route("**/api/modules/*/mcq/submit", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assessmentComplete: true }) }),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  return calls;
}

// QA-porten 2026-11-01: mens resultatet hentes, sto «Opprett innlevering» åpen — et klikk der startet
// et nytt forsøk som resultatet så la seg over.
test("mens forrige resultat hentes, kan ikke et nytt forsøk startes; låsen slippes når resultatet er der", async ({ page }) => {
  const h = hold();
  // Flervalg: her har knappen ingen felt som holder den låst, så det er låsen som måles.
  const calls = await mockBase(page, { mcqStatus: FAILED, holdResult: h.promise });
  await page.goto("/participant");
  await openModule(page, "MCQ Modul");
  await expect.poll(() => calls.results.length).toBe(1);
  await expect(page.locator("#createSubmission")).toBeDisabled();
  await page.locator("#createSubmission").click({ force: true });
  h.release();
  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
  expect(calls.created).toBe(0);
});

test("låsen fra én modul følger ikke med til neste: en ny flervalgsmodul starter som før", async ({ page }) => {
  const h = hold();
  const calls = await mockBase(page, { mcqStatus: FAILED, holdResult: h.promise });
  await page.goto("/participant");
  await openModule(page, "MCQ Modul");
  await expect.poll(() => calls.results.length).toBe(1);
  await openModule(page, "Ny flervalg");
  await expect.poll(() => calls.created).toBe(1);
  h.release();
  await expect(page.locator("input[name='q_q1']").first()).toBeVisible();
  await expect(page.locator("#resultSummary")).not.toHaveAttribute("data-has-result", "true");
});

// QA-porten 2026-11-01, runde 2: et bytte mens resultatet hentes, lagret kladden på nytt uten merket —
// og neste gang var resultatet borte.
test("bytte modul mens resultatet hentes, og tilbake: resultatet står der fortsatt", async ({ page }) => {
  const h = hold();
  const calls = await mockBase(page, { ftStatus: FAILED, staticList: true, holdResult: h.promise });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("participant.moduleDrafts.v1", JSON.stringify({ modules: { "m-ft": { response: "Mitt leverte svar", mcq: null, submittedAs: "s-old", updatedAt: new Date().toISOString() } } }));
    } catch { /* ignore */ }
  });
  const visLista = () => page.evaluate(() => document.getElementById("moduleListSection")?.classList.remove("module-list-collapsed"));
  await page.goto("/participant");
  await openModule(page, "Fritekst Modul");
  await expect.poll(() => calls.results.length).toBe(1);
  await visLista();
  await page.locator(".module-card", { hasText: "MCQ Modul" }).click();
  h.release();
  await visLista();
  await page.locator(".module-card", { hasText: "Fritekst Modul" }).click();
  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
  await expect(page.locator("#createAppeal")).toBeEnabled();
});

test("en avvist innlevering (REJECTED) er også et resultat: det startes ikke et nytt forsøk", async ({ page }) => {
  const calls = await mockBase(page, { mcqStatus: { latestSubmissionId: "s-old", latestStatus: "REJECTED", latestDecision: null } });
  await page.goto("/participant");
  await openModule(page, "MCQ Modul");
  await expect.poll(() => calls.results).toEqual(["s-old"]);
  expect(calls.created).toBe(0);
});

test("gjennomgangen fra modul A havner ikke i modul B når deltakeren bytter mens den hentes", async ({ page }) => {
  const h = hold();
  const calls = await mockBase(page, { mcqStatus: FAILED, holdReview: h.promise });
  await page.route("**/api/submissions/*/result", async (route: Route) => {
    calls.results.push(new URL(route.request().url()).pathname.split("/")[3]);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...result(false), submissionId: "s-old", scoreComponents: { totalScore: 30, mcqScaledScore: 30, mcqPercentScore: 30, practicalScaledScore: 0 } }) });
  });
  await page.goto("/participant");
  await openModule(page, "MCQ Modul");
  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
  await openModule(page, "Fritekst Modul");
  h.release();
  await page.waitForTimeout(500);
  await expect(page.locator(".mcq-review-list")).toHaveCount(0);
});

test("nytt svarskjema siden svaret ble levert: svaret står i det første feltet i stedet for å forsvinne", async ({ page }) => {
  await mockBase(page, { ftStatus: FAILED, oldResponse: { gammeltFelt: "Svar i gammelt skjema" } });
  await page.goto("/participant");
  await openModule(page, "Fritekst Modul");
  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
  await expect(page.locator("#submissionFields textarea").first()).toHaveValue("Svar i gammelt skjema");
});

// Veien deltakerne faktisk går: stage og prod kjører i kursmodus (`courseOnly`), og modulen åpnes inne
// i kurset (openCourseModule), ikke fra modullista.
test("gjennom kurset: en strøket modul viser resultatet og anke-knappen når den åpnes, uten nytt forsøk", async ({ page }) => {
  const calls = await mockBase(page, { mcqStatus: FAILED });
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 1, progress: { completed: 0, total: 1, moduleCompleted: 0, moduleTotal: 1, sectionCompleted: 0, sectionTotal: 0, courseStatus: "IN_PROGRESS" } }] }) }),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "c1", title: "Kurs", items: [{ type: "MODULE", moduleId: "m-mcq", courseItemId: "ci1", title: "MCQ Modul", moduleStatus: "FAILED", available: true }] } }) }),
  );
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  await page.locator('.course-item[data-key="ci1"] .course-module-row').click();

  const panel = page.locator('.course-item[data-key="ci1"] .course-inline-panel');
  await expect(panel.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
  await expect(panel.locator("#createAppeal")).toBeEnabled();
  expect(calls.created).toBe(0);
  expect(calls.results).toEqual(["s-old"]);
});

async function openModule(page: Page, title: string) {
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: title }).click();
}

test("stryk på en flervalgsmodul: resultatet vises, det startes ikke et nytt forsøk, og anken går til det resultatet", async ({ page }) => {
  const calls = await mockBase(page, { mcqStatus: FAILED });
  await page.goto("/participant");
  await openModule(page, "MCQ Modul");

  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
  await expect(page.locator("#createAppeal")).toBeEnabled();
  await expect(page.locator("#resetSubmissionFlow")).toBeVisible();
  expect(calls.created).toBe(0);
  expect(calls.results).toEqual(["s-old"]);

  await page.locator("#createAppeal").click();
  await expect.poll(() => calls.appeals).toEqual(["s-old"]);
});

test("bestått: resultatet vises, men anke er ikke mulig", async ({ page }) => {
  const calls = await mockBase(page, { mcqStatus: PASSED, passed: true });
  await page.goto("/participant");
  await openModule(page, "MCQ Modul");

  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
  await expect(page.locator("#createAppeal")).toBeDisabled();
  expect(calls.created).toBe(0);
  // Konfettien hører til øyeblikket man består, ikke til hver gang modulen åpnes igjen. Telles med en
  // gang: lerretet fjerner seg selv etter 2,6 s, så en ventende påstand ville blitt grønn uansett.
  expect(await page.locator("body > canvas").count()).toBe(0);
});

test("fritekst: det leverte svaret står igjen, skrivebeskyttet, ved resultatet", async ({ page }) => {
  await mockBase(page, { ftStatus: FAILED });
  await page.goto("/participant");
  await openModule(page, "Fritekst Modul");

  const felt = page.locator("#submissionFields textarea").first();
  await expect(felt).toHaveValue("Mitt leverte svar");
  await expect(felt).toHaveAttribute("readonly", "");
  await expect(page.locator("#createAppeal")).toBeEnabled();
});

test("fritekst: bort fra modulen og tilbake — det leverte svaret i kladden hindrer ikke at resultatet vises igjen", async ({ page }) => {
  // Når modulen forlates, lagres feltene som kladd. Her holder de det leverte svaret, som har innhold —
  // uten merket ville kladden sett ut som et nytt forsøk, og resultatet ville forsvunnet.
  const calls = await mockBase(page, { ftStatus: FAILED, staticList: true });
  const visLista = () => page.evaluate(() => document.getElementById("moduleListSection")?.classList.remove("module-list-collapsed"));
  await page.goto("/participant");
  await openModule(page, "Fritekst Modul");
  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");

  await visLista();
  await page.locator(".module-card", { hasText: "MCQ Modul" }).click();
  await visLista();
  await page.locator(".module-card", { hasText: "Fritekst Modul" }).click();
  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
  await expect(page.locator("#submissionFields textarea").first()).toHaveValue("Mitt leverte svar");
  expect(calls.results.filter((id) => id === "s-old")).toHaveLength(2);
});

test("nytt forsøk påbegynt (kladd med innhold): kladden vises, ikke det gamle resultatet", async ({ page }) => {
  const calls = await mockBase(page, { ftStatus: FAILED });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("participant.moduleDrafts.v1", JSON.stringify({ modules: { "m-ft": { response: "Nytt utkast", mcq: null, updatedAt: new Date().toISOString() } } }));
    } catch { /* ignore */ }
  });
  await page.goto("/participant");
  await openModule(page, "Fritekst Modul");

  await expect(page.locator("#submissionFields textarea").first()).toHaveValue("Nytt utkast");
  await expect(page.locator("#resultSummary")).not.toHaveAttribute("data-has-result", "true");
  expect(calls.results).toEqual([]);
});

test("kladden er restene av det leverte svaret (merket med innleveringen): resultatet vises", async ({ page }) => {
  const calls = await mockBase(page, { ftStatus: FAILED });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("participant.moduleDrafts.v1", JSON.stringify({ modules: { "m-ft": { response: "Mitt leverte svar", mcq: null, submittedAs: "s-old", updatedAt: new Date().toISOString() } } }));
    } catch { /* ignore */ }
  });
  await page.goto("/participant");
  await openModule(page, "Fritekst Modul");

  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
  expect(calls.results).toEqual(["s-old"]);
});

test("stryk i denne økta: tilbake til modulen senere viser resultatet igjen, uten nytt forsøk", async ({ page }) => {
  const calls = await mockBase(page);
  await page.goto("/participant");
  await openModule(page, "MCQ Modul");
  await page.locator("input[name='q_q1']").first().check();
  await page.locator("#submitMcq").click();
  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
  expect(calls.created).toBe(1);

  await openModule(page, "Fritekst Modul");
  await openModule(page, "MCQ Modul");
  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
  await expect(page.locator("#createAppeal")).toBeEnabled();
  expect(calls.created).toBe(1);
  expect(calls.results.at(-1)).toBe("s-new-1");
});

test("stryk i denne økta, uten at modullista hentes på nytt (slik kursvisningen gjør): resultatet vises igjen", async ({ page }) => {
  // Kursvisningen åpner modulen fra lista som ble hentet ved sidelasting. Her åpnes lista uten å hente
  // den, og tjeneren svarer aldri med den nye innleveringen — bare økta selv kan vite om den.
  const calls = await mockBase(page, { staticList: true });
  const visLista = () => page.evaluate(() => document.getElementById("moduleListSection")?.classList.remove("module-list-collapsed"));
  await page.goto("/participant");
  await openModule(page, "MCQ Modul");
  await page.locator("input[name='q_q1']").first().check();
  await page.locator("#submitMcq").click();
  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");

  await visLista();
  await page.locator(".module-card", { hasText: "Fritekst Modul" }).click();
  await visLista();
  await page.locator(".module-card", { hasText: "MCQ Modul" }).click();
  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true");
  await expect(page.locator("#createAppeal")).toBeEnabled();
  expect(calls.created).toBe(1);
});
