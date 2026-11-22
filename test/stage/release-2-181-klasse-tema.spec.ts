import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";

// 2.181.0 mot UTRULLET stage, med ekte data (#1168, fjerde skive: klassen og temaet):
//
//   A. Klasselista: «Arkiver» åpner sidas dialog som sier hva som skjer med kursene; Avbryt arkiverer ikke, bekreft arkiverer.
//      «Gjenopprett» spør ikke, og meldingen navngir klassen. «Slett» i hodet: sidas dialog, rød knapp, sletter.
//   B. Temaets forhåndsvisning er administratorens, som slettingen: testkontoen (fagansvarlig) får 403.
//
// Det testen skriver på stage: én klasse («Stage-test 2.181.0 …») uten medlemmer og kurs; den slettes i testen, og ryddingen
// arkiverer og sletter den hvis noe feilet før det. ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal
// ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.181.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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
const nettleserSpørsmål: string[] = [];
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
  // Nettleserens spørreboks skal ikke dukke opp. Gjør den det, sier testen nei, og ingenting sendes.
  page.on("dialog", (d) => { nettleserSpørsmål.push(d.message()); void d.dismiss(); });
}

async function trykk(rad: Locator, handling: string) {
  const knapp = rad.locator(`[data-action="${handling}"]`).first();
  await knapp.waitFor({ state: "attached" });
  const meny = knapp.locator("xpath=ancestor::details[contains(@class, 'row-more')]");
  if ((await meny.count()) > 0 && !(await meny.first().evaluate((el) => (el as HTMLDetailsElement).open))) await meny.first().locator("summary").click();
  await knapp.click();
}

const stempel = Date.now();
const klassesti = (id: string) => `/api/admin/content/classes/${id}`;
const tilstand = { klasseId: "", navn: `Stage-test 2.181.0 klasse ${stempel}`, slettet: false };
const arkivert = async () => {
  const liste = await api("GET", "/api/admin/content/classes");
  return Boolean((liste.json.classes ?? []).find((k: { id: string; archivedAt?: string | null }) => k.id === tilstand.klasseId)?.archivedAt);
};

test.afterAll(async () => {
  if (!tilstand.klasseId || tilstand.slettet) return;
  await api("POST", `${klassesti(tilstand.klasseId)}/archive`);
  const s = await api("DELETE", klassesti(tilstand.klasseId));
  noter("rydding: klasse", s.status);
  expect(s.status < 300 || s.status === 404, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toBe(true);
});

test("versjonen er minst 2.181.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.181.0"));
});

test("A: klassen: «Arkiver» med sidas dialog, «Gjenopprett» uten spørsmål, «Slett» med rød knapp", async ({ page }) => {
  test.setTimeout(300_000);
  const klasse = await api("POST", "/api/admin/content/classes", { name: tilstand.navn });
  expect(klasse.status, klasse.tekst.slice(0, 300)).toBe(201);
  tilstand.klasseId = klasse.json.class.id;

  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/deltakere/klasser`, { waitUntil: "domcontentloaded" });
  const rad = page.locator("#classesTableBody tr", { hasText: tilstand.navn });
  await expect(rad).toBeVisible({ timeout: 45_000 });

  const dialog = page.locator("#moduleLifecycleDialog");
  await trykk(rad, "archive");
  await expect(dialog).toHaveAttribute("data-module-dialog", "archive", { timeout: 45_000 });
  await expect(page.locator("#moduleLifecycleDialogTitle")).toHaveText(`Arkivere «${tilstand.navn}»?`);
  await expect(page.locator("#moduleLifecycleDialogText")).toContainText("påminnelsene stopper");
  fs.mkdirSync(RAPPORT, { recursive: true });
  await page.screenshot({ path: path.join(RAPPORT, "2181-klasse-arkiver.png") });
  await page.locator("#moduleLifecycleDialogCancelBtn").click();
  expect(await arkivert(), "Avbryt skal ikke arkivere").toBe(false);

  await trykk(rad, "archive");
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  await expect.poll(arkivert, { timeout: 45_000 }).toBe(true);

  await page.locator('.list-filter-btn[data-filter="archived"]').click();
  const arkivRad = page.locator("#classesTableBody tr", { hasText: tilstand.navn });
  await expect(arkivRad).toBeVisible({ timeout: 45_000 });
  await trykk(arkivRad, "restore");
  await expect(page.locator(".toast__message").last()).toHaveText(`Klassen «${tilstand.navn}» er gjenopprettet.`, { timeout: 45_000 });
  expect(await arkivert()).toBe(false);

  // «Slett» krever en arkivert klasse: arkiver gjennom API-et, og slett fra hodet.
  expect((await api("POST", `${klassesti(tilstand.klasseId)}/archive`)).status).toBe(200);
  await page.goto(`${BASE}/deltakere/klasser?id=${tilstand.klasseId}`, { waitUntil: "domcontentloaded" });
  const slett = page.locator('.form-page-actions [data-action="delete"]');
  await slett.waitFor({ state: "attached", timeout: 45_000 });
  if (!(await slett.isVisible())) await page.locator(".form-page-actions details.row-more > summary").click();
  await slett.click();
  await expect(dialog).toHaveAttribute("data-module-dialog", "delete", { timeout: 45_000 });
  await expect(page.locator("#moduleLifecycleDialogConfirmBtn")).toHaveClass(/btn-danger/);
  const slettSvar = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().endsWith(`/classes/${tilstand.klasseId}`), { timeout: 45_000 });
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  const svar = await slettSvar;
  noter("A: slett", svar.status());
  expect(svar.status()).toBeLessThan(300);
  tilstand.slettet = true;
  expect(nettleserSpørsmål).toEqual([]);
});

test("B: temaets slette-forhåndsvisning er administratorens: fagansvarlig får 403", async () => {
  const temaer = await api("GET", "/api/admin/content/themes");
  expect(temaer.status).toBe(200);
  const tema = (temaer.json.themes ?? [])[0];
  if (!tema) {
    noter("B: tema", "ingen tema på stage; kontrollen hoppet over");
    return;
  }
  const nei = await api("GET", `/api/admin/content/themes/${tema.id}/delete-preview`);
  noter("B: forhåndsvisning som fagansvarlig", nei.status);
  expect(nei.status).toBe(403);
});
