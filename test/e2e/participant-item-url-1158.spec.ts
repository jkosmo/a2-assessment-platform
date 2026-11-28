import { test, expect, type Page, type Route } from "@playwright/test";

// #1158 — seksjonen og modulen står i adressen, så tilbake (appens og nettleserens) lukker elementet og står i kurset, og en
// oppfriskning eller et bokmerke holder det åpent. Før sto bare kurset i adressen: nettleserens tilbake forlot kurset (ofte til
// e-posten deltakeren kom fra), og en oppfriskning lukket det hen leste. Kjører den ekte participant.js mot falske API-er.
//
//   /participant?courseId=c1&sectionId=s1   seksjonen er åpen
//   /participant?courseId=c1&moduleId=m1    modulen er åpen
//
// Historikken har høyst ÉN elementoppføring over kursets: et nytt element erstatter det forrige, og «Lukk» går ett steg
// tilbake. Derfor gjør appens og nettleserens tilbake det samme, og det prøves her mot hverandre.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const SECTION_NOTICE = "Vi fant ikke denne seksjonen i kurset.";
const MODULE_NOTICE = "Vi fant ikke denne modulen i kursene dine.";
const ANSWER = "Et svar deltakeren har skrevet, men ikke levert.";

type Calls = { submissions: number; mcqSubmits: number; reads: string[] };

async function mock(page: Page): Promise<Calls> {
  const calls: Calls = { submissions: 0, mcqSubmits: 0, reads: [] };
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ }
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
    route.fulfill(json({
      courses: ["c1", "c2"].map((id) => ({ id, title: `Kurs ${id}`, description: null, moduleCount: 1, progress: { completed: 0, total: 4, moduleCompleted: 0, moduleTotal: 2, sectionCompleted: 0, sectionTotal: 2, courseStatus: "IN_PROGRESS" } })),
    })),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/enrollments", (route: Route) => route.fulfill(json({ enrollments: [] })));
  for (const courseId of ["c1", "c2"]) {
    await page.route(`**/api/courses/${courseId}`, (route: Route) =>
      route.fulfill(json({
        course: {
          id: courseId,
          title: `Kurs ${courseId}`,
          discussionsEnabled: false,
          modules: [],
          items: [
            { type: "SECTION", sectionId: "s1", courseItemId: `${courseId}-i1`, title: "Første seksjon", read: calls.reads.includes("s1"), available: true },
            { type: "SECTION", sectionId: "s2", courseItemId: `${courseId}-i2`, title: "Andre seksjon", read: calls.reads.includes("s2"), available: true },
            { type: "MODULE", moduleId: "m1", courseItemId: `${courseId}-i3`, title: "Oppgaven", moduleStatus: "NOT_STARTED", available: true, required: true },
            { type: "MODULE", moduleId: "m-off", courseItemId: `${courseId}-i4`, title: "Avpublisert", moduleStatus: "NOT_STARTED", available: false, required: true },
          ],
        },
      })),
    );
  }
  await page.route(/\/api\/courses\/c[12]\/sections\/(s1|s2)$/, (route: Route) => {
    const id = route.request().url().endsWith("s1") ? "s1" : "s2";
    return route.fulfill(json({ title: id === "s1" ? "Første seksjon" : "Andre seksjon", html: `<p>Tekst i ${id}</p>`, sectionVersionId: `sv-${id}` }));
  });
  await page.route(/\/api\/courses\/c[12]\/sections\/(s1|s2)\/read$/, (route: Route) => {
    calls.reads.push(route.request().url().includes("/s1/") ? "s1" : "s2");
    return route.fulfill(json({ ok: true }));
  });
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill(json({
      modules: [{
        id: "m1",
        title: "Oppgaven",
        description: null,
        assessmentMode: "FREETEXT_PLUS_MCQ",
        submissionSchema: null,
        assessmentPolicy: null,
        taskText: "Skriv et svar",
        activeVersion: { id: "mv-1", versionNo: 1 },
        participantStatus: null,
      }],
    })),
  );
  await page.route("**/api/submissions", (route: Route) => {
    calls.submissions += 1;
    return route.fulfill(json({ submission: { id: "s-new", submissionStatus: "SUBMITTED" } }, 201));
  });
  await page.route("**/api/modules/*/mcq/submit", (route: Route) => {
    calls.mcqSubmits += 1;
    return route.fulfill(json({ assessmentComplete: true }));
  });
  return calls;
}

