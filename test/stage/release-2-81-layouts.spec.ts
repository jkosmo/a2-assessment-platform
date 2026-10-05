import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { drawFlowFigure } from "../../skills/a2-authoring-api/scripts/draw-flow-figure.mjs";

// #1079 mot UTRULLET stage: en figur i bredt og smalt oppsett, hele kjeden med den ekte klienten
// mot den ekte tjeneren — importert, levert, oversatt av den ekte språkmodellen, vist i
// forhåndsvisningen og vist til en deltaker i et publisert kurs, på PC- og telefonbredde.
//
// ⚠️ Hvorfor dette ikke kan leses ut av e2e-suiten: der svarer en mock på `?layout=narrow`. Om den
// ekte tjeneren og den ekte klienten er enige om adressen, hodene og hvilken fil som kommer, vet
// man først når de møtes. QA-gjennomgangen av 2.81.0 pekte på akkurat dette som det stage må vise.
//
// Det testen skriver på stage: én testseksjon og ett testkurs med navn som begynner på
// «Stage-test». Kurset publiseres for at deltakervisningen skal kunne måles, og begge slettes til
// slutt. Ekte innhold røres ikke. Figurene oversettes av den ekte språkmodellen (to kall).
//
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` og skal ALDRI logges eller skrives ut.
//
// Lokal prøvekjøring: STAGE_LOKAL=http://127.0.0.1:3001 (appen i mock-modus mot testdatabasen).

const lokal = process.env.STAGE_LOKAL ?? "";
const { auth, reason } = lokal ? { auth: null, reason: "" } : readAuth();
const BASE = lokal || stageBaseUrl(auth);
const LOKALE_HODER = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin" };
const hoder = (): Record<string, string> => (lokal ? LOKALE_HODER : { authorization: `Bearer ${auth!.accessToken}` });

test.skip(!lokal && !auth, `hopper over: ${reason}`);
// Én seksjon og ett kurs bygges opp steg for steg, så testene går i rekkefølge.
test.describe.configure({ mode: "serial" });

const VENT_MS = 45000;
const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "#1079", hva, verdi: String(verdi) })}\n`, "utf8");
};
const bilde = (page: Page, navn: string) => { fs.mkdirSync(RAPPORT, { recursive: true }); return page.screenshot({ path: path.join(RAPPORT, `${navn}.png`), fullPage: false }); };

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown>; tekst: string }> {
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(tekst) as Record<string, unknown>; } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const hentFigur = async (assetId: string, spørring = "") => {
  const svar = await fetch(`${BASE}/api/content-assets/${assetId}${spørring}`, { headers: hoder() });
  return { status: svar.status, oppsett: svar.headers.get("x-asset-layout"), harOppsett: svar.headers.get("x-asset-layouts"), svg: await svar.text() };
};
const bredde = (svg: string) => /viewBox="0 0 (\d+) /.exec(svg)?.[1];
const etiketter = (svg: string) => [...new Set([...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!))];
const b64 = (tekst: string) => Buffer.from(tekst, "utf8").toString("base64");

