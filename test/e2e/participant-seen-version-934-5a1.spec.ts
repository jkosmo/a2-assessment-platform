import { test, expect, type Page, type Route } from "@playwright/test";

// #934 skive 5a-1: deltakersiden sender versjonen den viste, og tar imot svaret. Kjører den ekte participant.js mot
// falske API-er: det rutetestene ikke ser, er at siden faktisk sender feltet, at kladden står etter en 409, og at siden
// prøver igjen ved 503. Serversiden står i test/m2-learner-lock-934-5a1.test.ts.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const MODULE = {
  id: "m-1",
  title: "Essay Modul",
  description: null,
  assessmentMode: "FREETEXT_ONLY",
  submissionSchema: null,
  assessmentPolicy: null,
  taskText: "Skriv et essay",
  activeVersion: { id: "mv-1", versionNo: 1 },
  participantStatus: null,
};

const CHANGED = { error: "module_version_changed", message: "The module has a new version since this page was opened." };
const OUTDATED = { error: "client_outdated", message: "This page is out of date." };
const BUSY = { error: "content_busy", message: "Someone else is changing content." };
const ANSWER = "Et tilstrekkelig langt fritekstsvar som deltakeren ikke vil miste.";

async function mockBase(page: Page) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
      calibrationWorkspace: { accessRoles: [] },
      flow: { autoStartAfterMcq: false },
      output: {},
    })),
  );
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

async function mockModule(page: Page) {
  await mockBase(page);
  await page.route("**/api/modules**", (route: Route) => route.fulfill(json({ modules: [MODULE] })));
  await page.route("**/api/assessments/*/run", (route: Route) => route.fulfill(json({ ok: true })));
  await page.route("**/api/submissions/*/result", (route: Route) => route.fulfill(json({ status: "PROCESSING" })));
}

async function openModuleAndWrite(page: Page) {
  await page.goto("/participant");
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "Essay Modul" }).click();
  const field = page.locator("#submissionFields textarea").first();
  await expect(field).toBeVisible();
  for (const ta of await page.locator("#submissionFields textarea").all()) await ta.fill(ANSWER);
  return field;
}