const course = (page: Page, id = "c1") => page.locator(`.course-accordion-item[data-course-id="${id}"]`);
const sectionRow = (page: Page, id: string) => page.locator(`#courseDetail_c1 .course-item[data-key="c1-i${id === "s1" ? 1 : 2}"] .course-module-row`);
const moduleRow = (page: Page) => page.locator('#courseDetail_c1 .course-item[data-type="MODULE"]').first().locator(".course-module-row");
const readerBody = (page: Page) => page.locator("#sectionReaderBody");
const workspace = (page: Page) => page.locator("#courseDetail_c1 .course-inline-panel #moduleWorkspace");

/** Kursvisningen: kurset står alene, ingen seksjon eller modul er åpen, og adressen er kursets. */
async function expectCourseView(page: Page) {
  await expect(course(page)).toHaveClass(/is-focused/);
  await expect(page.locator("#courseBackBar")).toBeVisible();
  await expect(readerBody(page)).toHaveCount(0);
  await expect(page.locator("#courseDetail_c1 .course-item.open")).toHaveCount(0);
  await expect(moduleRow(page)).toBeVisible();
  await expect(page).toHaveURL(/\/participant\?courseId=c1$/);
}

async function openCourse(page: Page) {
  await page.goto("/participant");
  await course(page).locator(".course-accordion-header").click();
  await expect(page).toHaveURL(/\/participant\?courseId=c1$/);
  await expect(moduleRow(page)).toBeVisible();
}

test.describe("#1158 seksjonen i adressen", () => {
  test("åpnet seksjon står i adressen; nettleserens tilbake står i kurset, og fram åpner den igjen", async ({ page }) => {
    await mock(page);
    await openCourse(page);
    await sectionRow(page, "s1").click();
    await expect(readerBody(page)).toContainText("Tekst i s1");
    await expect(page).toHaveURL(/\/participant\?courseId=c1&sectionId=s1$/);

    await page.goBack();
    await expectCourseView(page);

    await page.goForward();
    await expect(readerBody(page)).toContainText("Tekst i s1");
    await expect(page).toHaveURL(/sectionId=s1$/);
  });

  test("oppfriskning og bokmerke holder seksjonen åpen; tilbake fra bokmerket står i kurset", async ({ page }) => {
    await mock(page);
    await openCourse(page);
    await sectionRow(page, "s1").click();
    await expect(readerBody(page)).toContainText("Tekst i s1");

    await page.reload();
    await expect(readerBody(page)).toContainText("Tekst i s1");
    await expect(page).toHaveURL(/courseId=c1&sectionId=s1$/);

    // Bokmerket: en ny fane rett inn i seksjonen.
    const bookmark = await page.context().newPage();
    await mock(bookmark);
    await bookmark.goto("/participant?courseId=c1&sectionId=s2");
    await expect(bookmark.locator("#sectionReaderBody")).toContainText("Tekst i s2");
    await bookmark.goBack();
    await expectCourseView(bookmark);
  });

  test("«← Tilbake til kurset» i seksjonen og nettleserens tilbake gjør det samme", async ({ page }) => {
    await mock(page);
    await openCourse(page);
    const before = await page.evaluate(() => history.length);

    // Nettleserens tilbake.
    await sectionRow(page, "s1").click();
    await expect(readerBody(page)).toContainText("Tekst i s1");
    await page.goBack();
    await expectCourseView(page);
    const afterBrowserBack = await page.evaluate(() => ({ length: history.length, url: location.href }));

    // Appens «Lukk». Samme sted, samme historikk, og fram åpner seksjonen igjen i begge.
    await sectionRow(page, "s1").click();
    await expect(readerBody(page)).toContainText("Tekst i s1");
    await page.locator(".course-inline-panel-close").click();
    await expectCourseView(page);
    const afterAppClose = await page.evaluate(() => ({ length: history.length, url: location.href }));
    expect(afterAppClose).toEqual(afterBrowserBack);
    expect(afterAppClose.length).toBe(before + 1);

    await page.goForward();
    await expect(readerBody(page)).toContainText("Tekst i s1");

    // Escape er appens tredje vei ut, og gjør det samme.
    await page.keyboard.press("Escape");
    await expectCourseView(page);
  });

  test("«Marker lest, og gå videre» bytter seksjon i adressen uten et nytt steg: tilbake står i kurset", async ({ page }) => {
    const calls = await mock(page);
    await openCourse(page);
    const before = await page.evaluate(() => history.length);
    await sectionRow(page, "s1").click();
    await page.locator("#sectionReaderMarkRead").click();
    await expect(readerBody(page)).toContainText("Tekst i s2");
    await expect(page).toHaveURL(/courseId=c1&sectionId=s2$/);
    expect(calls.reads).toEqual(["s1"]);
    expect(await page.evaluate(() => history.length)).toBe(before + 1);

    await page.goBack();
    await expectCourseView(page);
  });

  test("en seksjon som ikke står i kurset: kurset med meldingen, og adressen mister seksjonen", async ({ page }) => {
    await mock(page);
    await page.goto("/participant?courseId=c1&sectionId=borte");
    await expect(page.locator("#courseLinkNotice")).toContainText(SECTION_NOTICE);
    await expectCourseView(page);
    // Meldingen viker når deltakeren åpner noe annet.
    await sectionRow(page, "s1").click();
    await expect(page.locator("#courseLinkNotice")).toBeHidden();
  });
});

