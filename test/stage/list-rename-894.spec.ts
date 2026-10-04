import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";

// #894 mot UTRULLET stage, med EKTE innhold.
//
// ⚠️ Hvorfor dette ikke kan leses ut av e2e-suiten: der er `titleLocales` noe jeg selv har skrevet
// inn i en fikstur. Den eneste måten å vite at TJENEREN faktisk sender feltet for ekte rader — og at
// verdiene stemmer med titlene som står der — er å be den om det. Feilen som ville sluppet gjennom
// uten denne: feltet mangler i svaret, klienten leser `undefined`, og HVER rad melder «nn, en
// mangler». Det ser ut som en fungerende funksjon, og det ville vært feil om alle.
//
// Leser bare. Ingenting døpes om og ingenting oversettes: stage har ekte innhold andre bruker.
//
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` og skal ALDRI logges eller skrives ut.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);

test.skip(!auth, `hopper over: ${reason}`);

const VENT_MS = 45000;

let configCache: Record<string, unknown> | null = null;
async function hentConfig(): Promise<Record<string, unknown>> {
  if (configCache) return configCache;
  const svar = await fetch(`${BASE}/participant/config`);
  configCache = (await svar.json()) as Record<string, unknown>;
  return configCache;
}

async function forberedSide(page: Page) {
  await page.route("**/api/**", async (r: Route) => {
    await r.continue({ headers: { ...r.request().headers(), authorization: `Bearer ${auth!.accessToken}` } });
  });
  const config = await hentConfig();
  await page.route("**/participant/config", (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...config, authMode: "mock" }) }),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

const FLATER = [
  { navn: "modullista", rute: "/admin-content", api: "**/api/admin/content/modules/library**", nøkkel: "modules" },
  { navn: "seksjonslista", rute: "/admin-content/sections", api: "**/api/admin/content/sections", nøkkel: "sections" },
];

for (const flate of FLATER) {
  test(`${flate.navn}: tjeneren sender titleLocales for ekte rader, og merket stemmer med det`, async ({ page }) => {
    await forberedSide(page);

    // Selve svaret fanges, så påstanden kan sammenlignes med DET TJENEREN SA — ikke med det
    // skjermen viser alene. Uten dette ville «alle rader har et merke» vært sant også når feltet
    // manglet og klienten falt tilbake på «bare bokmål».
    const rader: { data: Array<{ id: string; titleLocales?: string[] }> } = { data: [] };
    page.on("response", async (svar) => {
      if (!svar.url().includes(flate.nøkkel === "modules" ? "/modules/library" : "/content/sections")) return;
      try {
        const kropp = await svar.json();
        const liste = kropp?.[flate.nøkkel];
        if (Array.isArray(liste)) rader.data = liste;
      } catch { /* ikke JSON — ikke interessant */ }
    });

    await page.goto(`${BASE}${flate.rute}`, { waitUntil: "domcontentloaded" });
    expect(page.url(), "skal ikke ha havnet på innlogging").not.toContain("login.microsoftonline.com");

    // ⚠️ KONTROLLCASE. Uten denne er alt under sant for en side som aldri rendret noe.
    await expect(page.locator("tr[data-row-id]").first(), "lista fikk aldri rader").toBeVisible({ timeout: VENT_MS });

    const antallRader = await page.locator("tr[data-row-id]").count();
    expect(antallRader, "stage har ingen rader å måle på").toBeGreaterThan(0);

    // 1. Feltet finnes i svaret. Dette er kjernen: mangler det, er merket løgn for alle.
    expect(rader.data.length, "fanget ingen liste fra tjeneren").toBeGreaterThan(0);
    const utenFelt = rader.data.filter((r) => !Array.isArray(r.titleLocales));
    expect(utenFelt.map((r) => r.id), "rader uten titleLocales fra tjeneren").toEqual([]);

    // 2. Hver synlige rad har nøyaktig ett språkmerke.
    const merker = await page.locator("tr[data-row-id] .lang-gap, tr[data-row-id] .lang-complete").count();
    expect(merker, "hver rad skal ha ett språkmerke").toBe(antallRader);

    // 3. ⚠️ Kontrollcase mot «alt mangler». Melder HVER rad hull, er den mest sannsynlige årsaken
    // at feltet ikke leses — ikke at alt innhold er uoversatt. Påstanden er myk med vilje: stage
    // KAN ha bare uoversatt innhold, så den krever bare at fordelingen stemmer med svaret.
    const hull = await page.locator("tr[data-row-id] .lang-gap").count();
    const synligeIder = await page.locator("tr[data-row-id]").evaluateAll((rader_) =>
      rader_.map((r) => (r as HTMLElement).dataset.rowId ?? ""),
    );
    const forventetHull = rader.data
      .filter((r) => synligeIder.includes(r.id))
      .filter((r) => (r.titleLocales ?? []).length === 0 || ["nb", "nn", "en-GB"].some((l) => !(r.titleLocales ?? []).includes(l)))
      .length;
    expect(hull, "antall hull-merker skal følge tjenerens titleLocales").toBe(forventetHull);

    // 4. Knappen teller det samme som lista viser.
    const knapp = page.locator("#translateGapsBtn");
    await expect(knapp).toBeVisible();
    const etikett = (await knapp.textContent()) ?? "";
    const tall = Number(etikett.match(/\((\d+)\)/)?.[1] ?? "-1");
    expect(tall, `knappens tall («${etikett}») skal være innenfor antall rader med hull`).toBeLessThanOrEqual(hull);
    expect(tall, "knappens tall skal være lest, ikke negativt").toBeGreaterThanOrEqual(0);
  });
}
