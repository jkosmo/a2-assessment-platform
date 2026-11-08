import { test, expect, type Page, type Route } from "@playwright/test";

// #1137 — seilbåten på fremdriftslinja i «Mine kurs» (produkteier 2026-11-01/02).
//   - Båten seiler mot VENSTRE (2-tallet styrer fra høyre, som i logoen); linja fylles fra høyre.
//   - Bare kurs i gang har båt. Ikke påbegynt: tom linje. Fullført: hel grønn linje, ingen båt.
//   - Under 30 %: flatt seil og én stripe; fra 30 %: fullt seil og tre striper.
//   - Når kurset fullføres i økta: båten kommer i mål, feirer og glir ut. Redusert bevegelse: ingen båt.
// Alt er klientlag (posisjon, retning, animasjon) og usynlig for supertest.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

type Course = { id: string; title: string; done: number; total: number; status: string; themes?: Array<{ id: string; name: string }> };

function apiCourse(c: Course) {
  return {
    id: c.id,
    title: c.title,
    description: null,
    moduleCount: 0,
    progress: { completed: c.done, total: c.total, sectionCompleted: c.done, sectionTotal: c.total, courseStatus: c.status },
    themes: c.themes ?? [],
  };
}

async function mockBase(
  page: Page,
  getCourses: () => Course[],
  completions: () => unknown[] = () => [],
  { failCourses = () => false }: { failCourses?: () => boolean } = {},
) {
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
  await page.route("**/api/courses", (r: Route) => (failCourses()
    ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) })
    : r.fulfill(json({
      courses: getCourses().map(apiCourse),
      themes: [...new Map(getCourses().flatMap((c) => c.themes ?? []).map((th) => [th.id, th])).values()],
    }))));
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
    // Kontrollcase (fra participant-course-list-grouping.spec.ts): uten dette ville «grønn overalt» bestått sjekken under.
    await expect(item(page, "cRun").locator(".course-progress-fill")).not.toHaveClass(/completed/);

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

  // QA 2.130.0, funn 1: én bestått modul kan fullføre flere kurs samtidig. Bare det siste — og bare den
  // første temakopien — fikk båten; de andre hoppet rett til grønt.
  test("flere kurs fullført samtidig: hvert kort feirer, også temakopiene", async ({ page }) => {
    let finished = false;
    const t1 = { id: "t1", name: "Etikk" };
    const t2 = { id: "t2", name: "Sikkerhet" };
    await mockBase(
      page,
      () => [
        { id: "cA", title: "Kurs A", done: finished ? 2 : 1, total: 2, status: finished ? "COMPLETED" : "IN_PROGRESS", themes: [t1, t2] },
        { id: "cB", title: "Kurs B", done: finished ? 2 : 1, total: 2, status: finished ? "COMPLETED" : "IN_PROGRESS", themes: [t1] },
        { id: "cC", title: "Kurs C", done: 1, total: 4, status: "IN_PROGRESS", themes: [t2] },
      ],
      () => (finished ? ["cA", "cB"].map((courseId) => ({ courseId, certificateId: `cert-${courseId}`, completedAt: "2026-11-02T10:00:00.000Z", courseTitle: courseId })) : []),
    );
    await page.goto("/participant");
    await expect(page.locator('.course-accordion-item[data-course-id="cA"]')).toHaveCount(2);
    await item(page, "cC").locator(".course-accordion-header").click();
    await page.evaluate(() => {
      const w = window as unknown as { feiret: string[] };
      w.feiret = [];
      new MutationObserver((records) => {
        for (const r of records) for (const n of r.addedNodes) {
          if (n instanceof Element && n.matches(".course-boat--feirer")) {
            const card = n.closest(".course-accordion-item") as HTMLElement | null;
            w.feiret.push(`${card?.dataset.courseId}${card?.dataset.courseCopy ? "-kopi" : ""}`);
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    finished = true;
    await page.locator("#courseBackBtn").click();
    await expect(page.locator('.course-accordion-item--done[data-course-id="cB"]')).toHaveCount(1);
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as { feiret: string[] }).feiret)).sort())
      .toEqual(["cA", "cA-kopi", "cB"]);
  });

  // QA 2.130.1: en delt modul bestås INNE i et kurs. Lista lastes på nytt mens kurset er åpent og lista er
  // skjult; søsterkursene ble «feiret» der ingen så det, og kunne ikke feires igjen. Båtene skal vente til
  // deltakeren går tilbake til lista. (Omtegningen mens kurset er åpent utløses her med et språkbytte, som
  // laster lista på nytt slik en bestått modul gjør.)
  test("kurs fullført mens et kurs er åpent: båtene venter, og feirer når lista vises igjen", async ({ page }) => {
    let finished = false;
    const t1 = { id: "t1", name: "Etikk" };
    const t2 = { id: "t2", name: "Sikkerhet" };
    await mockBase(
      page,
      () => [
        { id: "cA", title: "Kurs A", done: finished ? 2 : 1, total: 2, status: finished ? "COMPLETED" : "IN_PROGRESS", themes: [t1, t2] },
        { id: "cB", title: "Kurs B", done: finished ? 2 : 1, total: 2, status: finished ? "COMPLETED" : "IN_PROGRESS", themes: [t1] },
        { id: "cC", title: "Kurs C", done: 1, total: 4, status: "IN_PROGRESS", themes: [t2] },
      ],
      () => (finished ? ["cA", "cB"].map((courseId) => ({ courseId, certificateId: `cert-${courseId}`, completedAt: "2026-11-02T10:00:00.000Z", courseTitle: courseId })) : []),
    );
    await page.goto("/participant");
    await item(page, "cC").locator(".course-accordion-header").click();
    await expect(page.locator("#courseBackBtn")).toBeVisible();
    await page.evaluate(() => {
      const w = window as unknown as { feiret: string[] };
      w.feiret = [];
      new MutationObserver((records) => {
        for (const r of records) for (const n of r.addedNodes) {
          if (n instanceof Element && n.matches(".course-boat--feirer")) {
            const card = n.closest(".course-accordion-item") as HTMLElement | null;
            w.feiret.push(`${card?.dataset.courseId}${card?.dataset.courseCopy ? "-kopi" : ""}`);
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });

    finished = true;
    const reloaded = page.waitForResponse((r) => r.url().endsWith("/api/courses"));
    await page.selectOption("#localeSelect", "nn");
    await reloaded;
    await expect(page.locator('.course-accordion-item--done[data-course-id="cB"]')).toHaveCount(1);
    await page.waitForTimeout(300);
    // Lista er skjult: ingen båt har feiret ennå.
    expect(await page.evaluate(() => (window as unknown as { feiret: string[] }).feiret)).toEqual([]);

    await page.locator("#courseBackBtn").click();
    // Båtene starter på kortene som står i det fokus fjernes, og startes igjen der de var når den nye lastingen
    // tegner lista på nytt (#1137, oppfølgingen). Det som teller her, er hvilke kort som feiret.
    await expect.poll(async () => [...new Set(await page.evaluate(() => (window as unknown as { feiret: string[] }).feiret))].sort())
      .toEqual(["cA", "cA-kopi", "cB"]);
  });

  // QA 2.130.0, funn 3: med 1 av 300 steg sto båten helt til høyre, og stripa bak den falt utenfor linja,
  // der den ble klippet bort.
  test("fartsstripa er alltid inne på linja, også ved første steg av mange", async ({ page }) => {
    await mockBase(page, () => [
      { id: "cMany", title: "Mange steg", done: 1, total: 300, status: "IN_PROGRESS" },
      { id: "cHalf", title: "Halvveis", done: 30, total: 100, status: "IN_PROGRESS" },
    ]);
    await page.goto("/participant");
    for (const id of ["cMany", "cHalf"]) {
      const stripe = await item(page, id).locator(".cb-stripes").boundingBox();
      const track = await item(page, id).locator(".course-progress").boundingBox();
      expect(stripe, id).not.toBeNull();
      expect(stripe!.x + stripe!.width, id).toBeLessThanOrEqual(track!.x + track!.width);
      expect(stripe!.x, id).toBeGreaterThanOrEqual(track!.x);
    }
  });

  // QA 2.130.0, funn 4: et fullført kurs med 5 av 6 steg (en mindre versjon la til et steg; beviset står)
  // viste hel linje men etiketten «5 av 6 steg».
  test("fullført med 5 av 6 steg: verdi, bredde, etikett og verktøytips sier alle «fullført»", async ({ page }) => {
    await mockBase(page, () => [{ id: "cGrown", title: "Vokste", done: 5, total: 6, status: "IN_PROGRESS" }],
      () => [{ courseId: "cGrown", certificateId: "cert-g", completedAt: "2026-10-01T10:00:00.000Z", courseTitle: "Vokste" }]);
    await page.goto("/participant");
    const bar = item(page, "cGrown").locator(".course-progress-bar");
    await expect(bar).toHaveAttribute("aria-valuenow", "100");
    await expect(bar).toHaveAttribute("aria-label", "Fullført");
    await expect(bar).toHaveAttribute("title", "Fullført");
    await expect(item(page, "cGrown").locator(".course-progress-fill")).toHaveAttribute("style", /width:100%/);
    // QA 2.130.1: raden selv må heller ikke si «5/6» ved siden av den grønne «Fullført»-linja.
    await expect(item(page, "cGrown")).not.toContainText("5/6");
    await expect(item(page, "cGrown").locator(".course-accordion-progress")).toHaveCount(0);
    // Fra «#939 funn A» i participant-course-list-grouping.spec.ts (testgjennomgangen 2026-11, avsnitt 4.1): raden er en
    // fullført rad, grønn uten båt, og beholder lenka til kursbeviset.
    await expect(item(page, "cGrown")).toHaveClass(/course-accordion-item--done/);
    await expect(item(page, "cGrown").locator(".course-progress-fill")).toHaveClass(/completed/);
    await expect(item(page, "cGrown").locator(".course-boat")).toHaveCount(0);
    await expect(item(page, "cGrown").locator(".course-certificate-link")).toHaveAttribute("href", "/certificate?id=cert-g");
  });

  test("kontroll: et fullført kurs med full telling viser tellingen i raden", async ({ page }) => {
    await mockBase(page, () => [{ id: "cFull", title: "Ferdig", done: 6, total: 6, status: "COMPLETED" }],
      () => [{ courseId: "cFull", certificateId: "cert-f", completedAt: "2026-10-01T10:00:00.000Z", courseTitle: "Ferdig" }]);
    await page.goto("/participant");
    await expect(item(page, "cFull").locator(".course-accordion-progress")).toContainText("6/6");
  });

  test("kontroll: et kurs i gang har stegtellingen som etikett", async ({ page }) => {
    await mockBase(page, () => [{ id: "cRun", title: "I gang", done: 5, total: 6, status: "IN_PROGRESS" }]);
    await page.goto("/participant");
    await expect(item(page, "cRun").locator(".course-progress-bar")).toHaveAttribute("aria-label", /5 av 6 steg/);
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

// ── Oppfølgingen av #1137 (QA av 2.130.1) ─────────────────────────────────────────────────────────────────────────────

type BoatEvent = { kind: "add" | "remove"; card: string; at: number; delay: string };

/** Logger hver feiringsbåt som legges til eller fjernes, med kort og tidspunkt (performance.now() i siden). */
async function watchCelebrations(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { boatEvents: BoatEvent[] };
    w.boatEvents = [];
    const cardOf = (n: Element, parent: Node | null) => {
      const card = ((n.isConnected ? n : parent) as Element | null)?.closest?.(".course-accordion-item") as HTMLElement | null;
      return card ? `${card.dataset.courseId}${card.dataset.courseCopy ? "-kopi" : ""}` : "?";
    };
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n instanceof HTMLElement && n.matches(".course-boat--feirer")) {
            w.boatEvents.push({ kind: "add", card: cardOf(n, r.target), at: performance.now(), delay: n.style.animationDelay });
          }
        }
        for (const n of r.removedNodes) {
          if (n instanceof HTMLElement && n.matches(".course-boat--feirer")) {
            w.boatEvents.push({ kind: "remove", card: "", at: performance.now(), delay: "" });
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

const boatEvents = (page: Page) => page.evaluate(() => (window as unknown as { boatEvents: BoatEvent[] }).boatEvents);

/** Fullfører kurset «cGo» i økta: inn i kurset, og tilbake til lista når det er fullført. */
async function finishCourseInSession(page: Page, extra: Course[] = [], themes?: Course["themes"]) {
  let finished = false;
  await mockBase(
    page,
    () => [
      { id: "cGo", title: "Siste steg", done: finished ? 4 : 3, total: 4, status: finished ? "COMPLETED" : "IN_PROGRESS", themes },
      ...extra,
    ],
    () => (finished ? [{ courseId: "cGo", certificateId: "cert-go", completedAt: "2026-11-02T10:00:00.000Z", courseTitle: "Siste steg" }] : []),
  );
  await page.goto("/participant");
  await item(page, "cGo").locator(".course-accordion-header").click();
  await expect(page.locator("#courseBackBtn")).toBeVisible();
  await watchCelebrations(page);
  finished = true;
  await page.locator("#courseBackBtn").click();
  await expect(item(page, "cGo").locator(".course-boat--feirer")).toHaveCount(1);
}

test.describe("#1137 oppfølging: smale linjer, omtegning midt i feiringen, rulling og kø", () => {
  // Punkt 1: på en linje smalere enn stripenes rekkevidde (48 px med flatt seil, 56 px med fullt) ble
  // `100% - <rekkevidde>` negativ, og båten sto i venstre kant uansett fremdrift. Der gjelder hekkregelen alene.
  test("smal linje: båten følger hekkregelen; bred nok linje: stripegrensen gjelder som før", async ({ page }) => {
    await mockBase(page, () => [
      { id: "c10", title: "Ti", done: 1, total: 10, status: "IN_PROGRESS" },       // 10 %, flatt seil, rekkevidde 48
      { id: "c30", title: "Tretti", done: 3, total: 10, status: "IN_PROGRESS" },   // 30 %, fullt seil, rekkevidde 56
      { id: "cFirst", title: "Første", done: 1, total: 300, status: "IN_PROGRESS" }, // 0 % (ett steg), flatt seil
    ]);
    await page.goto("/participant");
    await expect(item(page, "c30").locator(".course-boat")).toHaveCount(1);

    /** Båtens venstrekant fra linjas venstrekant, med linja satt til `width` px. Ren CSS: bare bredden endres. */
    const leftAt = (id: string, width: number) => item(page, id).locator(".course-progress").evaluate((el: HTMLElement, w) => {
      el.style.width = `${w}px`;
      const boat = el.querySelector(".course-boat")!.getBoundingClientRect();
      return boat.left - el.getBoundingClientRect().left;
    }, width);
    const stern = (pct: number, width: number) => Math.max(0, (1 - pct / 100) * width - 31);

    // Smalere enn rekkevidden: hekken på grensa mellom tomt og fylt (før: 0 px for alle tre).
    expect(await leftAt("c10", 45)).toBeCloseTo(stern(10, 45), 0); // 9,5 px
    expect(await leftAt("c30", 54)).toBeCloseTo(stern(30, 54), 0); // 6,8 px
    expect(await leftAt("cFirst", 40)).toBeCloseTo(stern(0, 40), 0); // 9 px

    // Kontroll: bred nok linje. Stripegrensen holder båten igjen, så stripene ikke klippes.
    expect(await leftAt("cFirst", 50)).toBeCloseTo(50 - 48, 0);    // hekkregelen alene ville gitt 19 px
    expect(await leftAt("c30", 60)).toBeCloseTo(60 - 56, 0);       // hekkregelen alene ville gitt 11 px
    expect(await leftAt("cFirst", 200)).toBeCloseTo(200 - 48, 0);  // hekkregelen alene ville gitt 169 px
    expect(await leftAt("c10", 300)).toBeCloseTo(stern(10, 300), 0); // innenfor begge: hekkregelen
  });

  // Punkt 2: et språkbytte tegner lista på nytt, og båten forsvant midt i feiringen (4,2 s).
  test("språkbytte midt i feiringen: båten fortsetter der den var, og er borte når den opprinnelige tiden er ute", async ({ page }) => {
    test.setTimeout(20_000);
    await finishCourseInSession(page);
    const first = (await boatEvents(page)).find((e) => e.kind === "add")!;

    await page.waitForTimeout(1500);
    const reloaded = page.waitForResponse((r) => r.url().endsWith("/api/courses"));
    await page.selectOption("#localeSelect", "nn");
    await reloaded;
    // Lista er tegnet på nytt (nynorsk), og kortet har fått en ny båt som er kommet like langt.
    await expect(page.locator("#courseBackBtn")).toBeHidden();
    await expect.poll(async () => (await boatEvents(page)).filter((e) => e.kind === "add").length).toBe(2);
    await expect(item(page, "cGo").locator(".course-boat--feirer")).toHaveCount(1);
    const resumed = (await boatEvents(page)).filter((e) => e.kind === "add")[1]!;
    const delay = -Number.parseFloat(resumed.delay);
    expect(delay).toBeGreaterThan(resumed.at - first.at - 300);
    expect(delay).toBeLessThan(resumed.at - first.at + 300);

    // Ferdig når de 4,2 s fra første start er ute, ikke 4,2 s etter omtegningen.
    await expect(item(page, "cGo").locator(".course-boat")).toHaveCount(0, { timeout: 6000 });
    const gone = (await boatEvents(page)).filter((e) => e.kind === "remove").at(-1)!;
    expect(gone.at - first.at).toBeGreaterThan(4200 - 400);
    expect(gone.at - first.at).toBeLessThan(4200 + 700);
    await expect(item(page, "cGo").locator(".course-progress-fill")).toHaveClass(/completed/);
  });

  // Sikkerhetsnettet (for en fane i bakgrunnen, der animasjonshendelsen kan bli holdt igjen) regner også fra første start.
  test("omtegning midt i feiringen uten animasjonshendelse: sikkerhetsnettet rydder når den opprinnelige tiden er ute", async ({ page }) => {
    test.setTimeout(20_000);
    await finishCourseInSession(page);
    const first = (await boatEvents(page)).find((e) => e.kind === "add")!;
    await page.waitForTimeout(1500);
    const reloaded = page.waitForResponse((r) => r.url().endsWith("/api/courses"));
    await page.selectOption("#localeSelect", "nn");
    await reloaded;
    await expect.poll(async () => (await boatEvents(page)).filter((e) => e.kind === "add").length).toBe(2);
    // Animasjonen står stille, så `animationend` kommer aldri: bare sikkerhetsnettet kan fjerne båten.
    await page.evaluate(() => { for (const animation of document.getAnimations()) animation.pause(); });

    await expect(item(page, "cGo").locator(".course-boat")).toHaveCount(0, { timeout: 7000 });
    const gone = (await boatEvents(page)).filter((e) => e.kind === "remove").at(-1)!;
    // 4,2 s + 0,4 s fra første start, ikke fra omtegningen (det ville vært rundt 6,1 s).
    expect(gone.at - first.at).toBeGreaterThan(4200);
    expect(gone.at - first.at).toBeLessThan(4600 + 500);
    await expect(item(page, "cGo").locator(".course-progress--celebrating")).toHaveCount(0);
  });

  test("visningsbytte midt i feiringen: båten fortsetter på kortene i den nye visningen", async ({ page }) => {
    const t1 = { id: "t1", name: "Etikk" };
    await finishCourseInSession(page, [{ id: "cRun", title: "I gang", done: 1, total: 4, status: "IN_PROGRESS", themes: [t1] }], [t1]);
    await page.waitForTimeout(800);
    await page.locator('.course-view-btn[data-view="alphabetical"]').click();
    await expect(page.locator('.course-view-btn[data-view="alphabetical"]')).toHaveAttribute("aria-pressed", "true");
    await expect(item(page, "cGo").locator(".course-boat--feirer")).toHaveCount(1);
    const adds = (await boatEvents(page)).filter((e) => e.kind === "add");
    expect(adds).toHaveLength(2);
    expect(-Number.parseFloat(adds[1]!.delay)).toBeGreaterThan(600);
  });

  // Punkt 3: rullingen til det fullførte kurset skjedde i det kursene ble fullført, mens kortene var skjult.
  test("lang liste: kurs fullført mens et kurs er åpent rulles fram når lista vises igjen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    let finished = false;
    const fillers: Course[] = Array.from({ length: 24 }, (_, i) => ({
      id: `cFill${String(i).padStart(2, "0")}`, title: `Kurs ${i + 1}`, done: 1, total: 4, status: "IN_PROGRESS",
    }));
    await mockBase(
      page,
      () => [
        { id: "cA", title: "Kurs A", done: finished ? 2 : 1, total: 2, status: finished ? "COMPLETED" : "IN_PROGRESS" },
        { id: "cC", title: "Kurs C", done: 1, total: 4, status: "IN_PROGRESS" },
        ...fillers,
      ],
      () => (finished ? [{ courseId: "cA", certificateId: "cert-cA", completedAt: "2026-11-02T10:00:00.000Z", courseTitle: "Kurs A" }] : []),
    );
    await page.goto("/participant");
    await item(page, "cC").locator(".course-accordion-header").click();
    await expect(page.locator("#courseBackBtn")).toBeVisible();

    // Kurs A fullføres mens kurs C er åpent (lista lastes på nytt, slik en bestått delt modul gjør).
    finished = true;
    const reloaded = page.waitForResponse((r) => r.url().endsWith("/api/courses"));
    await page.selectOption("#localeSelect", "nn");
    await reloaded;
    await expect(page.locator('.course-accordion-item--done[data-course-id="cA"]')).toHaveCount(1);

    await page.locator("#courseBackBtn").click();
    // Kurs A står nå nederst, under «Fullført», etter 25 kurs i gang: det må rulles fram for å synes.
    await expect(item(page, "cA")).toBeInViewport({ ratio: 0.9 });
    await expect(item(page, "cA").locator(".course-boat--feirer")).toHaveCount(1);
    // Kontroll: lista er lengre enn skjermen, så det var rullingen som førte kortet fram.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(700 * 2);
    await expect(item(page, "cC")).not.toBeInViewport();
  });

  // Punkt 4: køen ble bare tømt ved en vellykket ny lasting. Feilet den, ble de ventende båtene aldri vist.
  test("ny lasting feiler når deltakeren går tilbake: de ventende båtene feirer på kortene som står", async ({ page }) => {
    let finished = false;
    let failing = false;
    const t1 = { id: "t1", name: "Etikk" };
    const t2 = { id: "t2", name: "Sikkerhet" };
    await mockBase(
      page,
      () => [
        { id: "cA", title: "Kurs A", done: finished ? 2 : 1, total: 2, status: finished ? "COMPLETED" : "IN_PROGRESS", themes: [t1, t2] },
        { id: "cB", title: "Kurs B", done: finished ? 2 : 1, total: 2, status: finished ? "COMPLETED" : "IN_PROGRESS", themes: [t1] },
        { id: "cC", title: "Kurs C", done: 1, total: 4, status: "IN_PROGRESS", themes: [t2] },
      ],
      () => (finished ? ["cA", "cB"].map((courseId) => ({ courseId, certificateId: `cert-${courseId}`, completedAt: "2026-11-02T10:00:00.000Z", courseTitle: courseId })) : []),
      { failCourses: () => failing },
    );
    await page.goto("/participant");
    await item(page, "cC").locator(".course-accordion-header").click();
    await expect(page.locator("#courseBackBtn")).toBeVisible();
    await watchCelebrations(page);

    finished = true;
    const reloaded = page.waitForResponse((r) => r.url().endsWith("/api/courses"));
    await page.selectOption("#localeSelect", "nn");
    await reloaded;
    await expect(page.locator('.course-accordion-item--done[data-course-id="cB"]')).toHaveCount(1);
    expect(await boatEvents(page)).toEqual([]);

    failing = true;
    const failed = page.waitForResponse((r) => r.url().endsWith("/api/courses") && r.status() === 500);
    await page.locator("#courseBackBtn").click();
    await failed;
    await expect.poll(async () => (await boatEvents(page)).filter((e) => e.kind === "add").map((e) => e.card).sort())
      .toEqual(["cA", "cA-kopi", "cB"]);
    await expect(page.locator(".course-boat--feirer")).toHaveCount(3);
  });

  test("kontroll: ny lasting lykkes når deltakeren går tilbake — hvert kort feirer, med én båt om gangen", async ({ page }) => {
    let finished = false;
    const t1 = { id: "t1", name: "Etikk" };
    await mockBase(
      page,
      () => [
        { id: "cA", title: "Kurs A", done: finished ? 2 : 1, total: 2, status: finished ? "COMPLETED" : "IN_PROGRESS", themes: [t1] },
        { id: "cC", title: "Kurs C", done: 1, total: 4, status: "IN_PROGRESS", themes: [t1] },
      ],
      () => (finished ? [{ courseId: "cA", certificateId: "cert-cA", completedAt: "2026-11-02T10:00:00.000Z", courseTitle: "Kurs A" }] : []),
    );
    await page.goto("/participant");
    await item(page, "cC").locator(".course-accordion-header").click();
    await expect(page.locator("#courseBackBtn")).toBeVisible();
    finished = true;
    const reloaded = page.waitForResponse((r) => r.url().endsWith("/api/courses"));
    await page.selectOption("#localeSelect", "nn");
    await reloaded;
    await expect(page.locator('.course-accordion-item--done[data-course-id="cA"]')).toHaveCount(1);

    const reloadedAgain = page.waitForResponse((r) => r.url().endsWith("/api/courses"));
    await page.locator("#courseBackBtn").click();
    await reloadedAgain;
    await expect(item(page, "cA").locator(".course-boat--feirer")).toHaveCount(1);
    await page.waitForTimeout(300);
    await expect(page.locator(".course-boat--feirer")).toHaveCount(1);
    await expect(page.locator(".course-progress--celebrating")).toHaveCount(1);
  });
});
