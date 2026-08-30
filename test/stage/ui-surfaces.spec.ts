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
  { navn: "sensorkøen", rute: "/review", beholder: "#manualReviewQueueBody" },
  { navn: "resultatsiden", rute: "/results", beholder: "#completionBody", forbered: "#loadResults" },
  { navn: "profilen", rute: "/profile", beholder: "#coursesBody" },
  { navn: "fullførte moduler", rute: "/participant/completed", beholder: "#courseCertList" },
  { navn: "admin-plattform", rute: "/admin-platform", beholder: "body" },
  { navn: "kohortstatus", rute: "/deltakere/status", beholder: "#courseSelect" },
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
