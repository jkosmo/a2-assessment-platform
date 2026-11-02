import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// #934 mot UTRULLET stage, gjennom de EKTE sidene — slik produkteier selv ville prøvd det (2026-11-02:
// «Jeg tror du skal få teste dette selv»). Stage-specene for 2.127–2.129 gikk gjennom API-et; denne går
// gjennom kursskjemaet, «Mine kurs», kursbeviset, profilen og Resultater:
//   1. et lesekurs med to seksjoner publiseres (1.0), og testkontoen får kursbevis for versjon 1;
//   2. i kursskjemaet legges en tredje seksjon til og lagres — «Hva slags endring er dette?» kommer,
//      forfatteren velger hovedversjon → 2.0;
//   3. «Mine kurs» viser «Ny versjon», forklaringen og «Kursbevis, versjon 1»; de to gamle står som lest.
//      Resultater viser deltakeren som «Må ta ny versjon» (hvis kontoen slipper inn);
//   4. kursbeviset for 1 har ingen versjonslinje; den nye seksjonen leses → bevis for 2 med «Versjon 2»,
//      profilen skriver «(versjon 2)», og «Mine kurs» viser hel grønn linje uten båt;
//   5. en seksjon lagres med ny tekst fra sin egen side (lagring ER publisering) → 2.1, bevisene urørt.
//
// Det testen skriver på stage: tre seksjoner og ett kurs («Stage-test 934 UI …»), og to kursbevis for
// testkontoen. Kurset avpubliseres og arkiveres etterpå. ⚠️ Tokenet leses fra den gitignorerte
// `.stage-auth.json` (eller `.stage-service-auth.json`) og skal ALDRI logges eller skrives ut.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const BILDER = process.env.STAGE_SKJERMBILDER ?? path.resolve(process.cwd(), "test-results", "stage-934-ui");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "manuell-934-ui", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};
async function bilde(page: Page, navn: string, fullPage = true) {
  fs.mkdirSync(BILDER, { recursive: true });
  await page.screenshot({ path: path.join(BILDER, `${navn}.png`), fullPage });
}

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
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
}

const L = (nb: string) => ({ "en-GB": nb, nb, nn: nb });
const stempel = Date.now();
const KURSNAVN = `Stage-test 934 UI kurs ${stempel}`;
const tilstand: { kursId?: string; seksjoner: string[]; seksjonsnavn: string[]; bevisV1?: string; bevisV2?: string } = { seksjoner: [], seksjonsnavn: [] };

type Bevis = { courseId: string; certificateId: string; versionMajor: number; versionMinor: number; current: boolean };

async function lagSeksjon(navn: string) {
  const tittel = `Stage-test 934 UI ${navn} ${stempel}`;
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(tittel), bodyMarkdown: L(`Innhold ${navn}.`) });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  const id = seksjon.json.section.id as string;
  expect((await api("POST", `/api/admin/content/sections/${id}/publish`)).status).toBe(200);
  tilstand.seksjoner.push(id);
  tilstand.seksjonsnavn.push(tittel);
  return id;
}

async function bevisForKurset(): Promise<Bevis[]> {
  const liste = await api("GET", "/api/courses/completions");
  expect(liste.status, liste.tekst.slice(0, 300)).toBe(200);
  return (liste.json.completions as Bevis[]).filter((c) => c.courseId === tilstand.kursId).sort((a, b) => a.versionMajor - b.versionMajor);
}

async function versjon() {
  const detalj = await api("GET", `/api/admin/content/courses/${tilstand.kursId}`);
  expect(detalj.status, detalj.tekst.slice(0, 300)).toBe(200);
  const { versionMajor, versionMinor, certificateHolders } = detalj.json.course;
  return { versionMajor, versionMinor, certificateHolders };
}

test.afterAll(async () => {
  if (tilstand.kursId) {
    await api("POST", `/api/admin/content/courses/${tilstand.kursId}/unpublish`);
    noter("arkiver testkurs", (await api("POST", `/api/admin/content/courses/${tilstand.kursId}/archive`)).status);
  }
});