// Én beskrivelse, to tegninger — slik skillet gjør det.
const { wide: BRED, narrow: SMAL } = drawFlowFigure({
  name: "saksgang",
  title: "Saksgang i seks steg",
  desc: "Seks steg i rekkefølge, fordelt på tre faser.",
  phases: {
    forbered: { label: "Forbered", grunn: "#d9e8dd", lys: "#6fae87", tekst: "#3f7a57" },
    vurder: { label: "Vurder", grunn: "#dce7f2", lys: "#7fa3c7", tekst: "#44699a" },
    avslutt: { label: "Avslutt", grunn: "#e7e2f0", lys: "#a99bc9", tekst: "#6b5a94" },
  },
  steps: [
    { label: ["Motta", "saken"], phase: "forbered" }, { label: ["Sjekk", "vedlegg"], phase: "forbered" },
    { label: ["Vurder", "vilkårene"], phase: "vurder" }, { label: ["Drøft", "med kollega"], phase: "vurder" },
    { label: ["Skriv", "vedtaket"], phase: "avslutt" }, { label: ["Arkiver"], phase: "avslutt" },
  ],
});
const BRED_BREDDE = bredde(BRED)!;
const SMAL_BREDDE = bredde(SMAL)!;
/** Størrelsen det smale oppsettet oppgir for seg selv, slik skriptet skrev den. */
const STØRRELSE = / width="\d+" height="\d+"/.exec(SMAL)![0];
/** Etikettene er 12 px i figurens egne mål; under 9 px på skjermen kan de ikke leses. */
const etikettPx = (bildebredde: number, viewBoxBredde: string) => Math.round(((12 * bildebredde) / Number(viewBoxBredde)) * 10) / 10;

const stempel = Date.now();
const TITTEL = `Stage-test figur i to oppsett ${stempel}`;
const three = (tekst: string) => ({ nb: tekst, nn: tekst, "en-GB": tekst });
let sectionId = "";
let assetId = "";
let courseId = "";

// STAGE_BEHOLD=1 lar testkurset stå igjen på stage, publisert, så det kan åpnes på en EKTE telefon —
// det eneste denne testen ikke kan måle. Neste kjøring uten flagget rydder det bort (se under).
const behold = process.env.STAGE_BEHOLD === "1";
const TITTEL_START = "Stage-test figur i to oppsett ";

async function slettKurs(id: string) {
  // Kurset først: en seksjon som står i et kurs, kan ikke slettes.
  await api("POST", `/api/admin/content/courses/${id}/unpublish`);
  await api("POST", `/api/admin/content/courses/${id}/archive`);
  return api("DELETE", `/api/admin/content/courses/${id}`);
}
async function slettSeksjon(id: string) {
  await api("POST", `/api/admin/content/sections/${id}/archive`);
  return api("DELETE", `/api/admin/content/sections/${id}`);
}
/** Lista gir tittelen som en tekst, et kart per språk, eller kartet skrevet som tekst. Testens navn står i alle tre. */
const erTestens = (tittel: unknown): boolean => JSON.stringify(tittel ?? "").includes(TITTEL_START);

// Rydder bort det en tidligere kjøring med STAGE_BEHOLD lot stå. Bare innhold med denne testens
// eget navn, tegn for tegn — ekte innhold røres ikke.
test.beforeAll(async () => {
  if (!lokal && !auth) return;
  const kurs = ((await api("GET", "/api/admin/content/courses")).json.courses ?? []) as Array<{ id: string; title: unknown }>;
  const seksjoner = ((await api("GET", "/api/admin/content/sections")).json.sections ?? []) as Array<{ id: string; title: unknown }>;
  const gamleKurs = kurs.filter((k) => erTestens(k.title));
  const gamleSeksjoner = seksjoner.filter((s) => erTestens(s.title));
  for (const k of gamleKurs) await slettKurs(k.id);
  for (const s of gamleSeksjoner) await slettSeksjon(s.id);
  if (gamleKurs.length + gamleSeksjoner.length > 0) noter("opprydding før start", `${gamleKurs.length} testkurs og ${gamleSeksjoner.length} testseksjoner fra en tidligere kjøring er slettet`);
});

test.afterAll(async () => {
  if (behold) {
    if (courseId) noter("STÅR IGJEN PÅ STAGE (for å se på en ekte telefon)", `kurset «${TITTEL}» — slettes av neste kjøring`);
    return;
  }
  if (courseId) {
    const slettet = await slettKurs(courseId);
    noter("opprydding: testkurset", slettet.status === 204 || slettet.status === 200 ? "slettet" : `IKKE slettet (${slettet.status}: ${slettet.tekst.slice(0, 120)})`);
  }
  if (sectionId) {
    const slettet = await slettSeksjon(sectionId);
    noter("opprydding: testseksjonen", slettet.status === 204 ? "slettet" : `IKKE slettet (${slettet.status}: ${slettet.tekst.slice(0, 120)})`);
  }
});

