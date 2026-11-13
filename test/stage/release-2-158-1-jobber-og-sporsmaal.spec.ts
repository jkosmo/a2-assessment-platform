import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";

// 2.158.1 mot UTRULLET stage, med ekte data (#1154 og #1155):
//
//   A. «Oversett» startet i seksjon A skriver ikke i seksjon B når forfatteren bytter seksjon mens den ekte
//      oversettingen går.
//   B. En lenke ut av et skjema med ulagret tekst spør én gang.
//   C. Nettleserens tilbake-knapp fra et skjema med ulagret tekst spør; Avbryt beholder teksten.
//   D. Bytte av menyspråk beholder ulagret tekst i en seksjon, og en åpen klasse blir stående med ulagret navn.
//
// Det testen skriver på stage: to seksjoner og én klasse («Stage-test 2.158.1 …»). Seksjonene arkiveres og klassen slettes
// etterpå, og testen feiler hvis ryddingen feiler. Ingenting lagres fra skjemaene: alt som skrives i dem, er ulagret.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.158.1", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  }).catch((feil: unknown) => {
    throw new Error(`${metode} ${sti.split("?")[0]} svarte ikke: ${feil instanceof Error ? feil.message : String(feil)}`);
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

let configCache: Record<string, unknown> | null = null;
async function forberedSide(page: Page) {
  await page.route("**/api/**", async (r: Route) => {
    await vent();
    await r.continue({ headers: { ...r.request().headers(), ...hoder() } });
  });
  configCache ??= (await (await fetch(`${BASE}/participant/config`)).json()) as Record<string, unknown>;
  await page.route("**/participant/config", (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...configCache, authMode: "mock" }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Samler alle spørsmål nettleseren stiller (med type), og svarer det `svar()` sier akkurat da. */
function samleDialoger(page: Page, svar: () => "ok" | "avbryt") {
  const dialoger: string[] = [];
  page.on("dialog", (dialog) => {
    dialoger.push(dialog.type());
    return svar() === "ok" ? dialog.accept() : dialog.dismiss();
  });
  return dialoger;
}

const stempel = Date.now();
const A = { navn: `Stage-test 2.158.1 seksjon A ${stempel}`, tekst: { nb: "Dette er teksten i seksjon A.", nn: "Dette er teksten i seksjon A, på nynorsk.", "en-GB": "This is the text of section A." } };
const B = { navn: `Stage-test 2.158.1 seksjon B ${stempel}`, tekst: { nb: "Seksjon B handler om noe helt annet.", nn: "Seksjon B handlar om noko heilt anna.", "en-GB": "Section B is about something else entirely." } };
const KLASSE = `Stage-test 2.158.1 klasse ${stempel}`;
const tilstand: { a?: string; b?: string; klasse?: string } = {};

async function lagSeksjon(s: typeof A): Promise<string> {
  const svar = await api("POST", "/api/admin/content/sections", { title: { nb: s.navn, nn: s.navn, "en-GB": s.navn }, bodyMarkdown: s.tekst });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(201);
  return svar.json.section.id as string;
}

/** Åpner en seksjon fra lista, slik forfatteren gjør (uten sidelasting mellom). */
async function aapneFraLista(page: Page, id: string, navn: string) {
  const sok = page.locator("#sectionsSearch");
  await expect(sok).toBeVisible({ timeout: 45_000 });
  await sok.fill(`2.158.1 seksjon`);
  await page.locator(`[data-action="edit"][data-id="${id}"]`).click();
  await expect(page.locator("#titleInput")).toHaveValue(navn, { timeout: 45_000 });
}

test.afterAll(async () => {
  const mislyktes: string[] = [];
  for (const [navn, id] of [["A", tilstand.a], ["B", tilstand.b]] as const) {
    if (!id) continue;
    await api("POST", `/api/admin/content/sections/${id}/archive`);
    const etter = await api("GET", `/api/admin/content/sections/${id}`);
    noter(`testseksjon ${navn} etter rydding`, { arkivert: Boolean(etter.json.section?.archivedAt) });
    if (!etter.json.section?.archivedAt) mislyktes.push(`seksjon ${navn} er ikke arkivert`);
  }
  if (tilstand.klasse) {
    const arkivert = await api("POST", `/api/admin/content/classes/${tilstand.klasse}/archive`);
    const slettet = await api("DELETE", `/api/admin/content/classes/${tilstand.klasse}`);
    noter("testklassen etter rydding", { arkiver: arkivert.status, slett: slettet.status });
    if (slettet.status >= 400) mislyktes.push(`klassen er ikke slettet: ${slettet.status}`);
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.158.1", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.158.1"));
});

test("testdata: to seksjoner og en klasse", async () => {
  test.setTimeout(120_000);
  tilstand.a = await lagSeksjon(A);
  tilstand.b = await lagSeksjon(B);
  const klasse = await api("POST", "/api/admin/content/classes", { name: KLASSE });
  expect(klasse.status, klasse.tekst.slice(0, 300)).toBe(201);
  tilstand.klasse = klasse.json.class.id;
  noter("testdata", { a: tilstand.a, b: tilstand.b, klasse: tilstand.klasse });
});

test("A: en ekte oversetting startet i seksjon A skriver ikke i seksjon B", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!tilstand.a || !tilstand.b, "testdataene ble ikke laget");
  await forberedSide(page);
  const oversettinger: Array<{ status: number }> = [];
  page.on("response", (res) => {
    if (new URL(res.url()).pathname.endsWith("/sections/localize")) oversettinger.push({ status: res.status() });
  });
  await page.goto(`${BASE}/admin-content/sections`, { waitUntil: "domcontentloaded" });
  await aapneFraLista(page, tilstand.a!, A.navn);

  const sendt = page.waitForRequest((req) => new URL(req.url()).pathname.endsWith("/sections/localize"), { timeout: 30_000 });
  await page.locator("#translateBtn").click();
  await sendt;
  // «← Tilbake» er låst mens oversettingen går; nettleserens tilbake-knapp er det ikke.
  await page.goBack();
  await aapneFraLista(page, tilstand.b!, B.navn);

  // Vent til den ekte oversettingen har svart, og litt til.
  await expect.poll(() => oversettinger.length, { timeout: 120_000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(3_000);
  noter("A, oversettingskall som svarte", oversettinger);

  await expect(page.locator("#formPageDirty"), "seksjon B ble merket som ulagret").toHaveText("Alt lagret");
  await expect(page.locator("#markdownInput")).toHaveValue(B.tekst.nb);
  await page.locator('[data-form-locale="nn"]').click();
  await expect(page.locator("#titleInput")).toHaveValue(B.navn);
  await expect(page.locator("#markdownInput"), "nynorsk i B er byttet ut").toHaveValue(B.tekst.nn);
  await page.locator('[data-form-locale="en-GB"]').click();
  await expect(page.locator("#markdownInput"), "engelsk i B er byttet ut").toHaveValue(B.tekst["en-GB"]);
  await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
  // Oversettingen stoppet etter første svar: ikke et kall til for neste språk.
  expect(oversettinger.length).toBe(1);
  // Og seksjon B på tjeneren er urørt.
  const b = (await api("GET", `/api/admin/content/sections/${tilstand.b}`)).json.section;
  expect(JSON.parse(b.bodyMarkdown)).toEqual(B.tekst);
  noter("A", "seksjon B urørt, på skjermen og på tjeneren");
});

test("B, C og D: ett spørsmål ved lenke, spørsmål ved tilbake-knappen, og språkbytte beholder teksten", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!tilstand.a, "testdataene ble ikke laget");
  await forberedSide(page);
  let svar: "ok" | "avbryt" = "avbryt";
  const dialoger = samleDialoger(page, () => svar);
  await page.goto(`${BASE}/admin-content/sections`, { waitUntil: "domcontentloaded" });
  await aapneFraLista(page, tilstand.a!, A.navn);
  await page.locator("#titleInput").fill("Ulagret navn fra stage-testen");
  await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");

  // D: menyspråket byttes. Teksten står, og seksjonen hentes ikke på nytt.
  await page.locator("#localeSelect").selectOption("en-GB");
  await expect(page.locator("#formPageDirty")).toHaveText("Unsaved changes");
  await expect(page.locator("#titleInput")).toHaveValue("Ulagret navn fra stage-testen");
  await page.locator("#localeSelect").selectOption("nb");
  await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
  await expect(page.locator("#titleInput")).toHaveValue("Ulagret navn fra stage-testen");

  // C: tilbake-knappen spør. Avbryt: skjemaet, teksten og adressen står.
  await page.goBack();
  await expect.poll(() => dialoger).toEqual(["confirm"]);
  await expect(page.locator("#titleInput")).toHaveValue("Ulagret navn fra stage-testen");
  expect(new URL(page.url()).searchParams.get("id")).toBe(tilstand.a);

  // B: en lenke i menyen spør én gang (sidas spørsmål), og etter OK forlates sida uten nettleserens spørsmål.
  svar = "ok";
  await page.locator("#navKurs").click();
  await expect(page).toHaveURL(/\/admin-content\/courses/, { timeout: 30_000 });
  noter("B, C og D: spørsmål i rekkefølge", dialoger);
  expect(dialoger).toEqual(["confirm", "confirm"]);
  // Ingenting ble lagret: seksjonen heter det samme.
  const a = (await api("GET", `/api/admin/content/sections/${tilstand.a}`)).json.section;
  expect(JSON.parse(a.title).nb).toBe(A.navn);
});

test("D, klasser: språkbytte lar en åpen klasse stå, med ulagret navn", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.klasse, "klassen ble ikke laget");
  await forberedSide(page);
  await page.goto(`${BASE}/admin-content/classes?id=${tilstand.klasse}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#className")).toHaveValue(KLASSE, { timeout: 45_000 });
  await page.locator("#className").fill("Ulagret klassenavn");
  await page.locator("#localeSelect").selectOption("en-GB");
  await expect(page.locator("#formPageDirty")).toHaveText("Unsaved changes", { timeout: 45_000 });
  await expect(page.locator("#className")).toHaveValue("Ulagret klassenavn");
  expect(new URL(page.url()).searchParams.get("id")).toBe(tilstand.klasse);
  // Ingenting ble lagret.
  const klasse = (await api("GET", `/api/admin/content/classes/${tilstand.klasse}`)).json.class;
  expect(klasse.name).toBe(KLASSE);
  noter("D, klasser", "klassen står, navnet er ulagret og urørt på tjeneren");
});
