import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";

// 2.157.2 mot UTRULLET stage, med ekte data:
//
//   A. En publisert modul med en nyere, upublisert lagring kommer opp i kursbyggerens søk.
//   B. Å skrive i søket merker ikke kurset som «Ulagrede endringer».
//   C. En modul som publiseres mens kurset står åpent, kommer opp når forfatteren kommer tilbake til fanen.
//   D. Seksjonslista spør ikke om ulagrede endringer etter at en seksjon har vært åpnet.
//
// Det testen skriver på stage: to moduler og én seksjon («Stage-test 2.157.2 …»). De arkiveres etterpå, og testen feiler hvis
// ryddingen feiler. Kurset lagres aldri: søket prøves i «nytt kurs»-skjemaet.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.157.2", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};
const bildesti = (navn: string) => path.join(RAPPORT, `21572-${navn}.png`);

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
}

/** Samler alle spørsmål nettleseren stiller, og avviser dem: et spørsmål som ikke skulle kommet, stopper navigeringen. */
function samleDialoger(page: Page) {
  const meldinger: string[] = [];
  page.on("dialog", (d) => { meldinger.push(`${d.type()}: ${d.message()}`); void d.dismiss(); });
  return meldinger;
}

/** Spør sida før man lukker fanen? Målt uten å forlate sida. */
const sporVedLukking = (page: Page) =>
  page.evaluate(() => {
    const hendelse = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(hendelse);
    return hendelse.defaultPrevented;
  });

const L = (en: string, nb: string) => ({ "en-GB": en, nb, nn: nb });
const stempel = Date.now();
const MED_UTKAST = `Stage-test 2.157.2 live med utkast ${stempel}`;
const SENERE = `Stage-test 2.157.2 publiseres senere ${stempel}`;
const SEKSJON = `Stage-test 2.157.2 seksjon ${stempel}`;
const SOK = `2.157.2`;

const sporsmaal = { stem: L("Who receives an appeal?", "Hvem skal klagen sendes til?"), options: [L("The deciding body", "Vedtaksorganet"), L("The ombudsman", "Ombudet"), L("The county governor", "Statsforvalteren"), L("The court", "Domstolen")], correctAnswer: L("The deciding body", "Vedtaksorganet"), rationale: L("The body that made the decision.", "Organet som fattet vedtaket.") };

const tilstand: { medUtkast?: string; senere?: string; senereVersjon?: string; seksjon?: string } = {};