test("1. et lesekurs publiseres som 1.0, og testkontoen får kursbevis for versjon 1", async () => {
  test.setTimeout(150_000);
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  const a = await lagSeksjon("A");
  const b = await lagSeksjon("B");
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(KURSNAVN), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items: [{ type: "SECTION", sectionId: a }, { type: "SECTION", sectionId: b }] })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish`)).status).toBe(200);
  for (const id of [a, b]) expect([200, 201, 204]).toContain((await api("POST", `/api/courses/${tilstand.kursId}/sections/${id}/read`)).status);
  const bevis = await bevisForKurset();
  noter("bevis etter 1.0", bevis.map((c) => `${c.versionMajor}.${c.versionMinor}:${c.current}`));
  expect(bevis.map((c) => [c.versionMajor, c.current])).toEqual([[1, true]]);
  tilstand.bevisV1 = bevis[0].certificateId;
  expect(await versjon()).toEqual({ versionMajor: 1, versionMinor: 0, certificateHolders: 1 });
  // Den tredje seksjonen lages nå, publisert og klar i biblioteket — den legges inn i kurset fra skjemaet.
  await lagSeksjon("C");
});

test("2. kursskjemaet: v1.0, legg til en seksjon, «Hva slags endring er dette?», hovedversjon → v2.0", async ({ page }) => {
  test.setTimeout(240_000);
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/courses/${tilstand.kursId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#formSaveBtn")).toBeVisible({ timeout: 45_000 });
  const chip = page.locator(".course-version-chip").first();
  await expect(chip).toHaveText("v1.0", { timeout: 30_000 });
  await bilde(page, "2a-skjema-v1-1280");

  const input = page.locator("#comboboxInput");
  await input.click();
  await input.fill(tilstand.seksjonsnavn[2]);
  const valg = page.locator("#comboboxDropdown .combobox-option", { hasText: tilstand.seksjonsnavn[2] }).first();
  await expect(valg).toBeVisible({ timeout: 30_000 });
  await valg.click();
  await expect(page.locator("#addItemBtn")).toBeEnabled();
  await page.locator("#addItemBtn").click();
  await page.locator("#formSaveBtn").click();

  const dialog = page.locator("#courseVersionDialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#courseVersionTitle")).toHaveText("Hva slags endring er dette?");
  const forklaring = (await page.locator("#courseVersionText").innerText()).trim();
  noter("dialogtekst", forklaring);
  expect(forklaring).toMatch(/1/);
  // Mindre er valgt fra start.
  await expect(dialog.locator('input[name="courseVersionChoice"][value="minor"]')).toBeChecked();
  await bilde(page, "2b-dialog-1280", false);
  await dialog.locator('input[name="courseVersionChoice"][value="major"]').check();
  const konsekvens = (await dialog.locator("[data-version-consequence]").innerText()).trim();
  noter("konsekvens ved hovedversjon", konsekvens);
  await expect(page.locator("#courseVersionSaveBtn")).toContainText("2.0");
  await page.setViewportSize({ width: 390, height: 844 });
  await bilde(page, "2c-dialog-390", false);
  const dialogBoks = await dialog.boundingBox();
  noter("dialogbredde på 390 px", dialogBoks?.width);
  expect(dialogBoks!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBoks!.x + dialogBoks!.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#courseVersionSaveBtn").click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await expect.poll(async () => (await versjon()).versionMajor, { timeout: 45_000 }).toBe(2);
  const v = await versjon();
  noter("versjon etter lagring", v);
  expect(v).toEqual({ versionMajor: 2, versionMinor: 0, certificateHolders: 0 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".course-version-chip").first()).toHaveText("v2.0", { timeout: 45_000 });
  await bilde(page, "2d-skjema-v2-1280");

  await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
  const rad = page.locator("tr", { hasText: KURSNAVN }).first();
  await expect(rad).toBeVisible({ timeout: 45_000 });
  await expect(rad).toContainText("v2.0");
  await rad.scrollIntoViewIfNeeded();
  await bilde(page, "2e-kursliste-v2-1280", false);
});

test("3. «Mine kurs»: «Ny versjon», forklaringen og «Kursbevis, versjon 1»; de to gamle står som lest", async ({ page }) => {
  test.setTimeout(150_000);
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/participant`, { waitUntil: "domcontentloaded" });
  const kort = page.locator(".course-accordion-item", { hasText: KURSNAVN }).first();
  await expect(kort).toBeVisible({ timeout: 45_000 });
  await expect(kort.locator(".course-new-version-badge")).toHaveText("Ny versjon");
  const fremdrift = (await kort.locator(".course-accordion-progress").innerText()).trim();
  noter("fremdrift etter hovedversjon", fremdrift);
  expect(fremdrift).toContain("2/3");
  await kort.locator(".course-accordion-header").click();
  const lenke = kort.locator("a.course-certificate-link--earlier");
  await expect(lenke).toBeVisible({ timeout: 30_000 });
  await expect(lenke).toContainText("Kursbevis, versjon 1");
  await expect(lenke).toHaveAttribute("href", `/certificate?id=${tilstand.bevisV1}`);
  const hint = (await kort.locator(".course-new-version-note").innerText()).trim();
  noter("forklaring på kortet", hint);
  // Båten seiler på et kurs i gang.
  await expect(kort.locator(".course-boat")).toHaveCount(1);
  await kort.scrollIntoViewIfNeeded();
  await bilde(page, "3a-mine-kurs-ny-versjon-1280", false);
  await page.setViewportSize({ width: 390, height: 844 });
  await kort.scrollIntoViewIfNeeded();
  await bilde(page, "3b-mine-kurs-ny-versjon-390", false);
});

