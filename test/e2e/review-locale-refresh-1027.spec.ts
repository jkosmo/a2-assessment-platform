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

async function mockReviewerOnly(page: Page, appealCalls: string[], opts: { delayFor?: string; delayMs?: number } = {}) {
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

  // ⚠️ QA-runde 4: språkvakta i `loadReviewQueue` hadde INGEN test som kunne bli rød. Porten
  // fjernet språksjekken i begge vaktene, og hele e2e-suiten forble grønn — 280 av 280.
  //
  // Jeg hadde mutasjonsverifisert DOM-sjekken (funn A) og skrevet at vakta var dekket. Det var to
  // ulike fikser, og bare den ene ble prøvd.
  test("et språkbytte MENS køen lastes blir ikke slukt av enkeltflyt-vakta", async ({ page }) => {
    const appealCalls: string[] = [];
    await mockReviewerOnly(page, appealCalls, { delayFor: "nb", delayMs: 900 });
    await page.goto("/review");

    // Første henting går i nb og er treg. Vi bytter mens den fortsatt går.
    await page.selectOption("#localeSelect", "en-GB");

    // Uten språkvakta returnerer vakta den PÅGÅENDE norske hentingen, og køen blir stående på nb.
    await expect(page.locator("#manualReviewQueueBody")).toContainText("Incident response");
  });

  test("det trege svaret kan ikke overskrive språket sensoren står i", async ({ page }) => {
    const appealCalls: string[] = [];
    await mockReviewerOnly(page, appealCalls, { delayFor: "nb", delayMs: 900 });
    await page.goto("/review");
    await expect(page.locator("#manualReviewQueueBody")).toContainText("Hendelseshåndtering");

    await page.selectOption("#localeSelect", "en-GB");
    await expect(page.locator("#manualReviewQueueBody")).toContainText("Incident response");

    // Og den skal BLI stående engelsk etter at et tregt norsk svar eventuelt lander.
    await page.waitForTimeout(1400);
    await expect(page.locator("#manualReviewQueueBody")).toContainText("Incident response");
    await expect(page.locator("#manualReviewQueueBody")).not.toContainText("Hendelseshåndtering");
  });
});
