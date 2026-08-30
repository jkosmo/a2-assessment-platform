import { test, expect, type Page, type Route } from "@playwright/test";

// #1027: serveren baker inn språket når køen HENTES. Klienten må derfor hente på nytt ved
// språkbytte — før gjorde klientparseren jobben per rendering, så byttet slo inn av seg selv.
//
// ⚠️ HVORFOR E2E OG IKKE ENHETSTEST. Første fiks sjekket om kø-elementene FANTES i DOM-en. Begge
// finnes alltid, uansett rolle. En enhetstest på funksjonen ville vært grønn — det er FLATEN som
// avslører at en ren sensor da fikk 403 på en kø hen ikke har lov til å se.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const TITLES: Record<string, string> = { nb: "Hendelseshåndtering", "en-GB": "Incident response" };

function reviewRow(locale: string) {
  return {
    id: "rev-1",
    reviewStatus: "OPEN",
    triggerReason: "manual",
    reviewerId: null,
    reviewedAt: null,
    createdAt: "2026-08-27T10:00:00.000Z",
    reviewer: null,
    submission: {
      id: "sub-1",
      submittedAt: "2026-08-27T09:00:00.000Z",
      deliveryType: "text",
      response: { response: "Et svar." },
      user: { id: "u-1", name: "Kandidat", email: "k@x.no", department: "Fag" },
      // Serveren sender en FERDIG streng på leserens språk — det er hele poenget med #1027.
      module: { id: "m-1", title: TITLES[locale] ?? TITLES["en-GB"], titleSearch: Object.values(TITLES), description: null },
      moduleVersion: { id: "mv-1" },
      mcqAttempts: [],
      llmEvaluations: [],
      decisions: [],
      appeals: [],
    },
  };
}

async function mockReviewerOnly(page: Page, appealCalls: string[], opts: { delayFor?: string; delayMs?: number; reviewCalls?: string[] } = {}) {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ }
  });
  await page.route("**/participant/config", (r: Route) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { reviewer: { userId: "rev-user", email: "r@x.no", name: "Sensor", roles: ["REVIEWER"] } },
    calibrationWorkspace: { accessRoles: [] },
  })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (r: Route) => r.fulfill(json({
    user: { id: "rev-user", roles: ["REVIEWER"] },
    consent: { accepted: true, currentVersion: "1.0" },
  })));
  await page.route("**/api/queue-counts", (r: Route) => r.fulfill(json({ counts: {} })));

  // Serveren svarer etter x-locale, slik den ekte gjør.
  await page.route("**/api/reviews?**", async (r: Route) => {
    opts.reviewCalls?.push(r.request().url());
    const locale = r.request().headers()["x-locale"] ?? "en-GB";
    if (opts.delayFor && locale === opts.delayFor) {
      await new Promise((res) => setTimeout(res, opts.delayMs ?? 900));
    }
    return r.fulfill(json({ reviews: [reviewRow(locale)] }));
  });
  await page.route("**/api/reviews/rev-1", (r: Route) => r.fulfill(json({ review: reviewRow("nb") })));

  // ⚠️ Sensoren har ikke klagerollen. Den ekte serveren svarer 403 her; vi gjør det samme og
  // teller hvert kall, slik at et kall blir SYNLIG i stedet for å bli slukt av en tom liste.
  await page.route("**/api/appeals**", (r: Route) => {
    appealCalls.push(r.request().url());
    return r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "forbidden", message: "Nei." }) });
  });
}

