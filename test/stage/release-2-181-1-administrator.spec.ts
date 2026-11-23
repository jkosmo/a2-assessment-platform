import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.181.1 mot UTRULLET stage: stage-testkontoen som ADMINISTRATOR (hodet `x-stage-test-role: ADMINISTRATOR`,
// src/auth/stageTestService.ts), og de to sjekkene som holdt #1168 åpen fordi de krevde en administrator:
//
//   A. Kontoen: `/api/me` sier administrator, plattformruta slipper den inn; uten hodet (fagansvarlig) er den stengt.
//   B. Temaet: slettedialogen for et tema som både et aktivt og et arkivert kurs har, sier «2 kurs …, 1 av dem arkivert».
//      Slettingen kobler fra begge, og det arkiverte kurset kommer tilbake uten temaet når det gjenopprettes.
//   C. Klassen: én deltaker, to begrensede kurs fra samme klasse. Deltakeren har lest en seksjon i det ene. Klassen arkiveres
//      gjennom sidas dialog. Kurset deltakeren ikke har begynt på, forsvinner fra Mine kurs; det påbegynte blir stående.
//
// Det testen skriver på stage, alt med «Stage-test 2.181.1» og et tidsstempel i navnet: ett tema, fire kurs, fire seksjoner og
// én klasse. Ryddingen sletter alt, også når noe feilet underveis. ⚠️ Tokenet leses fra den gitignorerte
// `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
type Som = "admin" | "fagansvarlig" | "deltaker";
const ROLLEHODE: Record<Som, Record<string, string>> = {
  admin: { "x-stage-test-role": "ADMINISTRATOR" },
  fagansvarlig: {},
  deltaker: { "x-stage-test-role": "PARTICIPANT" },
};
const hoder = (som: Som): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}`, ...ROLLEHODE[som] });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.181.1", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

type Svar = { status: number; json: any; tekst: string };
async function kall(som: Som, metode: string, sti: string, body?: unknown): Promise<Svar> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(som), "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
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
const admin = (metode: string, sti: string, body?: unknown) => kall("admin", metode, sti, body);

/** En ny bruker må godta personvernerklæringen før noe annet enn /api/me svarer, som ved første innlogging. */
async function meg(som: Som): Promise<{ id: string; roles: string[] }> {
  const svar = await kall(som, "GET", "/api/me");
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  if (svar.json.consent?.accepted === false) {
    const godtatt = await kall(som, "POST", "/api/me/consent", { consentVersion: svar.json.consent.currentVersion });
    noter(`${som}: godtok personvernerklæringen`, godtatt.status);
    expect(godtatt.status).toBeLessThan(300);
  }
  // /api/me har ikke den interne id-en; /api/me/data har den (som i release-2-154-1).
  const data = await kall(som, "GET", "/api/me/data");
  expect(data.status, data.tekst.slice(0, 300)).toBe(200);
  const id = data.json.profile?.id;
  expect(id, "fant ikke den interne id-en i /api/me/data").toBeTruthy();
  return { id, roles: svar.json.user.roles };
}

let configCache: Record<string, unknown> | null = null;
const nettleserSpørsmål: string[] = [];
async function forberedSide(page: Page) {
  // Sidas egne kall får tokenet OG rollehodet, ellers ville sida opptre som fagansvarlig.
  await page.route("**/api/**", async (r: Route) => {
    await vent();
    await r.continue({ headers: { ...r.request().headers(), ...hoder("admin") } });
  });
  configCache ??= (await (await fetch(`${BASE}/participant/config`)).json()) as Record<string, unknown>;
  await page.route("**/participant/config", (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...configCache, authMode: "mock" }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
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
const navn = (hva: string) => `Stage-test 2.181.1 ${hva} ${stempel}`;
const L = (tekst: string) => ({ "en-GB": tekst, nb: tekst, nn: tekst });
const kurssti = (id: string) => `/api/admin/content/courses/${id}`;
const seksjonssti = (id: string) => `/api/admin/content/sections/${id}`;
const klassesti = (id: string) => `/api/admin/content/classes/${id}`;
const opprettet = { tema: "", kurs: [] as string[], seksjoner: [] as string[], klasse: "" };

async function nyttKurs(hva: string, ekstra: Record<string, unknown> = {}): Promise<string> {
  const kurs = await admin("POST", "/api/admin/content/courses", { enrollmentPolicy: "RESTRICTED", title: L(navn(hva)), certificationLevel: "basic", ...ekstra });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  opprettet.kurs.push(kurs.json.course.id);
  return kurs.json.course.id;
}

/**
 * Et publisert begrenset kurs med TO publiserte seksjoner. To, fordi en lest seksjon i et kurs med bare én fullfører kurset og gir
 * kursbevis, og et kurs med kursbevis kan ikke slettes (`course_has_completions`, med vilje): testen skal begynne, ikke fullføre,
 * og ryddingen skal kunne slette. Første kjøring 2026-11-23 etterlot to slike kurs på stage.
 */
async function publisertKurs(hva: string): Promise<{ kursId: string; seksjonId: string }> {
  const seksjonIder: string[] = [];
  for (const del of ["1", "2"]) {
    const seksjon = await admin("POST", "/api/admin/content/sections", { title: L(navn(`seksjon ${hva} ${del}`)), bodyMarkdown: L("Innhold.") });
    expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
    seksjonIder.push(seksjon.json.section.id);
    opprettet.seksjoner.push(seksjon.json.section.id);
    expect((await admin("POST", `${seksjonssti(seksjon.json.section.id)}/publish`)).status).toBe(200);
  }
  const seksjonId = seksjonIder[0];
  const kursId = await nyttKurs(hva);
  const elementer = seksjonIder.map((sectionId) => ({ type: "SECTION", sectionId }));
  expect((await admin("PUT", `${kurssti(kursId)}/items`, { items: elementer })).status).toBe(204);
  const pub = await admin("POST", `${kurssti(kursId)}/publish`, { publishItems: true });
  expect(pub.status, pub.tekst.slice(0, 300)).toBe(200);
  return { kursId, seksjonId };
}

const mineKurs = async (): Promise<string[]> => {
  const svar = await kall("deltaker", "GET", "/api/courses");
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  return (svar.json.courses ?? []).map((k: { id: string }) => k.id);
};

test.afterAll(async () => {
  const mislyktes: string[] = [];
  if (opprettet.klasse) {
    await admin("POST", `${klassesti(opprettet.klasse)}/archive`);
    const s = await admin("DELETE", klassesti(opprettet.klasse));
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`klasse ${s.status}`);
  }
  if (opprettet.tema) {
    const s = await admin("DELETE", `/api/admin/content/themes/${opprettet.tema}`);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`tema ${s.status}`);
  }
  for (const id of opprettet.kurs) {
    await admin("POST", `${kurssti(id)}/unpublish`);
    await arkiverKurs(admin, id);
    const s = await admin("DELETE", kurssti(id));
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`kurs ${id.slice(-6)} ${s.status}`);
  }
  for (const id of opprettet.seksjoner) {
    await admin("POST", `${seksjonssti(id)}/archive`);
    const s = await admin("DELETE", seksjonssti(id));
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`seksjon ${id.slice(-6)} ${s.status}`);
  }
  noter("rydding", mislyktes.length === 0 ? "ok" : mislyktes);
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.181.1", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.181.1"));
});

test("A: med hodet er kontoen administrator, og når det fagansvarlig ikke når", async () => {
  const jeg = await meg("admin");
  noter("A: roller", jeg.roles);
  expect(jeg.roles).toEqual(["ADMINISTRATOR"]);
  expect((await admin("GET", "/api/admin/platform/archived-content-purge")).status).toBe(200);
  // Kontroll: samme token uten hodet er fagansvarlig og stenges ute.
  expect((await kall("fagansvarlig", "GET", "/api/admin/platform/archived-content-purge")).status).toBe(403);
});

test("B (#1168): temaets slettedialog teller det arkiverte kurset, og slettingen kobler fra begge", async ({ page }) => {
  test.setTimeout(300_000);
  const temaNavn = navn("tema");
  const tema = await admin("POST", "/api/admin/content/themes", { name: L(temaNavn) });
  expect(tema.status, tema.tekst.slice(0, 300)).toBe(201);
  opprettet.tema = tema.json.theme.id;
  await nyttKurs("tema aktivt", { themeIds: [opprettet.tema] });
  const arkivert = await nyttKurs("tema arkivert", { themeIds: [opprettet.tema] });
  const ark = await arkiverKurs(admin, arkivert);
  expect(ark.status, ark.tekst.slice(0, 300)).toBe(200);

  const forhånd = await admin("GET", `/api/admin/content/themes/${opprettet.tema}/delete-preview`);
  noter("B: forhåndsvisning", forhånd.json);
  expect(forhånd.json).toMatchObject({ courseCount: 2, archivedCourseCount: 1 });

  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/themes`, { waitUntil: "domcontentloaded" });
  const rad = page.locator("#themesTableBody tr", { hasText: temaNavn });
  await expect(rad).toBeVisible({ timeout: 45_000 });
  await trykk(rad, "delete");
  await expect(page.locator("#themeDeleteText")).toHaveText(
    "2 kurs har dette temaet, 1 av dem arkivert. De mister bare temaet; kursene endres ikke ellers. Gjenopprettes et arkivert kurs, kommer det tilbake uten temaet.",
    { timeout: 45_000 },
  );
  fs.mkdirSync(RAPPORT, { recursive: true });
  await page.screenshot({ path: path.join(RAPPORT, "21811-tema-slett.png") });

  const slettSvar = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().endsWith(`/themes/${opprettet.tema}`), { timeout: 45_000 });
  await page.locator("#themeDeleteConfirmBtn").click();
  const svar = await slettSvar;
  const kropp = await svar.json();
  noter("B: sletting", { status: svar.status(), kropp });
  expect(svar.status()).toBe(200);
  expect(kropp.detachedCourseCount).toBe(2);
  opprettet.tema = "";

  // Det arkiverte kurset kommer tilbake uten temaet, slik dialogen sa.
  expect((await admin("POST", `${kurssti(arkivert)}/restore`)).status).toBeLessThan(300);
  const detalj = await admin("GET", kurssti(arkivert));
  expect(detalj.json.course.archivedAt ?? null).toBeNull();
  expect(detalj.json.course.themeIds).toEqual([]);
  expect(nettleserSpørsmål).toEqual([]);
});

