import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.178.0 mot UTRULLET stage, med ekte data (#1168, første skive: modulens «Arkiver», «Gjenopprett» og «Slett» i kursets mønster):
//
//   A. API: forhåndsvisningen (`GET …/archive-preview`) navngir kurset som holder modulen igjen, og sperren i `POST …/archive`
//      sier det samme. Tatt ut av kurset: ingen holder den igjen. Kontroll: en annens modul → 403 `content_ownership`.
//   B. I nettleseren: «Arkiver» på en modul i et kurs viser kurset med lenke og bare «Lukk»; ingenting arkiveres.
//   C. I nettleseren: tatt ut av kurset → dialogen sier hva som skjer, «Arkiver modulen» arkiverer; «Gjenopprett» sier
//      «… er gjenopprettet som utkast»; «Slett» har sidas dialog og sletter.
//
// Det testen skriver på stage: ett kurs og én modul («Stage-test 2.178.0 …»). Modulen slettes i testen; feiler den før det,
// arkiverer og sletter ryddingen det som står igjen. ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal
// ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.178.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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
  // Nettleserens spørreboks skal ikke dukke opp lenger. Gjør den det, sier testen nei, og ingenting sendes.
  page.on("dialog", (d) => void d.dismiss());
}

const L = (en: string, nb: string = en) => ({ "en-GB": en, nb, nn: nb });
const stempel = Date.now();
const navn = (hva: string) => `Stage-test 2.178.0 ${hva} ${stempel}`;
const modulsti = (id: string) => `/api/admin/content/modules/${id}`;
const kurssti = (id: string) => `/api/admin/content/courses/${id}`;

const tilstand = { modulId: "", modulNavn: navn("modul"), kursId: "", kursNavn: navn("kurs"), slettet: false };