let configCache: Record<string, unknown> | null = null;
async function forberedSide(page: Page) {
  await page.route("**/api/**", async (r: Route) => r.continue({ headers: { ...r.request().headers(), ...hoder() } }));
  configCache ??= (await (await fetch(`${BASE}/participant/config`)).json()) as Record<string, unknown>;
  await page.route("**/participant/config", (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...configCache, authMode: "mock" }) }),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

/** Det som faktisk står på sida: oppsettet klienten sier den viser, bredden på bildet nettleseren lastet, og spalten. */
async function vist(page: Page, velger: string) {
  const figur = page.locator(velger).first();
  await expect.poll(async () => (await figur.getAttribute("src")) ?? "", { timeout: VENT_MS }).toMatch(/^blob:/);
  await expect.poll(async () => (await figur.getAttribute("data-asset-layout")) ?? "", { timeout: VENT_MS }).toMatch(/^(wide|narrow)$/);
  // Vent til valget har satt seg: oppsettet som vises, er det som passer spalten.
  const les = () => figur.evaluate(async (el) => {
    const img = el as HTMLImageElement;
    if (!img.complete) await new Promise((ferdig) => { img.onload = ferdig; img.onerror = ferdig; });
    let spalteEl = img.parentElement;
    while (spalteEl && spalteEl.clientWidth === 0) spalteEl = spalteEl.parentElement;
    // SVG-en har bare viewBox, så bildets naturlige mål følger sideforholdet: bredde / høyde.
    return { oppsett: img.dataset.assetLayout, harOppsett: img.dataset.assetLayouts, spalte: spalteEl?.clientWidth ?? 0, bildebredde: img.getBoundingClientRect().width, forhold: Math.round((img.naturalWidth / img.naturalHeight) * 100) / 100 };
  });
  await expect.poll(async () => { const s = await les(); return s.oppsett === (s.spalte < 640 ? "narrow" : "wide"); }, { timeout: VENT_MS, message: "oppsettet som vises, skal passe spalten" }).toBe(true);
  return les();
}
const forhold = (svg: string) => { const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!; return Math.round((Number(m[1]) / Number(m[2])) * 100) / 100; };