test("3c. Resultater: deltakeren med bare et eldre bevis står som «Må ta ny versjon»", async ({ page }) => {
  test.setTimeout(150_000);
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/results`, { waitUntil: "domcontentloaded" });
  const ingenTilgang = page.locator("#resultsNoAccess");
  const knapp = page.locator("#courseReportBody .report-row-button", { hasText: KURSNAVN }).first();
  await expect.poll(async () => (await ingenTilgang.isVisible()) || (await knapp.isVisible()), { timeout: 60_000 }).toBe(true);
  if (await ingenTilgang.isVisible()) {
    noter("resultater", "ingen tilgang for testkontoen — hoppet over");
    await bilde(page, "3c-resultater-ingen-tilgang", false);
    test.skip(true, "testkontoen har ikke tilgang til Resultater");
  }
  await knapp.click();
  const rad = page.locator("#courseLearnerBody tr").first();
  await expect(rad).toBeVisible({ timeout: 45_000 });
  const tekst = (await page.locator("#courseLearnerBody").innerText()).trim();
  noter("resultater, deltakerrader", tekst.slice(0, 400));
  await bilde(page, "3c-resultater-ma-ta-ny-versjon", true);
  expect(tekst).toContain("Må ta ny versjon");
});

test("4. bevis for 1 uten versjonslinje; ny seksjon lest → bevis for 2 med «Versjon 2», profil og grønn linje", async ({ page }) => {
  test.setTimeout(240_000);
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/certificate?id=${tilstand.bevisV1}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#certificate")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("#certVersionWrap")).toBeHidden();
  await bilde(page, "4a-kursbevis-v1", false);

  expect([200, 201, 204]).toContain((await api("POST", `/api/courses/${tilstand.kursId}/sections/${tilstand.seksjoner[2]}/read`)).status);
  const bevis = await bevisForKurset();
  noter("bevis etter at den nye er lest", bevis.map((c) => `${c.versionMajor}.${c.versionMinor}:${c.current}`));
  expect(bevis.map((c) => [c.versionMajor, c.current])).toEqual([[1, false], [2, true]]);
  expect(bevis[0].certificateId).toBe(tilstand.bevisV1);
  tilstand.bevisV2 = bevis[1].certificateId;

  await page.goto(`${BASE}/certificate?id=${tilstand.bevisV2}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#certificate")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("#certVersionWrap")).toBeVisible();
  await expect(page.locator("#certVersionWrap")).toHaveText(/Versjon\s+2/);
  await bilde(page, "4b-kursbevis-v2", false);

  await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded" });
  const v2rad = page.locator("#coursesBody tr", { has: page.locator(`a[href="/certificate?id=${tilstand.bevisV2}"]`) });
  await expect(v2rad).toBeVisible({ timeout: 45_000 });
  await expect(v2rad.locator("td").first()).toHaveText(`${KURSNAVN} (versjon 2)`);
  const v1rad = page.locator("#coursesBody tr", { has: page.locator(`a[href="/certificate?id=${tilstand.bevisV1}"]`) });
  await expect(v1rad.locator("td").first()).toHaveText(KURSNAVN);
  await v2rad.scrollIntoViewIfNeeded();
  await bilde(page, "4c-profil-versjon-2", false);

  await page.goto(`${BASE}/participant`, { waitUntil: "domcontentloaded" });
  const kort = page.locator(".course-accordion-item", { hasText: KURSNAVN }).first();
  await expect(kort).toBeVisible({ timeout: 45_000 });
  await expect(kort.locator(".course-new-version-badge")).toHaveCount(0);
  await expect(kort.locator(".course-progress-fill.completed")).toHaveCount(1);
  await expect(kort.locator(".course-boat")).toHaveCount(0);
  await kort.scrollIntoViewIfNeeded();
  await bilde(page, "4d-mine-kurs-fullfort", false);
});

test("5. en seksjon lagres med ny tekst fra sin egen side → 2.1, kursbevisene urørt og lesingene står", async () => {
  test.setTimeout(150_000);
  const før = await bevisForKurset();
  const lagret = await api("PUT", `/api/admin/content/sections/${tilstand.seksjoner[0]}/content`, { bodyMarkdown: L("Innhold A, rettet skrivefeil.") });
  expect(lagret.status, lagret.tekst.slice(0, 300)).toBe(200);
  noter("seksjon lagret, holdt tilbake av språkporten", lagret.json.heldBackByTranslationGate ?? null);
  await expect.poll(async () => (await versjon()).versionMinor, { timeout: 30_000 }).toBe(1);
  const v = await versjon();
  noter("versjon etter seksjonslagring", v);
  expect(v.versionMajor).toBe(2);
  const etter = await bevisForKurset();
  expect(etter.map((c) => [c.certificateId, c.versionMajor, c.current])).toEqual(før.map((c) => [c.certificateId, c.versionMajor, c.current]));
  const detalj = await api("GET", `/api/courses/${tilstand.kursId}`);
  const lest = Object.fromEntries((detalj.json.course.items as Array<{ type: string; sectionId: string; read: boolean }>).filter((i) => i.type === "SECTION").map((i) => [i.sectionId, i.read]));
  noter("lest etter mindre versjon", lest);
  expect(Object.values(lest).every(Boolean)).toBe(true);
});

test("5b. kurslista viser v2.1", async ({ page }) => {
  test.setTimeout(120_000);
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
  const rad = page.locator("tr", { hasText: KURSNAVN }).first();
  await expect(rad).toBeVisible({ timeout: 45_000 });
  await expect(rad).toContainText("v2.1");
  await rad.scrollIntoViewIfNeeded();
  await bilde(page, "5-kursliste-v2-1", false);
});