test("C (#1168): klassen arkiveres; kurset deltakeren ikke har begynt på forsvinner, det påbegynte blir stående", async ({ page }) => {
  test.setTimeout(400_000);
  const deltaker = await meg("deltaker");
  const ikkeBegynt = await publisertKurs("ikke begynt");
  const begynt = await publisertKurs("begynt");

  const klasseNavn = navn("klasse");
  const klasse = await admin("POST", "/api/admin/content/classes", { name: klasseNavn });
  expect(klasse.status, klasse.tekst.slice(0, 300)).toBe(201);
  opprettet.klasse = klasse.json.class.id;
  const medlem = await admin("POST", `${klassesti(opprettet.klasse)}/members`, { userId: deltaker.id });
  expect(medlem.status, medlem.tekst.slice(0, 300)).toBe(201);
  for (const { kursId } of [ikkeBegynt, begynt]) {
    const tildelt = await admin("POST", `${klassesti(opprettet.klasse)}/courses`, { courseId: kursId });
    expect(tildelt.status, tildelt.tekst.slice(0, 300)).toBe(201);
  }
  const før = await mineKurs();
  expect(før, "begge kursene skal stå i Mine kurs før arkiveringen").toEqual(expect.arrayContaining([ikkeBegynt.kursId, begynt.kursId]));

  // Deltakeren leser den første av to seksjoner i det ene kurset: det kurset er påbegynt, ikke fullført.
  const vist = await kall("deltaker", "GET", `/api/courses/${begynt.kursId}/sections/${begynt.seksjonId}`);
  expect(vist.status, vist.tekst.slice(0, 300)).toBe(200);
  const lest = await kall("deltaker", "POST", `/api/courses/${begynt.kursId}/sections/${begynt.seksjonId}/read`, { sectionVersionId: vist.json.sectionVersionId });
  expect(lest.status, lest.tekst.slice(0, 300)).toBeLessThan(300);

  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/deltakere/klasser`, { waitUntil: "domcontentloaded" });
  const rad = page.locator("#classesTableBody tr", { hasText: klasseNavn });
  await expect(rad).toBeVisible({ timeout: 45_000 });
  await trykk(rad, "archive");
  await expect(page.locator("#moduleLifecycleDialog")).toHaveAttribute("data-module-dialog", "archive", { timeout: 45_000 });
  await expect(page.locator("#moduleLifecycleDialogText")).toContainText("påbegynte og fullførte blir stående");
  await page.screenshot({ path: path.join(RAPPORT, "21811-klasse-arkiver.png") });
  const arkivSvar = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/classes/${opprettet.klasse}/archive`), { timeout: 45_000 });
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  expect((await arkivSvar).status()).toBeLessThan(300);

  const etter = await mineKurs();
  noter("C: Mine kurs etter arkivering", { ikkeBegynt: etter.includes(ikkeBegynt.kursId), begynt: etter.includes(begynt.kursId) });
  expect(etter, "kurset deltakeren ikke har begynt på, skal forsvinne").not.toContain(ikkeBegynt.kursId);
  expect(etter, "det påbegynte kurset skal bli stående").toContain(begynt.kursId);
  expect(nettleserSpørsmål).toEqual([]);
});
