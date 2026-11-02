import { test, expect, type Page, type Route } from "@playwright/test";

// #1137 — seilbåten på fremdriftslinja i «Mine kurs» (produkteier 2026-11-01/02).
//   - Båten seiler mot VENSTRE (2-tallet styrer fra høyre, som i logoen); linja fylles fra høyre.
//   - Bare kurs i gang har båt. Ikke påbegynt: tom linje. Fullført: hel grønn linje, ingen båt.
//   - Under 30 %: flatt seil og én stripe; fra 30 %: fullt seil og tre striper.
//   - Når kurset fullføres i økta: båten kommer i mål, feirer og glir ut. Redusert bevegelse: ingen båt.
// Alt er klientlag (posisjon, retning, animasjon) og usynlig for supertest.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

type Course = { id: string; title: string; done: number; total: number; status: string };

function apiCourse(c: Course) {
  return {
    id: c.id,
    title: c.title,
    description: null,
    moduleCount: 0,
    progress: { completed: c.done, total: c.total, sectionCompleted: c.done, sectionTotal: c.total, courseStatus: c.status },
  };
}

async function mockBase(page: Page, getCourses: () => Course[], completions: () => unknown[] = () => []) {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
  await page.route("**/participant/config", (r: Route) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
    calibrationWorkspace: { accessRoles: [] },
    flow: {},
    output: {},
  })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (r: Route) => r.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (r: Route) => r.fulfill(json({ counts: {} })));
  await page.route("**/api/courses", (r: Route) => r.fulfill(json({ courses: getCourses().map(apiCourse) })));
  await page.route("**/api/courses/completions", (r: Route) => r.fulfill(json({ completions: completions() })));
  await page.route(/\/api\/courses\/c(?!ompletions)[^/?]*$/, (r: Route) => {
    const id = new URL(r.request().url()).pathname.split("/").pop()!;
    return r.fulfill(json({ course: { id, title: id, items: [{ type: "SECTION", sectionId: `${id}-s1`, courseItemId: `${id}-ci1`, title: "Seksjon", read: false }] } }));
  });
}

const item = (page: Page, id: string) => page.locator(`.course-accordion-item[data-course-id="${id}"]`).first();

