import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.180.0 mot UTRULLET stage, med ekte data (#1168, tredje skive: kurset):
//
//   A. Kurssida: «Avpubliser» i hodet åpner sidas dialog («Avpublisere «…»?») med «Hvem mister tilgangen» fra tjenerens tall;
//      Avbryt lar kurset stå publisert; «Avpubliser» avpubliserer.
//   B. Kurslista: «Slett» på det arkiverte kurset sier at modulene og seksjonene blir stående; Avbryt sletter ingenting.
//
// Det testen skriver på stage: ett kurs og én seksjon («Stage-test 2.180.0 …»); kurset er begrenset og ikke tildelt noen, så
// ingen deltakere ser det. Ryddingen arkiverer og sletter begge. ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.180.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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

const L = (en: string, nb: string = en) => ({ "en-GB": en, nb, nn: nb });
const stempel = Date.now();
const kurssti = (id: string) => `/api/admin/content/courses/${id}`;
const tilstand = { kursId: "", kursNavn: `Stage-test 2.180.0 kurs ${stempel}`, seksjonId: "" };
const seksjonssti = (id: string) => `/api/admin/content/sections/${id}`;

const publisert = async () => Boolean((await api("GET", kurssti(tilstand.kursId))).json?.course?.publishedAt);

test.afterAll(async () => {
  const mislyktes: string[] = [];
  if (tilstand.kursId) {
    await arkiverKurs(api, tilstand.kursId);
    const s = await api("DELETE", kurssti(tilstand.kursId));
    noter("rydding: kurs", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push("kurs");
  }
  if (tilstand.seksjonId) {
    await api("POST", `${seksjonssti(tilstand.seksjonId)}/archive`, {});
    const s = await api("DELETE", seksjonssti(tilstand.seksjonId));
    noter("rydding: seksjon", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push("seksjon");
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.180.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.180.0"));
});

test("A: «Avpubliser» i kurssidas hode: sidas dialog med «Hvem mister tilgangen»; Avbryt beholder, Avpubliser avpubliserer", async ({ page }) => {
  test.setTimeout(300_000);
  const kurs = await api("POST", "/api/admin/content/courses", { enrollmentPolicy: "RESTRICTED", title: L(tilstand.kursNavn), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  // Et kurs uten innhold kan ikke publiseres (`course_has_no_items`): én seksjon, publisert sammen med kurset.
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(`Stage-test 2.180.0 seksjon ${stempel}`), bodyMarkdown: L("Innhold.") });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  tilstand.seksjonId = seksjon.json.section.id;
  expect((await api("PUT", `${kurssti(tilstand.kursId)}/items`, { items: [{ type: "SECTION", sectionId: tilstand.seksjonId }] })).status).toBe(204);
  const pub = await api("POST", `${kurssti(tilstand.kursId)}/publish`, { publishItems: true });
  noter("A: publisering", { status: pub.status, error: pub.json?.error });
  expect(pub.status, pub.tekst.slice(0, 300)).toBe(200);
  expect(await publisert()).toBe(true);
  const publikum = await api("GET", `${kurssti(tilstand.kursId)}/publish-audience`);
  noter("A: publikum", publikum.json);

  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/courses/${tilstand.kursId}`, { waitUntil: "domcontentloaded" });
  const knapp = page.locator('.form-page-actions [data-action="unpublish"]');
  await knapp.waitFor({ state: "attached", timeout: 45_000 });
  if (!(await knapp.isVisible())) await page.locator(".form-page-actions details.row-more > summary").click();
  await knapp.click();

  const dialog = page.locator("#cascadePublishDialog");
  await expect(dialog).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("#cascadePublishTitle")).toHaveText(`Avpublisere «${tilstand.kursNavn}»?`);
  await expect(page.locator("#cascadePublishText")).toHaveText("Kurset blir skjult for deltakerne til du publiserer det igjen.");
  await expect(dialog.locator("[data-publish-audience] h3")).toHaveText("Hvem mister tilgangen");
  // Begrenset og ikke tildelt noen (tjenerens tall).
  await expect(dialog.locator("[data-publish-audience='none']")).toContainText("Ingen. Kurset er begrenset og ikke tildelt noen.");
  fs.mkdirSync(RAPPORT, { recursive: true });
  await page.screenshot({ path: path.join(RAPPORT, "2180-avpubliser.png") });

  await page.locator("#cascadePublishCancelBtn").click();
  await expect(dialog).toBeHidden();
  expect(await publisert(), "Avbryt skal ikke avpublisere").toBe(true);

  if (!(await knapp.isVisible())) await page.locator(".form-page-actions details.row-more > summary").click();
  await knapp.click();
  await expect(dialog).toBeVisible({ timeout: 45_000 });
  await page.locator("#cascadePublishConfirmBtn").click();
  await expect.poll(publisert, { timeout: 45_000 }).toBe(false);
  expect(nettleserSpørsmål).toEqual([]);
});

test("B: «Slett» på det arkiverte kurset sier at modulene og seksjonene blir stående; Avbryt sletter ingenting", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.kursId, "testdataene ble ikke laget");
  const arkiv = await arkiverKurs(api, tilstand.kursId);
  noter("B: arkivering", arkiv.status);
  expect(arkiv.status).toBe(200);

  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
  await page.locator('.list-filter-btn[data-filter="archived"]').click();
  const rad = page.locator("#coursesTableBody tr", { hasText: tilstand.kursNavn });
  await expect(rad).toBeVisible({ timeout: 45_000 });
  const slett = rad.locator('[data-action="delete"]').first();
  await slett.waitFor({ state: "attached" });
  const meny = slett.locator("xpath=ancestor::details[contains(@class, 'row-more')]");
  if ((await meny.count()) > 0 && !(await meny.first().evaluate((el) => (el as HTMLDetailsElement).open))) await meny.first().locator("summary").click();
  await slett.click();

  await expect(page.locator("#deleteDialog")).toHaveAttribute("open", "", { timeout: 45_000 });
  await expect(page.locator("#deleteDialogText")).toContainText("Modulene og seksjonene blir stående i biblioteket som de er.");
  await page.screenshot({ path: path.join(RAPPORT, "2180-slett-kurs.png") });
  await page.locator("#deleteDialog").evaluate((d) => (d as HTMLDialogElement).close());
  expect((await api("GET", kurssti(tilstand.kursId))).status).toBe(200);
  expect(nettleserSpørsmål).toEqual([]);
});