test.describe("#1158 modulen i adressen", () => {
  test("åpnet modul står i adressen; tilbake står i kurset, og ulagret tekst er der når den åpnes igjen", async ({ page }) => {
    const calls = await mock(page);
    await openCourse(page);
    await moduleRow(page).click();
    await expect(workspace(page)).toBeVisible();
    await expect(page).toHaveURL(/\/participant\?courseId=c1&moduleId=m1$/);

    await page.locator("#submissionFields textarea").first().fill(ANSWER);
    await page.goBack();
    await expectCourseView(page);

    await page.goForward();
    await expect(workspace(page)).toBeVisible();
    await expect(page.locator("#submissionFields textarea").first()).toHaveValue(ANSWER);

    // Oppfriskning: modulen er åpen, og teksten kommer fra kladden.
    await page.reload();
    await expect(workspace(page)).toBeVisible();
    await expect(page.locator("#submissionFields textarea").first()).toHaveValue(ANSWER);
    // Ingenting ble levert underveis.
    expect(calls.submissions).toBe(0);
  });

  test("«← Tilbake til kurset» i modulen og nettleserens tilbake gjør det samme", async ({ page }) => {
    await mock(page);
    await openCourse(page);
    await moduleRow(page).click();
    await expect(workspace(page)).toBeVisible();
    await page.goBack();
    await expectCourseView(page);
    const afterBrowserBack = await page.evaluate(() => ({ length: history.length, url: location.href }));

    await moduleRow(page).click();
    await expect(workspace(page)).toBeVisible();
    await page.locator(".course-inline-panel-close").click();
    await expectCourseView(page);
    expect(await page.evaluate(() => ({ length: history.length, url: location.href }))).toEqual(afterBrowserBack);
  });

  test("fra seksjon rett til modul og videre: bare ett steg over kurset", async ({ page }) => {
    await mock(page);
    await openCourse(page);
    const before = await page.evaluate(() => history.length);
    await sectionRow(page, "s1").click();
    await expect(readerBody(page)).toContainText("Tekst i s1");
    // Fra den andre seksjonen er neste element modulen («… og gå til testen»).
    await page.locator(".course-inline-panel-close").click();
    await sectionRow(page, "s2").click();
    await page.locator("#sectionReaderMarkRead").click();
    await expect(workspace(page)).toBeVisible();
    await expect(page).toHaveURL(/courseId=c1&moduleId=m1$/);
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    await page.goBack();
    await expectCourseView(page);
  });

  test("en modul som ikke kan åpnes (avpublisert): kurset med meldingen, ingen innlevering", async ({ page }) => {
    const calls = await mock(page);
    await page.goto("/participant?courseId=c1&moduleId=m-off");
    await expect(page.locator("#courseLinkNotice")).toContainText(MODULE_NOTICE);
    await expectCourseView(page);
    expect(calls.submissions).toBe(0);
  });
});

