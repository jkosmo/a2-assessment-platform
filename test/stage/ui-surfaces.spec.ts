// @ts-expect-error — nettleser-ESM uten typer, lest som bibliotek. Samme mønster som
// test/unit/agent-authoring-export-schema-roundtrip.test.ts bruker for skill-skriptet.
import { translations as oversettelser } from "../../public/i18n/participant-translations.js";
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
// ⚠️ Hentet fra den EKTE tabellen, ikke skrevet av hånd. En håndskrevet liste ville stille sluttet
// å måle den dagen en etikett ble omformulert — og da hadde vakta vært grønn på feil grunnlag.
//
// Bare etiketter som FAKTISK skiller seg mellom nb og en-GB tas med. Er de like, sier «norsk ord
// funnet i en-GB» ingenting.
const NORSKE_RAMMEORD: string[] = (() => {
  const nb = (oversettelser as Record<string, Record<string, string>>).nb ?? {};
  const en = (oversettelser as Record<string, Record<string, string>>)["en-GB"] ?? {};
  return Object.keys(nb)
    .filter((k) => k.startsWith("nav."))
    .map((k) => nb[k])
    .filter((v, i, a) => typeof v === "string" && v.length > 4 && a.indexOf(v) === i)
    .filter((v) => !Object.values(en).includes(v));
})();

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

  test(`${flate.navn}: et TREGT svar overskriver ikke språket brukeren står i`, async ({ page }) => {
    // ⚠️ KAPPLØPET. Bytter brukeren språk to ganger raskt, kan det FØRSTE svaret lande sist. Uten
    // vakt tegner den gamle lokalen over den nye, og brukeren sitter i et språk hen ikke valgte.
    //
    // `lagLokalisertRessurs` har vakta — `if (hentSpråk() !== språk) return;` — men den er bare
    // enhetstestet. Epicen #1041 krevde påstanden PER FLATE, fordi det er innføringen som glipper,
    // ikke modulen.
    //
    // Måten: svaret som skal TAPE merkes og forsinkes. Renders det likevel, dukker merket opp i
    // DOM-en. Det er uavhengig av hva testdataene inneholder — i motsetning til å sammenligne tekst,
    // som er blindt på flater der innholdet er språkuavhengig.
    //
    // ⚠️ DENNE ER SVAKERE ENN DE ANDRE, OG DET SKAL STÅ HER. Mutasjonstesting viser at merket bare
    // når DOM-en på ÉN av de seks flatene — merker jeg vinnersvaret i stedet for taperen, blir bare
    // én test rød. På de fem andre ville påstanden vært grønn uansett hva vakta gjorde.
    //
    // Hvorfor den likevel er verdt å ha: de seks flatene deler ÉN implementasjon etter #1042, og
    // kappløpsvakta er enhetstestet i `test/unit/localized-resource.test.js`. Denne bekrefter at
    // modulen faktisk er koblet inn på minst én ekte flate — det enhetstesten ikke kan si noe om.
    //
    // Skal den bli en ekte per-flate-påstand, må vi vite hvorfor det merkede svaret ikke rendres på
    // de fem andre. Det er ikke undersøkt.
    const MERKE = "ZZSTALEZZ";
    await forberedSide(page);
    await page.goto(`${BASE}${flate.rute}`, { waitUntil: "domcontentloaded" });
    if (flate.forbered) await page.click(flate.forbered);
    await expect(page.locator(flate.beholder)).not.toBeEmpty({ timeout: 20000 });

    const velger = page.locator("#localeSelect");
    if ((await velger.count()) === 0) test.skip(true, "ingen språkvelger på denne flaten");

    const start = (await velger.inputValue()) === "nb" ? "nb" : "en-GB";
    const annet = start === "nb" ? "en-GB" : "nb";

    let merk = false;
    await page.route("**/api/**", async (r: Route) => {
      const svar = await r.fetch({ headers: { ...r.request().headers(), authorization: `Bearer ${auth!.accessToken}` } });
      if (!merk) return r.fulfill({ response: svar });
      // Merk hver streng i svaret, og hold det tilbake så det lander SIST.
      let kropp = await svar.text();
      try {
        kropp = JSON.stringify(JSON.parse(kropp), (_n, v) => (typeof v === "string" ? `${MERKE}${v}` : v));
      } catch {
        return r.fulfill({ response: svar });
      }
      await new Promise((res) => setTimeout(res, 4000));
      await r.fulfill({ response: svar, body: kropp });
    });

    merk = true;
    await velger.selectOption(annet);
    merk = false;
    await velger.selectOption(start);

    await expect(page.locator("html")).toHaveAttribute("lang", start, { timeout: 20000 });
    // Vent forbi forsinkelsen, så det trege svaret HAR landet før vi ser etter merket.
    await page.waitForTimeout(6000);

    const tekst = (await page.locator("body").textContent()) ?? "";
    expect(
      tekst.includes(MERKE),
      `${flate.rute}: et forsinket svar fra ${annet} tegnet over ${start}. Kappløpsvakta virker ikke her.`,
    ).toBe(false);
    await expect(page.locator("html")).toHaveAttribute("lang", start);
  });

  test(`${flate.navn}: ingen BLANDET språk etter bytte`, async ({ page }) => {
    // ⚠️ Rammens etiketter kommer fra klientens egen tabell, innholdet fra serveren. Følger bare den
    // ene med på et språkbytte, står siden med to språk samtidig — og det ser ut som en halvferdig
    // oversettelse, ikke som en feil. Nav-etikettene er delte og finnes på hver flate.
    await forberedSide(page);
    await page.goto(`${BASE}${flate.rute}`, { waitUntil: "domcontentloaded" });
    if (flate.forbered) await page.click(flate.forbered);
    await expect(page.locator(flate.beholder)).not.toBeEmpty({ timeout: 20000 });

    const velger = page.locator("#localeSelect");
    if ((await velger.count()) === 0) test.skip(true, "ingen språkvelger på denne flaten");

    await velger.selectOption("en-GB");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB", { timeout: 20000 });

    // ⚠️ `#workspaceNav` SPESIFIKT. Første utgave brukte `nav, header` og tok den første treffet —
    // på flere flater er det et undernav uten de delte etikettene. Testen fant da ingen norske ord
    // fordi den så feil sted, og var grønn av det. Mutasjonstesting avslørte det: å hoppe over
    // språkbyttet HELT ga fortsatt ingen røde.
    const nav = page.locator("#workspaceNav");
    await expect(nav, "arbeidsflate-navet skal være fylt").not.toBeEmpty({ timeout: 20000 });
    const rammetekst = (await nav.textContent()) ?? "";

    // Kontrollcase: ordlista må ha noe å lete etter, ellers er «ingen norsk igjen» sant om ingenting.
    expect(NORSKE_RAMMEORD.length, "det skal finnes norske rammeord som skiller seg fra en-GB").toBeGreaterThan(3);

    const norskeIgjen = NORSKE_RAMMEORD.filter((ord) => rammetekst.includes(ord));
    expect(
      norskeIgjen.join(", "),
      `${flate.rute} viser norske rammeord i en-GB: siden står med to språk samtidig.`,
    ).toBe("");
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
