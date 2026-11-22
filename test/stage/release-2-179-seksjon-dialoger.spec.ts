import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.179.0 mot UTRULLET stage, med ekte data (#1168, andre skive: seksjonens «Arkiver», «Gjenopprett» og «Slett»):
//
//   A. API: forhåndsvisningen (`GET …/sections/:id/archive-preview`) navngir kurset som holder seksjonen igjen, og sperren i
//      `POST …/archive` sier det samme. Kontroll: en annens seksjon → 403 `content_ownership`.
//   B. Seksjonslista: «Arkiver» på en seksjon i et kurs viser kurset med lenke og bare «Lukk»; ingenting arkiveres.
//   C. Redigereren: tatt ut av kurset → dialogen sier hva som skjer (også avpublisering), «Arkiver seksjonen» arkiverer;
//      «Gjenopprett» sier «… er gjenopprettet som utkast»; «Slett» har sidas dialog og sletter.
//
// Det testen skriver på stage: ett kurs og én seksjon («Stage-test 2.179.0 …»). Seksjonen slettes i testen; feiler den før det,
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
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.179.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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
  page.on("dialog", (d) => { noter("nettleserens spørreboks (skal ikke skje)", d.message()); void d.dismiss(); });
}

const L = (en: string, nb: string = en) => ({ "en-GB": en, nb, nn: nb });
const stempel = Date.now();
const navn = (hva: string) => `Stage-test 2.179.0 ${hva} ${stempel}`;
const seksjonssti = (id: string) => `/api/admin/content/sections/${id}`;
const kurssti = (id: string) => `/api/admin/content/courses/${id}`;

const tilstand = { seksjonId: "", seksjonNavn: navn("seksjon"), kursId: "", kursNavn: navn("kurs"), slettet: false };

test.afterAll(async () => {
  const mislyktes: string[] = [];
  if (tilstand.kursId) {
    await arkiverKurs(api, tilstand.kursId);
    const s = await api("DELETE", kurssti(tilstand.kursId));
    noter("rydding: kurs", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`kurs ${tilstand.kursId.slice(-6)}`);
  }
  if (tilstand.seksjonId && !tilstand.slettet) {
    await api("POST", `${seksjonssti(tilstand.seksjonId)}/archive`, {});
    const s = await api("DELETE", seksjonssti(tilstand.seksjonId));
    noter("rydding: seksjon", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`seksjon ${tilstand.seksjonId.slice(-6)}`);
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.179.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.179.0"));
});

test("A: forhåndsvisningen og sperren navngir det samme kurset; en annens seksjon → 403", async () => {
  test.setTimeout(180_000);
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(tilstand.seksjonNavn), bodyMarkdown: L(`Innhold ${stempel}.`) });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  tilstand.seksjonId = seksjon.json.section.id;
  expect((await api("POST", `${seksjonssti(tilstand.seksjonId)}/publish`)).status).toBe(200);
  const kurs = await api("POST", "/api/admin/content/courses", { enrollmentPolicy: "OPEN", title: L(tilstand.kursNavn), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("PUT", `${kurssti(tilstand.kursId)}/items`, { items: [{ type: "SECTION", sectionId: tilstand.seksjonId }] })).status).toBe(204);

  const sett = await api("GET", `${seksjonssti(tilstand.seksjonId)}/archive-preview`);
  noter("A: forhåndsvisning i kurs", sett.json);
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(200);
  expect(sett.json).toEqual({
    sectionId: tilstand.seksjonId,
    archived: false,
    published: true,
    uses: [{ courseId: tilstand.kursId, title: tilstand.kursNavn, via: "course" }],
  });
  const sperret = await api("POST", `${seksjonssti(tilstand.seksjonId)}/archive`, {});
  noter("A: sperren", { status: sperret.status, error: sperret.json.error, details: sperret.json.details });
  expect([sperret.status, sperret.json.error]).toEqual([400, "content_in_use"]);
  expect(sperret.json.details.courseTitles).toEqual([tilstand.kursNavn]);

  // KONTROLL: en seksjon testkontoen ikke eier (fra prod-kopien) gir 403 på forhåndsvisningen.
  const liste = await api("GET", "/api/admin/content/sections");
  const annens = (liste.json.sections ?? []).find((s: { canManage?: boolean }) => s.canManage === false);
  if (annens) {
    const nei = await api("GET", `${seksjonssti(annens.id)}/archive-preview`);
    noter("A: annens seksjon", { status: nei.status, error: nei.json.error });
    expect([nei.status, nei.json.error]).toEqual([403, "content_ownership"]);
  } else {
    noter("A: annens seksjon", "fant ingen seksjon testkontoen ikke eier; kontrollen hoppet over");
  }
});