/** En flervalgsmodul med én versjon. Gir modul-id og versjons-id; publiserer ikke. */
async function lagModul(navn: string): Promise<{ id: string; versjon: string; sett: string }> {
  const modul = await api("POST", "/api/admin/content/modules", { title: L(navn, navn), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  const id = modul.json.module.id as string;
  const sett = await api("POST", `/api/admin/content/modules/${id}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [sporsmaal] });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  const versjon = await nyVersjon(id, sett.json.mcqSetVersion.id);
  return { id, versjon, sett: sett.json.mcqSetVersion.id };
}

async function nyVersjon(modulId: string, settId: string): Promise<string> {
  const versjon = await api("POST", `/api/admin/content/modules/${modulId}/module-versions`, {
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: settId,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 } },
  });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  return versjon.json.moduleVersion.id as string;
}

async function publiser(modulId: string, versjonId: string) {
  const svar = await api("POST", `/api/admin/content/modules/${modulId}/module-versions/${versjonId}/publish`, {});
  expect([200, 201], svar.tekst.slice(0, 600)).toContain(svar.status);
}

/** Modulen slik biblioteket (og dermed søket) ser den. */
async function iBiblioteket(modulId: string): Promise<{ status?: string; lifecycle?: string } | null> {
  const svar = await api("GET", "/api/admin/content/modules/library?locale=nb");
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  const rad = (svar.json.modules ?? []).find((m: { id: string }) => m.id === modulId);
  return rad ? { status: rad.status, lifecycle: rad.lifecycle } : null;
}

test.afterAll(async () => {
  const mislyktes: string[] = [];
  for (const [navn, id] of [["live med utkast", tilstand.medUtkast], ["publiseres senere", tilstand.senere]] as const) {
    if (!id) continue;
    let arkivert = await api("POST", `/api/admin/content/modules/${id}/archive`, {});
    if (arkivert.status >= 400) {
      await api("POST", `/api/admin/content/modules/${id}/unpublish`, {});
      arkivert = await api("POST", `/api/admin/content/modules/${id}/archive`, {});
    }
    noter(`arkiver testmodul (${navn})`, arkivert.status);
    if (arkivert.status >= 400) mislyktes.push(`arkiver modul ${navn}: ${arkivert.status} ${arkivert.tekst.slice(0, 200)}`);
  }
  if (tilstand.seksjon) {
    const arkivert = await api("POST", `/api/admin/content/sections/${tilstand.seksjon}/archive`, {});
    noter("arkiver testseksjon", arkivert.status);
    if (arkivert.status >= 400) mislyktes.push(`arkiver seksjon: ${arkivert.status} ${arkivert.tekst.slice(0, 200)}`);
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.157.2", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.157.2"));
});

test("testdata: en modul som er live med en nyere lagring, en modul som ikke er publisert, og en seksjon", async () => {
  test.setTimeout(240_000);
  const a = await lagModul(MED_UTKAST);
  tilstand.medUtkast = a.id;
  await publiser(a.id, a.versjon);
  // En lagring til, som ikke publiseres: slik står modulen etter at forfatteren har lagret en endring.
  await nyVersjon(a.id, a.sett);
  const radA = await iBiblioteket(a.id);
  noter("modul A i biblioteket", radA);
  expect(radA?.status).toBe("published_with_draft");
  expect(radA?.lifecycle).toBe("published_with_draft");

  const b = await lagModul(SENERE);
  tilstand.senere = b.id;
  tilstand.senereVersjon = b.versjon;
  const radB = await iBiblioteket(b.id);
  noter("modul B i biblioteket", radB);
  expect(radB?.status).toBe("unpublished_draft");

  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(SEKSJON, SEKSJON), bodyMarkdown: L("Text.", "Tekst.") });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  tilstand.seksjon = seksjon.json.section.id;
  noter("testseksjon", tilstand.seksjon);
});

test("A, B og C: søket i kursbyggeren", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.medUtkast || !tilstand.senere, "testdataene ble ikke laget");
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/courses/new`, { waitUntil: "domcontentloaded" });
  const input = page.locator("#comboboxInput");
  await expect(input).toBeVisible({ timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);

  await input.click();
  await input.pressSequentially(SOK);
  const valgA = page.locator(`#comboboxDropdown .combobox-option[data-item-id="${tilstand.medUtkast}"]`);
  const valgB = page.locator(`#comboboxDropdown .combobox-option[data-item-id="${tilstand.senere}"]`);

  // A: live med nyere lagring tilbys. Kontroll: den som aldri er publisert, tilbys ikke.
  await expect(valgA, "A: modulen som er live med en nyere lagring, mangler i søket").toHaveCount(1, { timeout: 30_000 });
  await expect(valgB).toHaveCount(0);
  // B: å søke er ikke en endring.
  await expect(page.locator("#formPageDirty"), "B: søket merket kurset som ulagret").toHaveText("Alt lagret");
  expect(await sporVedLukking(page)).toBe(false);
  fs.mkdirSync(RAPPORT, { recursive: true });
  await page.screenshot({ path: bildesti("sok-live-med-utkast") });
  noter("A og B", { liveMedUtkastTilbys: true, aldriPublisertTilbys: false, hode: await page.locator("#formPageDirty").innerText() });

  // C: modul B publiseres «i en annen fane». Uten at sida lastes på nytt kommer den opp når forfatteren er tilbake.
  await publiser(tilstand.senere!, tilstand.senereVersjon!);
  expect((await iBiblioteket(tilstand.senere!))?.status).toBe("published");
  await expect(valgB, "kontroll: før forfatteren har vært borte og kommet tilbake, er lista den gamle").toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(valgB, "C: modulen som ble publisert mens kurset sto åpent, kom ikke opp").toHaveCount(1, { timeout: 30_000 });
  await expect(input).toHaveValue(SOK);
  await page.screenshot({ path: bildesti("sok-etter-publisering") });
  noter("C", { kommerOppEtterTilbake: true });
});

test("D: seksjonslista spør ikke om ulagrede endringer etter at en seksjon har vært åpnet", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.seksjon, "testseksjonen ble ikke laget");
  await forberedSide(page);
  const dialoger = samleDialoger(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/sections`, { waitUntil: "domcontentloaded" });
  const sok = page.locator("#sectionsSearch");
  await expect(sok).toBeVisible({ timeout: 45_000 });
  await sok.fill(SEKSJON);
  const aapne = page.locator(`[data-action="edit"][data-id="${tilstand.seksjon}"]`);
  await expect(aapne).toBeVisible({ timeout: 30_000 });

  // Inn i seksjonen og tilbake, slik produkteier gjorde.
  await aapne.click();
  await expect(page.locator("#titleInput")).toHaveValue(SEKSJON, { timeout: 45_000 });
  await page.locator("#formBackLink").click();
  await expect(sok).toBeVisible({ timeout: 45_000 });

  // Søk, kursfilter og avkrysning i lista.
  await sok.fill("stage-test");
  await page.locator("#sectionCourseFilter").selectOption({ index: 1 }).catch(() => undefined);
  await page.locator("#sectionsGapsOnly").check();
  await page.locator("#sectionsGapsOnly").uncheck();
  await page.locator("#sectionCourseFilter").selectOption({ index: 0 }).catch(() => undefined);
  expect(await sporVedLukking(page), "D: lista står som ulagret").toBe(false);

  await page.locator("#navKurs").click();
  await expect(page, "D: et spørsmål stoppet navigeringen til Kurs").toHaveURL(/\/admin-content\/courses/, { timeout: 30_000 });
  noter("D", { dialoger, adresse: new URL(page.url()).pathname });
  expect(dialoger).toEqual([]);
});