test.describe("#1079 — en figur i bredt og smalt oppsett, på stage", () => {
  test("importen lagrer begge oppsettene, og tjeneren leverer det som blir bedt om", async () => {
    const pakke = {
      exportFormat: "a2-content-export/v1",
      exportedAt: new Date().toISOString(),
      scope: "section",
      section: {
        title: three(TITTEL),
        bodyMarkdown: three(`# ${TITTEL}\n\nLaget av den automatiske stage-testen. Kan slettes.\n\n![Saksgang i seks steg](asset:flyt)\n`),
        audit: {},
        assets: [{
          sourceId: "flyt", filename: "saksgang.svg", mimeType: "image/svg+xml", sizeBytes: Buffer.byteLength(BRED), contentBase64: b64(BRED), sourceLocale: "nb",
          layoutVariants: [{ layout: "narrow", contentBase64: b64(SMAL) }],
        }],
      },
    };
    const importert = await api("POST", "/api/admin/content/sections/import", { payload: pakke, mode: "createNew" });
    expect(importert.status, importert.tekst.slice(0, 400)).toBe(201);
    sectionId = importert.json.sectionId as string;
    const liste = await api("GET", `/api/admin/content/sections/${sectionId}/assets`);
    assetId = (liste.json.assets as Array<{ id: string }>)[0]!.id;

    const bred = await hentFigur(assetId);
    expect(bred.status).toBe(200);
    expect(bredde(bred.svg)).toBe(BRED_BREDDE);
    expect(bred.oppsett).toBe("wide");
    expect(bred.harOppsett).toBe("wide,narrow");

    const smal = await hentFigur(assetId, "?layout=narrow");
    expect(bredde(smal.svg)).toBe(SMAL_BREDDE);
    expect(smal.oppsett).toBe("narrow");
    // De to oppsettene sier det samme.
    expect(etiketter(smal.svg).sort()).toEqual(etiketter(bred.svg).sort());
    noter("levert bredt og smalt", `viewBox ${BRED_BREDDE} og ${SMAL_BREDDE} bred, ${etiketter(bred.svg).length} ulike etiketter i begge`);
  });

  test("oversettelsen oversetter begge oppsettene, med de samme etikettene", async () => {
    test.setTimeout(180000);
    const oversatt = await api("POST", `/api/admin/content/sections/${sectionId}/assets/localize`, { sourceLocale: "nb" });
    expect(oversatt.status, oversatt.tekst.slice(0, 300)).toBe(200);
    expect(oversatt.json.localizedAssetCount).toBe(1);

    const norsk = await hentFigur(assetId, "?locale=nb");
    for (const språk of ["en-GB", "nn"]) {
      const bred = await hentFigur(assetId, `?locale=${språk}`);
      const smal = await hentFigur(assetId, `?layout=narrow&locale=${språk}`);
      expect(smal.oppsett, `${språk}: det smale oppsettet finnes på språket`).toBe("narrow");
      expect(bredde(smal.svg)).toBe(SMAL_BREDDE);
      expect(bredde(bred.svg)).toBe(BRED_BREDDE);
      // Det smale oppsettet sier selv hvor stort det er på det meste. Det må overleve oversettelsen,
      // ellers blåses den oversatte figuren opp på et nettbrett.
      expect(smal.svg, `${språk}: det smale oppsettet har fortsatt sin egen størrelse`).toContain(STØRRELSE);
      expect(etiketter(smal.svg).sort(), `${språk}: begge oppsettene har de samme etikettene`).toEqual(etiketter(bred.svg).sort());
      expect(etiketter(bred.svg), `${språk}: etikettene er oversatt, ikke kopiert`).not.toEqual(etiketter(norsk.svg));
      noter(`etiketter på ${språk} (begge oppsett)`, etiketter(smal.svg).join(" · "));
    }
  });

  for (const skjerm of [{ navn: "PC", w: 1280, h: 900 }, { navn: "telefon", w: 390, h: 844 }]) {
    test(`forhåndsvisningen i editoren, ${skjerm.navn} (${skjerm.w} px): oppsettet som vises, passer spalten`, async ({ page }) => {
      await forberedSide(page);
      await page.setViewportSize({ width: skjerm.w, height: skjerm.h });
      await page.goto(`${BASE}/admin-content/sections?id=${sectionId}`, { waitUntil: "domcontentloaded" });
      await page.locator('[data-form-tab-btn="forhandsvisning"]').click({ timeout: VENT_MS });
      const s = await vist(page, "#previewPane img");
      expect(s.harOppsett).toBe("wide,narrow");
      // Bildets mål er hele piksler, så forholdet stemmer ikke på hundredelen. De to oppsettene er
      // langt fra hverandre (rundt 5,5 mot 0,7), så en halv i slingringsmonn skiller dem trygt.
      expect(Math.abs(s.forhold - forhold(s.oppsett === "narrow" ? SMAL : BRED))).toBeLessThan(0.5);
      if (skjerm.w === 390) expect(s.oppsett).toBe("narrow");
      noter(`forhåndsvisning, ${skjerm.navn}`, `spalten er ${s.spalte} px → ${s.oppsett === "narrow" ? "smalt" : "bredt"} oppsett`);
      await page.locator("#previewPane img").first().scrollIntoViewIfNeeded();
      await bilde(page, `1079-forhaandsvisning-${skjerm.w}`);
    });
  }

  test("seksjonen publiseres og legges i et publisert testkurs", async () => {
    const publisert = await api("POST", `/api/admin/content/sections/${sectionId}/publish`);
    expect(publisert.status, publisert.tekst.slice(0, 300)).toBe(200);
    const kurs = await api("POST", "/api/admin/content/courses", { title: three(TITTEL) });
    expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
    courseId = (kurs.json.course as { id: string }).id;
    const innhold = await api("PUT", `/api/admin/content/courses/${courseId}/items`, { items: [{ type: "SECTION", sectionId }] });
    expect(innhold.status, innhold.tekst.slice(0, 300)).toBe(204);
    const kursPublisert = await api("POST", `/api/admin/content/courses/${courseId}/publish`);
    expect(kursPublisert.status, kursPublisert.tekst.slice(0, 300)).toBe(200);
  });

  for (const skjerm of [{ navn: "PC", w: 1280, h: 900 }, { navn: "telefon", w: 390, h: 844 }]) {
    test(`deltakeren, ${skjerm.navn} (${skjerm.w} px): figuren vises i oppsettet som passer`, async ({ page }) => {
      await forberedSide(page);
      await page.setViewportSize({ width: skjerm.w, height: skjerm.h });
      await page.goto(`${BASE}/participant`, { waitUntil: "domcontentloaded" });
      const kurs = page.locator(".course-accordion-header").filter({ hasText: TITTEL }).first();
      await expect(kurs).toBeVisible({ timeout: VENT_MS });
      await kurs.click();
      const rad = page.locator(".course-item").filter({ hasText: TITTEL }).locator(".course-module-row").first();
      await expect(rad).toBeVisible({ timeout: VENT_MS });
      await rad.click();
      const s = await vist(page, "#sectionReaderBody img");
      expect(s.harOppsett).toBe("wide,narrow");
      expect(s.oppsett).toBe(skjerm.w === 390 ? "narrow" : "wide");
      expect(Math.abs(s.forhold - forhold(skjerm.w === 390 ? SMAL : BRED))).toBeLessThan(0.5);
      // Det som teller for den som leser: hvor store etikettene er på skjermen. Første utgave valgte
      // riktig oppsett og hadde etiketter på 5 px på telefon — riktig valg er ikke nok.
      const px = etikettPx(s.bildebredde, skjerm.w === 390 ? SMAL_BREDDE : BRED_BREDDE);
      expect(px, `etikettene er ${px} px på skjermen (bildet er ${Math.round(s.bildebredde)} px bredt)`).toBeGreaterThanOrEqual(9);
      noter(`deltaker, ${skjerm.navn}`, `spalten er ${s.spalte} px → ${s.oppsett === "narrow" ? "smalt" : "bredt"} oppsett, etikettene er ${px} px på skjermen`);
      await page.locator("#sectionReaderBody img").first().scrollIntoViewIfNeeded();
      await bilde(page, `1079-deltaker-${skjerm.w}`);
    });
  }

  test("deltakeren snur telefonen: figuren bytter fra smalt til bredt oppsett og tilbake", async ({ page }) => {
    await forberedSide(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/participant`, { waitUntil: "domcontentloaded" });
    const kurs = page.locator(".course-accordion-header").filter({ hasText: TITTEL }).first();
    await expect(kurs).toBeVisible({ timeout: VENT_MS });
    await kurs.click();
    await page.locator(".course-item").filter({ hasText: TITTEL }).locator(".course-module-row").first().click();
    const figur = page.locator("#sectionReaderBody img").first();
    await expect(figur).toHaveAttribute("data-asset-layout", "narrow", { timeout: VENT_MS });

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(figur).toHaveAttribute("data-asset-layout", "wide", { timeout: VENT_MS });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(figur).toHaveAttribute("data-asset-layout", "narrow", { timeout: VENT_MS });
  });
});
