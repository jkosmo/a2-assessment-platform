import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";

// #1046: driver de EKTE flatene på utrullet stage, mot EKTE data.
//
// ⚠️ HVORFOR DENNE IKKE FANTES FØR. Stage-suitene har vært API-nivå, fordi appen bruker MSAL og
// sender deg til innlogging før noe rendres. `storageState` hjelper ikke: MSAL bruker
// `sessionStorage`, som Playwright ikke fanger.
//
// Veien rundt: klienten avgjør innloggingsmåte fra `/participant/config`. Vi lar den ENE responsen
// si `authMode: "mock"` — da hopper klienten over MSAL og redirecten — og legger det ekte
// Bearer-tokenet på hvert `/api/`-kall selv. Klienten tror den er i mock; serveren ser et gyldig
// token og svarer med ekte data.
//
// ⚠️ Alt annet i config-responsen beholdes uendret. Å bytte hele responsen ville testet en annen
// konfigurasjon enn den som faktisk kjører.
//
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` og skal ALDRI logges eller skrives ut.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);

test.skip(!auth, `hopper over: ${reason}`);

/** Flatene, med hva som skal stå der og hvor det står. */
const FLATER = [
  { navn: "sensorkøen", rute: "/review", beholder: "#manualReviewQueueBody", innhold: "#manualReviewQueueBody" },
  { navn: "resultatsiden", rute: "/results", beholder: "#completionBody", forbered: "#loadResults", innhold: "#completionBody" },
  { navn: "profilen", rute: "/profile", beholder: "#coursesBody", innhold: "#coursesBody" },
  { navn: "fullførte moduler", rute: "/participant/completed", beholder: "#courseCertList", innhold: "#courseCertList" },
  // ⚠️ `beholder` er `body` her fordi flaten ikke har én samlende node å vente på. Men `innhold`
  // MÅ være smalere: `body` inneholder grensesnittets egne etiketter, som oversettes uansett om
  // serverens innhold følger med. En påstand mot `body` ville vært grønn av rammen alene — altså
  // nøyaktig blind for feilen #1040 beskriver.
  { navn: "admin-plattform", rute: "/admin-platform", beholder: "body", innhold: "#failedAssessmentsBody" },
  { navn: "kohortstatus", rute: "/deltakere/status", beholder: "#courseSelect", innhold: "#courseSelect" },
];

async function forberedSide(page: Page) {
  // Legg det ekte tokenet på alle API-kall.
  await page.route("**/api/**", async (r: Route) => {
    await r.continue({ headers: { ...r.request().headers(), authorization: `Bearer ${auth!.accessToken}` } });
  });

  // La klienten tro den er i mock, slik at MSAL og redirecten hoppes over. Alt annet beholdes.
  //
  // ⚠️ Config hentes ÉN gang og gjenbrukes. Første utgave kalte `route.fetch()` inne i håndtereren,
  // og en sen forespørsel etter at testen var ferdig ga «Target page has been closed» — som feilet
  // testen på nedrigging, ikke på produktet. Tre av seks flater feilet slik.
  const config = await hentConfig();
  await page.route("**/participant/config", (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...config, authMode: "mock" }) }),
  );
}

let configCache: Record<string, unknown> | null = null;
async function hentConfig(): Promise<Record<string, unknown>> {
  if (configCache) return configCache;
  const svar = await fetch(`${BASE}/participant/config`);
  configCache = (await svar.json()) as Record<string, unknown>;
  return configCache;
}

/** Rå lagringsformat som slipper ut på skjermen — det #1027 handlet om. */
const RÅ_JSON = /\{"(en-GB|nb|nn)"\s*:/;

for (const flate of FLATER) {
  test(`${flate.navn}: laster uten rå JSON og uten rød feilmelding`, async ({ page }) => {
    const konsollfeil: string[] = [];
    page.on("pageerror", (e) => konsollfeil.push(e.message));

    await forberedSide(page);
    await page.goto(`${BASE}${flate.rute}`, { waitUntil: "domcontentloaded" });
    if (flate.forbered) await page.click(flate.forbered);

    // ⚠️ Kontrollcase: kom vi i det hele tatt inn? Havner vi på innloggingssiden, er alle
    // påstandene under sanne uten å måle noe.
    expect(page.url(), "skal ikke ha havnet på innlogging").not.toContain("login.microsoftonline.com");

    // ⚠️ KONTROLLCASE, og den VENTER. Uten den er «ingen rå JSON» og «ingen feilmelding» sanne også
    // for en side som aldri rendret noe.
    //
    // Første utgave brukte en fast pause på 2,5 s og feilet her — ikke fordi siden var tom, men
    // fordi ekte Azure av og til bruker fire. En fast pause måler nettverket, ikke produktet.
    await expect(page.locator(flate.beholder), `${flate.beholder} fikk aldri innhold`).not.toBeEmpty({ timeout: 20000 });

    const tekst = (await page.locator("body").textContent()) ?? "";

    expect(RÅ_JSON.test(tekst), `rå lagringsformat på skjermen: ${tekst.slice(0, 200)}`).toBe(false);

    const feiltoaster = await page.locator(".toast--error").allTextContents();
    expect(feiltoaster, `røde feilmeldinger ved lasting: ${JSON.stringify(feiltoaster)}`).toEqual([]);

    expect(konsollfeil, `ubehandlede feil i konsollet: ${JSON.stringify(konsollfeil)}`).toEqual([]);
  });

  test(`${flate.navn}: HENTER PÅ NYTT ved språkbytte`, async ({ page }) => {
    // ⚠️ DETTE ER PÅSTANDEN #1040 HANDLER OM. Etter #1027 avgjør SERVEREN hvilket språk innhold
    // vises på, og den gjør det ved HENTING. En flate som bare tegner om det den allerede har,
    // følger derfor ikke et språkbytte. Feilen er at det ikke gjøres et nytt kall.
    //
    // ⚠️ FØRSTE UTGAVE MÅLTE FEIL TING. Den sammenlignet beholderens TEKST før og etter byttet. På
    // /results er innholdet en tabell med modultitler, og hver modul har én tittel på det språket
    // den ble skrevet i — «Modul 2: Kort KS1-case» ved siden av «Module 1: Fundamental
    // understanding». Teksten er den samme uansett språk, helt korrekt, og påstanden kunne ikke
    // skille «hentet ikke på nytt» fra «hentet på nytt, men teksten er språkuavhengig».
    //
    // Å telle kall er uavhengig av hva testdataene tilfeldigvis inneholder.
    await forberedSide(page);

    const kall: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (u.includes("/api/") && !u.includes("/participant/config")) kall.push(u);
    });

    await page.goto(`${BASE}${flate.rute}`, { waitUntil: "domcontentloaded" });
    if (flate.forbered) await page.click(flate.forbered);
    await expect(page.locator(flate.beholder)).not.toBeEmpty({ timeout: 20000 });

    const velger = page.locator("#localeSelect");
    if ((await velger.count()) === 0) test.skip(true, "ingen språkvelger på denne flaten");

    // Kontrollcase: flaten må ha hentet noe i det hele tatt. Uten dette ville en flate som ALDRI
    // kaller APIet bestå påstanden under ved at null forblir null.
    expect(kall.length, "flaten skal ha hentet innhold ved lasting").toBeGreaterThan(0);

    const førBytte = kall.length;
    await velger.selectOption(await velger.inputValue() === "nb" ? "en-GB" : "nb");

    await expect
      .poll(() => kall.length - førBytte, {
        timeout: 20000,
        message:
          `${flate.rute} gjorde ingen nye API-kall etter språkbytte. Da tegner flaten om det den ` +
          "allerede har, og serverens språkvalg (#1027) når aldri fram — det er nettopp #1040.",
      })
      .toBeGreaterThan(0);
  });

  test(`${flate.navn}: språkbytte gir ikke rå JSON eller feil`, async ({ page }) => {
    await forberedSide(page);
    await page.goto(`${BASE}${flate.rute}`, { waitUntil: "domcontentloaded" });
    if (flate.forbered) await page.click(flate.forbered);
    await expect(page.locator(flate.beholder)).not.toBeEmpty({ timeout: 20000 });

    const velger = page.locator("#localeSelect");
    if ((await velger.count()) === 0) test.skip(true, "ingen språkvelger på denne flaten");

    // ⚠️ Ingen faste pauser. Ekte Azure svarer noen ganger på 200 ms og noen ganger på fire
    // sekunder; en fast pause måler nettverket, ikke produktet. Første utgave ga én flakete test av
    // nettopp den grunnen — samme feil jeg allerede hadde rettet i lastetesten over.
    //
    // Vi venter på at siden faktisk HAR byttet språk, som er det påstanden handler om.
    await velger.selectOption("nb");
    await expect(page.locator("html")).toHaveAttribute("lang", "nb", { timeout: 20000 });
    await expect(page.locator(flate.beholder)).not.toBeEmpty({ timeout: 20000 });

    await velger.selectOption("en-GB");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB", { timeout: 20000 });
    await expect(page.locator(flate.beholder)).not.toBeEmpty({ timeout: 20000 });

    const tekst = (await page.locator("body").textContent()) ?? "";
    expect(RÅ_JSON.test(tekst), "rå lagringsformat etter språkbytte").toBe(false);

    const feiltoaster = await page.locator(".toast--error").allTextContents();
    expect(feiltoaster, `røde feilmeldinger etter språkbytte: ${JSON.stringify(feiltoaster)}`).toEqual([]);
  });
}