async function trykk(rad: Locator, handling: string) {
  const knapp = rad.locator(`[data-action="${handling}"]`).first();
  await knapp.waitFor({ state: "attached" });
  const meny = knapp.locator("xpath=ancestor::details[contains(@class, 'row-more')]");
  if ((await meny.count()) > 0 && !(await meny.first().evaluate((el) => (el as HTMLDetailsElement).open))) await meny.first().locator("summary").click();
  await knapp.click();
}

async function trykkIHodet(page: Page, handling: string) {
  const knapp = page.locator(`.form-page-actions [data-editor-action="${handling}"]`);
  await knapp.waitFor({ state: "attached", timeout: 45_000 });
  if (!(await knapp.isVisible())) await page.locator(".form-page-actions details.row-more > summary").click();
  await knapp.click();
}

test("B: seksjonslista: «Arkiver» på en seksjon i et kurs viser kurset med lenke og bare «Lukk»; ingenting arkiveres", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.kursId, "testdataene ble ikke laget");
  await forberedSide(page);
  const arkiveringer: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith(`/sections/${tilstand.seksjonId}/archive`)) arkiveringer.push(r.url()); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/sections`, { waitUntil: "domcontentloaded" });
  const rad = page.locator("#sectionsTableBody tr", { hasText: tilstand.seksjonNavn });
  await expect(rad).toBeVisible({ timeout: 45_000 });
  await trykk(rad, "archive");

  const dialog = page.locator("#moduleLifecycleDialog");
  await expect(dialog).toHaveAttribute("data-module-dialog", "archive-blocked", { timeout: 45_000 });
  await expect(page.locator("#moduleLifecycleDialogText")).toHaveText("Seksjonen er i bruk i 1 kurs. Ta den ut av kurset først, så kan den arkiveres.");
  const lenke = dialog.locator('[data-lifecycle-part="usedIn"] a');
  await expect(lenke).toHaveText(tilstand.kursNavn);
  await expect(lenke).toHaveAttribute("href", `/admin-content/courses/${tilstand.kursId}`);
  await expect(page.locator("#moduleLifecycleDialogConfirmBtn")).toBeHidden();
  fs.mkdirSync(RAPPORT, { recursive: true });
  await page.screenshot({ path: path.join(RAPPORT, "2179-seksjon-sperret.png") });
  await page.locator("#moduleLifecycleDialogCancelBtn").click();
  await expect(dialog).toBeHidden();
  expect(arkiveringer).toEqual([]);
});

test("C: redigereren uten kurs: «Arkiver seksjonen» arkiverer, «Gjenopprett» sier utkast, «Slett» har sidas dialog og sletter", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!tilstand.kursId, "testdataene ble ikke laget");
  expect((await api("PUT", `${kurssti(tilstand.kursId)}/items`, { items: [] })).status).toBe(204);
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/sections?id=${tilstand.seksjonId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#titleInput")).toHaveValue(tilstand.seksjonNavn, { timeout: 45_000 });

  await trykkIHodet(page, "archive");
  const dialog = page.locator("#moduleLifecycleDialog");
  await expect(dialog).toHaveAttribute("data-module-dialog", "archive", { timeout: 45_000 });
  await expect(dialog.locator('[data-lifecycle-part="unpublishes"]')).toHaveText("Den avpubliseres også.");
  await expect(page.locator("#moduleLifecycleDialogConfirmBtn")).toHaveText("Arkiver seksjonen");
  await page.screenshot({ path: path.join(RAPPORT, "2179-seksjon-arkiver.png") });
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  await expect(page.locator(".toast__message").last()).toHaveText("Seksjon arkivert.", { timeout: 45_000 });
  const etter = await api("GET", `${seksjonssti(tilstand.seksjonId)}/archive-preview`);
  expect([etter.json.archived, etter.json.published]).toEqual([true, false]);

  await trykkIHodet(page, "restore");
  await expect(page.locator(".toast__message").last()).toHaveText(`«${tilstand.seksjonNavn}» er gjenopprettet som utkast. Publiser den når du er klar.`, { timeout: 45_000 });
  expect((await api("GET", `${seksjonssti(tilstand.seksjonId)}/archive-preview`)).json.archived).toBe(false);

  // «Slett» krever en arkivert seksjon: arkiver gjennom API-et, og slett fra redigereren.
  expect((await api("POST", `${seksjonssti(tilstand.seksjonId)}/archive`, {})).status).toBe(200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#titleInput")).toHaveValue(tilstand.seksjonNavn, { timeout: 45_000 });
  const slettSvar = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().endsWith(`/sections/${tilstand.seksjonId}`), { timeout: 45_000 });
  await trykkIHodet(page, "delete");
  await expect(dialog).toHaveAttribute("data-module-dialog", "delete");
  await expect(page.locator("#moduleLifecycleDialogTitle")).toHaveText(`Slett «${tilstand.seksjonNavn}»`);
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  const svar = await slettSvar;
  noter("C: slett", svar.status());
  expect(svar.status()).toBeLessThan(300);
  tilstand.slettet = true;
});