test.describe("#1158 e-postlenka til en modul", () => {
  test("lenka til en modul som står i kurset, men ikke kan åpnes: kurset med samme melding som adressen med kurset gir", async ({ page }) => {
    const calls = await mock(page);
    await page.goto("/participant?moduleId=m-off");
    await expect(page.locator("#courseLinkNotice")).toContainText(MODULE_NOTICE);
    await expectCourseView(page);
    expect(calls.submissions).toBe(0);
  });

  test("lenka åpner modulen i kurset, overlever en oppfriskning, og tilbake står i kurset", async ({ page }) => {
    await mock(page);
    await page.goto("/participant?moduleId=m1");
    await expect(workspace(page)).toBeVisible();
    await expect(page).toHaveURL(/\/participant\?courseId=c1&moduleId=m1$/);

    await page.reload();
    await expect(workspace(page)).toBeVisible();
    await expect(page).toHaveURL(/\/participant\?courseId=c1&moduleId=m1$/);

    await page.goBack();
    await expectCourseView(page);
  });
});

test.describe("#1158 kursnivået er som før", () => {
  test("lista → kurs → seksjon: tilbake går til kurset, så til lista; fram går samme vei inn igjen", async ({ page }) => {
    await mock(page);
    await openCourse(page);
    await sectionRow(page, "s1").click();
    await expect(readerBody(page)).toContainText("Tekst i s1");

    await page.goBack();
    await expectCourseView(page);
    await page.goBack();
    await expect(course(page, "c2")).toBeVisible();
    await expect(page.locator("#courseBackBar")).toBeHidden();
    await expect(page).toHaveURL(/\/participant$/);

    await page.goForward();
    await expectCourseView(page);
    await page.goForward();
    await expect(readerBody(page)).toContainText("Tekst i s1");
  });

  // #1162 skive 5: modulen står i lesemodus som seksjonen, så «← Tilbake til Mine kurs» vises ikke mens den er åpen (før gikk
  // testen via den). Historikken er som for seksjonen over.
  test("lista → kurs → modul: tilbake går til kurset, så til lista; fram åpner modulen igjen", async ({ page }) => {
    await mock(page);
    await openCourse(page);
    await moduleRow(page).click();
    await expect(workspace(page)).toBeVisible();
    await expect(page).toHaveURL(/courseId=c1&moduleId=m1$/);
    await expect(page.locator("#courseBackBtn")).toBeHidden();

    await page.goBack();
    await expectCourseView(page);
    await page.goBack();
    await expect(course(page, "c2")).toBeVisible();
    await expect(page).toHaveURL(/\/participant$/);

    await page.goForward();
    await expectCourseView(page);
    await page.goForward();
    await expect(workspace(page)).toBeVisible();
    await expect(page).toHaveURL(/courseId=c1&moduleId=m1$/);
  });

  test("et annet kurs tar ikke med seg elementet", async ({ page }) => {
    await mock(page);
    await page.goto("/participant?courseId=c1&sectionId=s1");
    await expect(readerBody(page)).toContainText("Tekst i s1");
    await page.locator(".course-inline-panel-close").click();
    await expectCourseView(page);
    await page.locator("#courseBackBtn").click();
    await course(page, "c2").locator(".course-accordion-header").click();
    await expect(page).toHaveURL(/\/participant\?courseId=c2$/);
    await expect(readerBody(page)).toHaveCount(0);
  });
});