test.describe("#1027 — språkbytte henter køen på nytt, uten å be om det man ikke har lov til", () => {
  test("en ren sensor utløser ALDRI et kall mot klagekøen ved språkbytte", async ({ page }) => {
    const appealCalls: string[] = [];
    await mockReviewerOnly(page, appealCalls);
    await page.goto("/review");

    await expect(page.locator("#manualReviewQueueBody")).toContainText("Hendelseshåndtering");

    // ⚠️ Vi måler DIFFERANSEN, ikke totalen. Sidelastingen gjør ett kall mot klagekøen selv for en
    // ren sensor — det kommer fra mock-innloggingens standardroller i review.html og er en egen
    // sak (#1039), ikke denne. Blandet vi dem sammen, ville testen enten vært rød av feil grunn
    // eller måttet godta «ett kall er greit» — og da ville regresjonen sluppet gjennom som nummer to.
    const beforeSwitch = appealCalls.length;

    await page.selectOption("#localeSelect", "en-GB");
    await expect(page.locator("#manualReviewQueueBody")).toContainText("Incident response");
    await page.selectOption("#localeSelect", "nb");
    await expect(page.locator("#manualReviewQueueBody")).toContainText("Hendelseshåndtering");

    expect(appealCalls.length - beforeSwitch, `klagekøen ble hentet av en ren sensor ved språkbytte`).toBe(0);
  });

  test("ingen rød feilmelding dukker opp ved språkbytte", async ({ page }) => {
    const appealCalls: string[] = [];
    await mockReviewerOnly(page, appealCalls);
    await page.goto("/review");
    await expect(page.locator("#manualReviewQueueBody")).toContainText("Hendelseshåndtering");
    const redToastsBeforeSwitch = await page.locator(".toast--error").count();

    await page.selectOption("#localeSelect", "en-GB");
    await expect(page.locator("#manualReviewQueueBody")).toContainText("Incident response");

    // ⚠️ Makkeren til påstanden over: uten denne ville testen vært grønn også for en side som
    // stille lot 403-en falle på gulvet uten å hente køen på nytt.
    //
    // ⚠️ To fallgruver i én linje. Velgeren MÅ stemme med `toast.js` — klassen er `toast--error`,
    // og min første utgave sto med `.toast.error`, som ikke finnes: da er `toHaveCount(0)` sann
    // uansett hva siden gjør. Og tellingen må være en DIFFERANSE, for sidelastingen legger igjen
    // en rød toast av seg selv (#1039). Med absolutt telling var testen først grønn av feil grunn,
    // så rød av feil grunn.
    await expect(page.locator(".toast--error")).toHaveCount(redToastsBeforeSwitch);
  });

  // ⚠️ QA-runde 5, og den skarpeste hittil: språkfiksen la en BIVIRKNING i `setLocale`, som
  // oppstarten også kaller. Kallet gikk ut 1 ms etter config-forespørselen — før roller og token
  // fantes. I mock ga det 403 fra HTML-ens reserveroller; med ekte pålogging går kallet uten
  // Bearer og gir 401. Rød feilmelding ved HVER lasting av siden, for alle.
  //
  // ⚠️ Og jeg meldte dette som en EKSISTERENDE sak (#1039). Det var det ikke — kallstien kom med
  // min egen commit. Ingen test målte kall ved sidelasting, bare rundt språkbyttet.
  test("oppstarten sender ikke kø-kall før roller og token finnes", async ({ page }) => {
    const appealCalls: string[] = [];
    const reviewCalls: string[] = [];
    let configSeenAt = 0;
    const callTimes: number[] = [];

    await page.route("**/participant/config", async () => { /* erstattes under */ });
    await page.unroute("**/participant/config");
    await mockReviewerOnly(page, appealCalls, { reviewCalls });

    // Merk når config svarer, og når kø-kallene går ut.
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("/participant/config")) configSeenAt = Date.now();
      if (u.includes("/api/reviews?") || u.includes("/api/appeals")) callTimes.push(Date.now());
    });

    await page.goto("/review");
    await expect(page.locator("#manualReviewQueueBody")).toContainText("Hendelseshåndtering");

    // Oppstarten skal hente køen ÉN gang, gjennom den rollestyrte stien — ikke to ganger fordi
    // `setLocale` også fyrte. To kall her er signaturen på bivirkningen.
    expect(reviewCalls.length, `køen ble hentet ${reviewCalls.length} ganger ved oppstart`).toBe(1);
    expect(appealCalls, "en ren sensor skal ikke hente klagekøen ved oppstart").toEqual([]);
    expect(configSeenAt, "config skal være forespurt").toBeGreaterThan(0);
  });

  // ⚠️ QA-runde 5, falskt grønt nr. 7: porten fjernet `titleSearch` fra BEGGE søkefiltrene og hele
  // e2e-suiten forble grønn, 285 av 285. Klient-halvdelen av søkefiksen — det saken eksplisitt
  // handler om — hadde ingen test som kunne bli rød.
  //
  // Serveren sender variantene; ingen målte at klienten faktisk BRUKER dem.
  test("en sensor på norsk finner saken ved å søke på den engelske tittelen", async ({ page }) => {
    const appealCalls: string[] = [];
    await mockReviewerOnly(page, appealCalls);
    await page.goto("/review");
    await expect(page.locator("#manualReviewQueueBody")).toContainText("Hendelseshåndtering");

    // Søket gjøres på ENGELSK mens siden står på norsk. Uten `titleSearch` blir køen tom.
    await page.fill("#mrQueueSearch", "Incident response");
    await expect(page.locator("#manualReviewQueueBody")).toContainText("Hendelseshåndtering");

    // Kontrollcase: et ord som ikke finnes i noen språkvariant skal faktisk tømme køen. Uten
    // denne ville testen vært grønn også for et filter som aldri filtrerer.
    await page.fill("#mrQueueSearch", "zzz-finnes-ikke");
    await expect(page.locator("#manualReviewQueueBody")).not.toContainText("Hendelseshåndtering");
  });

  // ⚠️ QA-runde 6, falskt grønt nr. 9: porten fjernet `titleSearch` fra KLAGEKØENS filter alene, og
  // hele e2e-suiten forble grønn — 289 av 289. Testen over dekket bare sensorkøen.
  //
  // To like filtre, to like linjer kode, én test. Nøyaktig samme form som feilen saken handler om:
  // rettet begge steder, prøvd ett av dem.
  test("en klagebehandler på norsk finner saken ved å søke på den engelske tittelen", async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ }
    });
    const handler = { userId: "app-user", email: "a@x.no", name: "Klagebehandler", roles: ["APPEAL_HANDLER"] };
    await page.route("**/participant/config", (r: Route) => r.fulfill(json({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { reviewer: handler },
      calibrationWorkspace: { accessRoles: [] },
    })));
    await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
    await page.route("**/api/me", (r: Route) => r.fulfill(json({
      user: { id: "app-user", roles: ["APPEAL_HANDLER"] },
      consent: { accepted: true, currentVersion: "1.0" },
    })));
    await page.route("**/api/queue-counts", (r: Route) => r.fulfill(json({ counts: {} })));
    await page.route("**/api/reviews?**", (r: Route) => r.fulfill(json({ reviews: [] })));
    await page.route("**/api/appeals**", (r: Route) => r.fulfill(json({
      appeals: [{
        id: "ap-1",
        appealStatus: "OPEN",
        appealReason: "Uenig i vurderingen",
        createdAt: "2026-08-27T10:00:00.000Z",
        claimedAt: null,
        resolvedAt: null,
        appealedBy: { id: "u-1", name: "Kandidat", email: "k@x.no" },
        resolvedBy: null,
        sla: { state: "ok" },
        submission: {
          id: "sub-1",
          submittedAt: "2026-08-27T09:00:00.000Z",
          submissionStatus: "UNDER_REVIEW",
          user: { id: "u-1", name: "Kandidat", email: "k@x.no", department: "Fag" },
          // Serveren sender ferdig tittel PLUSS alle variantene til søk.
          module: { id: "m-1", title: TITLES.nb, titleSearch: Object.values(TITLES), description: null },
          latestDecision: null,
        },
      }],
    })));

    await page.goto("/review");
    // ⚠️ Ingen faneklikk: #975 skjuler hele fanestripa når brukeren har bare ÉN rolle, og viser
    // panelet direkte. Første utgave av testen klikket på fanen og gikk i tidsavbrudd.
    await expect(page.locator("#appealQueueBody")).toContainText("Hendelseshåndtering");

    // Søk på ENGELSK mens siden står på norsk. Uten `titleSearch` blir køen tom.
    await page.fill("#appealQueueSearch", "Incident response");
    await expect(page.locator("#appealQueueBody")).toContainText("Hendelseshåndtering");

    // Kontrollcase: filteret skal faktisk filtrere.
    await page.fill("#appealQueueSearch", "zzz-finnes-ikke");
    await expect(page.locator("#appealQueueBody")).not.toContainText("Hendelseshåndtering");
  });
});