test.describe("#1137 seilbåten på fremdriftslinja", () => {
  test("ikke påbegynt har tom linje uten båt; i gang har båt; fullført har hel grønn linje uten båt", async ({ page }) => {
    await mockBase(page, () => [
      { id: "cNot", title: "Ikke startet", done: 0, total: 8, status: "NOT_STARTED" },
      { id: "cRun", title: "I gang", done: 3, total: 8, status: "IN_PROGRESS" },
      { id: "cDone", title: "Ferdig", done: 8, total: 8, status: "COMPLETED" },
    ], () => [{ courseId: "cDone", certificateId: "cert-1", completedAt: "2026-10-01T10:00:00.000Z", courseTitle: "Ferdig" }]);
    await page.goto("/participant");
    await expect(item(page, "cRun")).toBeVisible();

    // Ikke påbegynt: linja finnes, er tom, og har ingen båt.
    await expect(item(page, "cNot").locator(".course-progress-bar")).toHaveCount(1);
    await expect(item(page, "cNot").locator(".course-boat")).toHaveCount(0);
    await expect(item(page, "cNot").locator(".course-progress-fill")).toHaveAttribute("style", /width:0%/);

    // I gang: én båt, skjult for skjermleser; linja er uendret som progressbar.
    await expect(item(page, "cRun").locator(".course-boat")).toHaveCount(1);
    await expect(item(page, "cRun").locator(".course-boat")).toHaveAttribute("aria-hidden", "true");
    await expect(item(page, "cRun").locator(".course-progress-bar")).toHaveAttribute("aria-valuenow", "38");

    // Fullført: hel grønn linje (opphever #939s «ingen linje»), ingen båt.
    const doneFill = item(page, "cDone").locator(".course-progress-fill");
    await expect(doneFill).toHaveClass(/completed/);
    await expect(doneFill).toHaveAttribute("style", /width:100%/);
    await expect(item(page, "cDone").locator(".course-boat")).toHaveCount(0);
    await expect(item(page, "cDone").locator(".course-progress-bar")).toHaveAttribute("aria-valuenow", "100");
  });

  test("linja fylles fra høyre, og båten står lenger til venstre jo lenger deltakeren har kommet", async ({ page }) => {
    await mockBase(page, () => [
      { id: "cLow", title: "Litt", done: 1, total: 10, status: "IN_PROGRESS" },
      { id: "cHigh", title: "Mye", done: 8, total: 10, status: "IN_PROGRESS" },
    ]);
    await page.goto("/participant");
    await expect(item(page, "cHigh").locator(".course-boat")).toHaveCount(1);

    for (const id of ["cLow", "cHigh"]) {
      const bar = await item(page, id).locator(".course-progress-bar").boundingBox();
      const fill = await item(page, id).locator(".course-progress-fill").boundingBox();
      // Det fylte ligger inntil HØYRE kant (kjølvannet bak båten), ikke venstre.
      expect(Math.abs((fill!.x + fill!.width) - (bar!.x + bar!.width))).toBeLessThan(1.5);
      expect(fill!.x - bar!.x).toBeGreaterThan(2);
    }

    const low = await item(page, "cLow").locator(".course-boat").boundingBox();
    const high = await item(page, "cHigh").locator(".course-boat").boundingBox();
    const lowBar = await item(page, "cLow").locator(".course-progress-bar").boundingBox();
    expect(high!.x - lowBar!.x).toBeLessThan(low!.x - lowBar!.x);
    // Hekken står på grensa mellom tomt og fylt: båtens venstrekant + 31 px ≈ fyllets venstrekant.
    const highFill = await item(page, "cHigh").locator(".course-progress-fill").boundingBox();
    expect(Math.abs(high!.x + 31 - highFill!.x)).toBeLessThan(2);
  });

  test("under 30 % flatt seil og én stripe; fra 30 % fullt seil og tre striper", async ({ page }) => {
    await mockBase(page, () => [
      { id: "c29", title: "29", done: 29, total: 100, status: "IN_PROGRESS" },
      { id: "c30", title: "30", done: 30, total: 100, status: "IN_PROGRESS" },
    ]);
    await page.goto("/participant");
    await expect(item(page, "c29").locator(".course-boat")).toHaveAttribute("data-boat-mood", "sulten");
    await expect(item(page, "c30").locator(".course-boat")).toHaveAttribute("data-boat-mood", "mett");
    const stripes = async (id: string) =>
      (await item(page, id).locator(".cb-stripes").getAttribute("d"))!.split("M").filter(Boolean).length;
    expect(await stripes("c29")).toBe(1);
    expect(await stripes("c30")).toBe(3);
  });

  test("ett steg av mange er et første steg, selv når prosenten rundes ned til 0", async ({ page }) => {
    await mockBase(page, () => [{ id: "cMany", title: "Mange steg", done: 1, total: 300, status: "IN_PROGRESS" }]);
    await page.goto("/participant");
    await expect(item(page, "cMany").locator(".course-boat")).toHaveCount(1);
  });

  test("når kurset fullføres i økta, kommer båten i mål, feirer og glir ut", async ({ page }) => {
    let finished = false;
    await mockBase(
      page,
      () => [{ id: "cGo", title: "Siste steg", done: finished ? 4 : 3, total: 4, status: finished ? "COMPLETED" : "IN_PROGRESS" }],
      () => (finished ? [{ courseId: "cGo", certificateId: "cert-go", completedAt: "2026-11-02T10:00:00.000Z", courseTitle: "Siste steg" }] : []),
    );
    await page.goto("/participant");
    await expect(item(page, "cGo").locator(".course-boat")).toHaveAttribute("data-boat-mood", "mett");

    await item(page, "cGo").locator(".course-accordion-header").click();
    await expect(page.locator("#courseBackBtn")).toBeVisible();
    finished = true;
    await page.locator("#courseBackBtn").click();

    const doneItem = item(page, "cGo");
    await expect(doneItem).toHaveClass(/course-accordion-item--done/);
    const boat = doneItem.locator(".course-boat");
    await expect(boat).toHaveAttribute("data-boat-mood", "feirer");
    await expect(boat.locator(".course-boat-confetti")).toHaveCount(1);
    // I mål ytterst til venstre på den grønne linja.
    const boatBox = await boat.boundingBox();
    const barBox = await doneItem.locator(".course-progress-bar").boundingBox();
    expect(Math.abs(boatBox!.x - barBox!.x)).toBeLessThan(40);
    await expect(doneItem.locator(".course-progress-fill")).toHaveClass(/completed/);
    // ...og så er den borte; linja står grønn igjen.
    await expect(boat).toHaveCount(0, { timeout: 7000 });
    await expect(doneItem.locator(".course-progress-fill")).toHaveClass(/completed/);
  });

  test("redusert bevegelse: ingen feiringsbåt ved fullføring, og ingen animasjon på båtene", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    let finished = false;
    await mockBase(
      page,
      () => [
        { id: "cGo", title: "Siste steg", done: finished ? 4 : 3, total: 4, status: finished ? "COMPLETED" : "IN_PROGRESS" },
        { id: "cRun", title: "I gang", done: 2, total: 4, status: "IN_PROGRESS" },
      ],
      () => (finished ? [{ courseId: "cGo", certificateId: "cert-go", completedAt: "2026-11-02T10:00:00.000Z", courseTitle: "Siste steg" }] : []),
    );
    await page.goto("/participant");
    const running = item(page, "cRun").locator(".course-boat");
    await expect(running).toHaveCount(1);
    expect(await running.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

    await item(page, "cGo").locator(".course-accordion-header").click();
    // Registrer om en feiringsbåt NOEN GANG legges inn. Å telle båter etterpå er blindt: en båt som
    // står stille (ingen animasjon) fjernes uansett av sikkerhetsnettet etter noen sekunder.
    await page.evaluate(() => {
      (window as unknown as { sawBoat: boolean }).sawBoat = false;
      new MutationObserver(() => {
        if (document.querySelector(".course-boat--feirer")) (window as unknown as { sawBoat: boolean }).sawBoat = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    finished = true;
    await page.locator("#courseBackBtn").click();
    await expect(item(page, "cGo")).toHaveClass(/course-accordion-item--done/);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { sawBoat: boolean }).sawBoat)).toBe(false);
    await expect(item(page, "cGo").locator(".course-boat")).toHaveCount(0);
    await expect(item(page, "cGo").locator(".course-progress-fill")).toHaveClass(/completed/);
  });

  for (const width of [360, 390]) {
    test(`${width} px: ingen vannrett rulling, båten inne i kortet, lange navn kolliderer ikke`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockBase(page, () => [
        { id: "cA", title: "Informasjonssikkerhet", done: 1, total: 16, status: "IN_PROGRESS" },
        { id: "cB", title: "Informasjonssikkerhetsopplæring", done: 7, total: 8, status: "IN_PROGRESS" },
        { id: "cC", title: "Informasjonssikkerhetsopplæring", done: 8, total: 8, status: "COMPLETED" },
      ], () => [{ courseId: "cC", certificateId: "cert-c", completedAt: "2026-10-01T10:00:00.000Z", courseTitle: "Informasjonssikkerhetsopplæring" }]);
      await page.goto("/participant");
      await expect(item(page, "cB").locator(".course-boat")).toHaveCount(1);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      for (const id of ["cA", "cB"]) {
        const boat = await item(page, id).locator(".course-boat").boundingBox();
        const card = await item(page, id).boundingBox();
        expect(boat!.x).toBeGreaterThanOrEqual(card!.x);
        expect(boat!.x + 32).toBeLessThanOrEqual(card!.x + card!.width);
      }

      // Fullført rad: tittel og «Kursbevis · Vis bevis» overlapper ikke.
      const title = await item(page, "cC").locator(".course-accordion-title").boundingBox();
      const cert = await item(page, "cC").locator(".course-certificate-link").boundingBox();
      const overlaps = title!.x < cert!.x + cert!.width && cert!.x < title!.x + title!.width
        && title!.y < cert!.y + cert!.height && cert!.y < title!.y + title!.height;
      expect(overlaps).toBe(false);
    });
  }
});