test.describe("#934 5a-1: innleveringen", () => {
  test("sender versjonen siden viser", async ({ page }) => {
    await mockModule(page);
    let posted: Record<string, unknown> | null = null;
    await page.route("**/api/submissions", (route: Route) => {
      posted = route.request().postDataJSON();
      return route.fulfill(json({ submission: { id: "s1" } }, 201));
    });
    await openModuleAndWrite(page);
    await page.locator("#createSubmission").click();
    await expect.poll(() => posted !== null).toBe(true);
    expect(posted).toMatchObject({ moduleId: "m-1", moduleVersionId: "mv-1" });
  });

  for (const [code, body, text] of [
    ["module_version_changed", CHANGED, "Oppgaven er endret siden du åpnet siden"],
    ["client_outdated", OUTDATED, "Siden du har åpen, er utdatert"],
  ] as const) {
    test(`${code}: siden sier hva som skjedde, svaret står, og det er der etter at siden er lastet på nytt`, async ({ page }) => {
      await mockModule(page);
      await page.route("**/api/submissions", (route: Route) => route.fulfill(json(body, 409)));
      const field = await openModuleAndWrite(page);
      await page.locator("#createSubmission").click();

      await expect(page.locator(".toast").last()).toContainText(text);
      await expect(field).toHaveValue(ANSWER);
      // Ingen rå JSON i meldingen.
      await expect(page.locator(".toast").last()).not.toContainText(code);

      // Autolagringen og `beforeunload` bærer kladden. Ingenting i feilveien skal ta den bort.
      await page.reload();
      await page.locator("#loadModules").click();
      await page.locator(".module-card", { hasText: "Essay Modul" }).click();
      await expect(page.locator("#submissionFields textarea").first()).toHaveValue(ANSWER);
    });
  }

  for (const [name, nextVersion] of [
    ["andre felt", { submissionSchema: { fields: [{ id: "nyttFelt", label: "Nytt felt", type: "textarea", required: true }] } }],
    ["ren flervalg", { assessmentMode: "MCQ_ONLY" }],
  ] as const) {
    test(`ny versjon med ${name}: teksten som ble lagret som kladd, vises og overlever neste lagring`, async ({ page }) => {
      let current: Record<string, unknown> = MODULE;
      await mockBase(page);
      await page.route("**/api/modules**", (route: Route) => route.fulfill(json({ modules: [current] })));
      await page.route("**/api/submissions", (route: Route) => route.fulfill(json(CHANGED, 409)));
      await openModuleAndWrite(page);
      await page.locator("#createSubmission").click();
      await expect(page.locator(".toast").last()).toContainText("lagret som kladd");

      current = { ...MODULE, ...nextVersion, activeVersion: { id: "mv-2", versionNo: 2 } };
      const reopen = async () => {
        await page.reload();
        await page.locator("#loadModules").click();
        await page.locator(".module-card", { hasText: "Essay Modul" }).click();
      };
      await reopen();
      const saved = page.locator("#orphanedDraftTexts textarea").first();
      await expect(page.locator("#orphanedDraftTexts")).toContainText("Det du skrev til forrige versjon");
      await expect(saved).toHaveValue(ANSWER);
      await expect(saved).not.toBeEditable();

      // Lagringen ved neste innlasting (`beforeunload`) skal ikke ta den bort.
      const newField = page.locator('#submissionFields [data-field-id="nyttFelt"]');
      if (await newField.count()) {
        await expect(newField).toHaveValue("");
        await newField.fill("Et nytt svar.");
      }
      await reopen();
      await expect(page.locator("#orphanedDraftTexts textarea").first()).toHaveValue(ANSWER);
    });
  }

  test("med et tidligere resultat: teksten vises, ikke resultatet, for det ville merket kladden som levert", async ({ page }) => {
    let current: Record<string, unknown> = MODULE;
    await mockBase(page);
    await page.route("**/api/modules**", (route: Route) => route.fulfill(json({ modules: [current] })));
    await page.route("**/api/submissions", (route: Route) => route.fulfill(json(CHANGED, 409)));
    let earlierResultRequests = 0;
    await page.route("**/api/submissions/s0**", (route: Route) => {
      earlierResultRequests += 1;
      return route.fulfill(json({ status: "COMPLETED" }));
    });
    await openModuleAndWrite(page);
    await page.locator("#createSubmission").click();
    await expect(page.locator(".toast").last()).toContainText("lagret som kladd");

    current = {
      ...MODULE,
      submissionSchema: { fields: [{ id: "nyttFelt", label: "Nytt felt", type: "textarea", required: true }] },
      activeVersion: { id: "mv-2", versionNo: 2 },
      participantStatus: { latestSubmissionId: "s0", latestStatus: "COMPLETED", latestDecision: null },
    };
    await page.reload();
    await page.locator("#loadModules").click();
    await page.locator(".module-card", { hasText: "Essay Modul" }).click();
    await expect(page.locator("#orphanedDraftTexts textarea").first()).toHaveValue(ANSWER);
    await page.waitForTimeout(300);
    expect(earlierResultRequests).toBe(0);
  });

  test("uten endring i feltene vises ikke teksten to ganger", async ({ page }) => {
    await mockModule(page);
    await page.route("**/api/submissions", (route: Route) => route.fulfill(json(CHANGED, 409)));
    await openModuleAndWrite(page);
    await page.locator("#createSubmission").click();
    await expect(page.locator(".toast").last()).toContainText("lagret som kladd");
    await page.reload();
    await page.locator("#loadModules").click();
    await page.locator(".module-card", { hasText: "Essay Modul" }).click();
    await expect(page.locator("#submissionFields textarea").first()).toHaveValue(ANSWER);
    await expect(page.locator("#orphanedDraftTexts")).toBeHidden();
  });

  test("503 content_busy: siden prøver igjen av seg selv, og deltakeren ser ingen feil", async ({ page }) => {
    await mockModule(page);
    let attempts = 0;
    await page.route("**/api/submissions", (route: Route) => {
      attempts += 1;
      return attempts === 1 ? route.fulfill(json(BUSY, 503)) : route.fulfill(json({ submission: { id: "s1" } }, 201));
    });
    await openModuleAndWrite(page);
    await page.locator("#createSubmission").click();
    await expect.poll(() => attempts, { timeout: 5_000 }).toBe(2);
    await expect(page.locator("#submissionIdLabel, #submissionId").first()).toHaveText("s1");
    await expect(page.locator(".toast", { hasText: "Noen andre endrer innhold" })).toHaveCount(0);
  });
});

async function mockSection(page: Page, nextIsSection = true) {
  await mockBase(page);
  const courseItems = nextIsSection
    ? [{ type: "SECTION", sectionId: "s1", title: "Seksjon", read: false, available: true, required: true }, { type: "SECTION", sectionId: "s2", title: "Neste", read: false, available: true, required: true }]
    : [{ type: "SECTION", sectionId: "s1", title: "Seksjon", read: false, available: true, required: true }];
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill(json({ courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 0, progress: { completed: 0, total: courseItems.length, courseStatus: "NOT_STARTED" } }] })),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/c1", (route: Route) => route.fulfill(json({ course: { id: "c1", title: "Kurs", items: courseItems } })));
  await page.route("**/api/courses/c1/sections/s2", (route: Route) => route.fulfill(json({ title: "Neste", html: "<p>Neste tekst</p>", sectionVersionId: "sv-2" })));
}