test.afterAll(async () => {
  const mislyktes: string[] = [];
  if (tilstand.kursId) {
    await arkiverKurs(api, tilstand.kursId);
    const s = await api("DELETE", kurssti(tilstand.kursId));
    noter("rydding: kurs", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`kurs ${tilstand.kursId.slice(-6)}`);
  }
  if (tilstand.modulId && !tilstand.slettet) {
    await api("POST", `${modulsti(tilstand.modulId)}/archive`, {});
    const s = await api("DELETE", modulsti(tilstand.modulId));
    noter("rydding: modul", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`modul ${tilstand.modulId.slice(-6)}`);
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.178.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.178.0"));
});

test("A: forhåndsvisningen og sperren navngir det samme kurset; uten kurs holder ingen modulen igjen; en annens modul → 403", async () => {
  test.setTimeout(180_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: L(tilstand.modulNavn), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  tilstand.modulId = modul.json.module.id;
  const kurs = await api("POST", "/api/admin/content/courses", { enrollmentPolicy: "OPEN", title: L(tilstand.kursNavn), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("PUT", `${kurssti(tilstand.kursId)}/items`, { items: [{ type: "MODULE", moduleId: tilstand.modulId }] })).status).toBe(204);

  const sett = await api("GET", `${modulsti(tilstand.modulId)}/archive-preview`);
  noter("A: forhåndsvisning i kurs", sett.json);
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(200);
  expect(sett.json).toEqual({
    moduleId: tilstand.modulId,
    archived: false,
    published: false,
    uses: [{ courseId: tilstand.kursId, title: tilstand.kursNavn, via: "course" }],
  });
  const sperret = await api("POST", `${modulsti(tilstand.modulId)}/archive`, {});
  noter("A: sperren", { status: sperret.status, error: sperret.json.error, details: sperret.json.details });
  expect([sperret.status, sperret.json.error]).toEqual([400, "content_in_use"]);
  expect(sperret.json.details.courseTitles).toEqual([tilstand.kursNavn]);

  // KONTROLL: en modul testkontoen ikke eier (fra prod-kopien) gir 403 på forhåndsvisningen.
  const bibliotek = await api("GET", "/api/admin/content/modules/library?locale=nb");
  const annens = (bibliotek.json.modules ?? []).find((m: { canManage?: boolean; archivedAt?: string | null }) => m.canManage === false);
  if (annens) {
    const nei = await api("GET", `${modulsti(annens.id)}/archive-preview`);
    noter("A: annens modul", { status: nei.status, error: nei.json.error });
    expect([nei.status, nei.json.error]).toEqual([403, "content_ownership"]);
  } else {
    noter("A: annens modul", "fant ingen modul testkontoen ikke eier; kontrollen hoppet over");
  }
});

async function aapneBibliotek(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content`, { waitUntil: "domcontentloaded" });
  const rad = page.locator("tr", { hasText: tilstand.modulNavn });
  await expect(rad).toBeVisible({ timeout: 45_000 });
  return rad;
}

async function trykk(rad: import("@playwright/test").Locator, handling: string) {
  const knapp = rad.locator(`[data-action="${handling}"]`).first();
  await knapp.waitFor({ state: "attached" });
  const meny = knapp.locator("xpath=ancestor::details[contains(@class, 'row-more')]");
  if ((await meny.count()) > 0 && !(await meny.first().evaluate((el) => (el as HTMLDetailsElement).open))) await meny.first().locator("summary").click();
  await knapp.click();
}

test("B: «Arkiver» på en modul i et kurs viser kurset med lenke og bare «Lukk»; ingenting arkiveres", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.kursId, "testdataene ble ikke laget");
  await forberedSide(page);
  const arkiveringer: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith(`/modules/${tilstand.modulId}/archive`)) arkiveringer.push(r.url()); });
  const rad = await aapneBibliotek(page);
  await trykk(rad, "archive");

  const dialog = page.locator("#moduleLifecycleDialog");
  await expect(dialog).toHaveAttribute("data-module-dialog", "archive-blocked", { timeout: 45_000 });
  await expect(page.locator("#moduleLifecycleDialogText")).toHaveText("Modulen er i bruk i 1 kurs. Ta den ut av kurset først, så kan den arkiveres.");
  const lenke = dialog.locator('[data-lifecycle-part="usedIn"] a');
  await expect(lenke).toHaveText(tilstand.kursNavn);
  await expect(lenke).toHaveAttribute("href", `/admin-content/courses/${tilstand.kursId}`);
  await expect(page.locator("#moduleLifecycleDialogConfirmBtn")).toBeHidden();
  fs.mkdirSync(RAPPORT, { recursive: true });
  await page.screenshot({ path: path.join(RAPPORT, "2178-arkiver-sperret.png") });
  await page.locator("#moduleLifecycleDialogCancelBtn").click();
  await expect(dialog).toBeHidden();
  expect(arkiveringer).toEqual([]);
});

test("C: uten kurs: «Arkiver modulen» arkiverer, «Gjenopprett» sier utkast, «Slett» har sidas dialog og sletter", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!tilstand.kursId, "testdataene ble ikke laget");
  expect((await api("PUT", `${kurssti(tilstand.kursId)}/items`, { items: [] })).status).toBe(204);
  await forberedSide(page);
  const rad = await aapneBibliotek(page);

  await trykk(rad, "archive");
  const dialog = page.locator("#moduleLifecycleDialog");
  await expect(dialog).toHaveAttribute("data-module-dialog", "archive", { timeout: 45_000 });
  await expect(page.locator("#moduleLifecycleDialogConfirmBtn")).toHaveText("Arkiver modulen");
  await page.screenshot({ path: path.join(RAPPORT, "2178-arkiver.png") });
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  await expect(page.locator(".toast__message").last()).toHaveText("Modul arkivert.", { timeout: 45_000 });
  await expect.poll(async () => (await api("GET", `${modulsti(tilstand.modulId)}/archive-preview`)).json.archived, { timeout: 30_000 }).toBe(true);

  await page.locator('.list-filter-btn[data-filter="archived"]').click();
  const arkivRad = page.locator("tr", { hasText: tilstand.modulNavn });
  await expect(arkivRad).toBeVisible({ timeout: 45_000 });
  await trykk(arkivRad, "restore");
  await expect(page.locator(".toast__message").last()).toHaveText(`«${tilstand.modulNavn}» er gjenopprettet som utkast. Publiser den når du er klar.`, { timeout: 45_000 });
  expect((await api("GET", `${modulsti(tilstand.modulId)}/archive-preview`)).json.archived).toBe(false);

  // «Slett» krever en arkivert modul: arkiver gjennom API-et, og slett fra lista.
  expect((await api("POST", `${modulsti(tilstand.modulId)}/archive`, {})).status).toBe(200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('.list-filter-btn[data-filter="archived"]').click();
  const igjen = page.locator("tr", { hasText: tilstand.modulNavn });
  await expect(igjen).toBeVisible({ timeout: 45_000 });
  const slettSvar = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes(`/modules/${tilstand.modulId}`), { timeout: 45_000 });
  await trykk(igjen, "delete");
  await expect(dialog).toHaveAttribute("data-module-dialog", "delete");
  await expect(page.locator("#moduleLifecycleDialogTitle")).toHaveText(`Slett «${tilstand.modulNavn}»`);
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  const svar = await slettSvar;
  noter("C: slett", svar.status());
  expect(svar.status()).toBeLessThan(300);
  tilstand.slettet = true;
  await expect(igjen).toHaveCount(0, { timeout: 30_000 });
});