async function openSection(page: Page) {
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  await page.locator(".course-module-row").first().click();
}

test.describe("#934 5a-1: lesingen", () => {
  test("sender versjonen teksten kom fra, fra begge knappene", async ({ page }) => {
    for (const [nextIsSection, button] of [[true, "#sectionReaderMarkRead"], [false, "#sectionReaderFinish"]] as const) {
      await page.unrouteAll();
      await mockSection(page, nextIsSection);
      await page.route("**/api/courses/c1/sections/s1", (route: Route) => route.fulfill(json({ title: "Seksjon", html: "<p>Tekst</p>", sectionVersionId: "sv-1" })));
      let posted: unknown = null;
      await page.route("**/api/courses/c1/sections/s1/read", (route: Route) => {
        posted = route.request().postDataJSON();
        return route.fulfill({ status: 204, body: "" });
      });
      await openSection(page);
      await page.locator(button).click();
      await expect.poll(() => posted).toEqual({ sectionVersionId: "sv-1" });
    }
  });

  test("knappen er av til teksten er lastet: en lesing kan ikke registreres uten at teksten er vist", async ({ page }) => {
    await mockSection(page);
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/courses/c1/sections/s1", async (route: Route) => {
      await released;
      await route.fulfill(json({ title: "Seksjon", html: "<p>Tekst</p>", sectionVersionId: "sv-1" }));
    });
    await openSection(page);
    const button = page.locator("#sectionReaderMarkRead");
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
    release();
    await expect(button).toBeEnabled();
  });

  test("et bilde som henger, holder ikke knappen av", async ({ page }) => {
    await mockSection(page);
    await page.route("**/api/courses/c1/sections/s1", (route: Route) =>
      route.fulfill(json({ title: "Seksjon", html: '<p>Tekst</p><img src="/api/content-assets/a1" alt="Figur">', sectionVersionId: "sv-1" })),
    );
    await page.route("**/api/content-assets/**", () => { /* svarer aldri */ });
    await openSection(page);
    await expect(page.locator("#sectionReaderBody")).toContainText("Tekst");
    await expect(page.locator("#sectionReaderMarkRead")).toBeEnabled();
  });

  test("teksten kunne ikke hentes: knappen forblir av", async ({ page }) => {
    await mockSection(page);
    await page.route("**/api/courses/c1/sections/s1", (route: Route) => route.fulfill(json({ error: "section_not_found" }, 404)));
    await openSection(page);
    await expect(page.locator("#sectionReaderBody")).not.toHaveText(/laster/i);
    await expect(page.locator("#sectionReaderMarkRead")).toBeDisabled();
  });

  test("section_version_changed: siden sier at teksten er endret, på deltakerens språk, og knappen kan trykkes igjen", async ({ page }) => {
    await mockSection(page);
    await page.route("**/api/courses/c1/sections/s1", (route: Route) => route.fulfill(json({ title: "Seksjon", html: "<p>Tekst</p>", sectionVersionId: "sv-1" })));
    await page.route("**/api/courses/c1/sections/s1/read", (route: Route) =>
      route.fulfill(json({ error: "section_version_changed", message: "The text has changed." }, 409)),
    );
    await openSection(page);
    await page.locator("#sectionReaderMarkRead").click();
    const toast = page.locator(".toast").last();
    await expect(toast).toContainText("Teksten er endret siden du åpnet den");
    await expect(toast).not.toContainText("section_version_changed");
    await expect(page.locator("#sectionReaderMarkRead")).toBeEnabled();
  });

  test("503 content_busy: siden prøver igjen av seg selv, og går videre", async ({ page }) => {
    await mockSection(page);
    await page.route("**/api/courses/c1/sections/s1", (route: Route) => route.fulfill(json({ title: "Seksjon", html: "<p>Tekst</p>", sectionVersionId: "sv-1" })));
    let attempts = 0;
    await page.route("**/api/courses/c1/sections/s1/read", (route: Route) => {
      attempts += 1;
      return attempts === 1 ? route.fulfill(json(BUSY, 503)) : route.fulfill({ status: 204, body: "" });
    });
    await openSection(page);
    await page.locator("#sectionReaderMarkRead").click();
    await expect.poll(() => attempts, { timeout: 5_000 }).toBe(2);
    await expect(page.locator(".course-inline-panel-title")).toHaveText("Neste");
    await expect(page.locator(".toast", { hasText: "Noen andre endrer innhold" })).toHaveCount(0);
  });
});
