import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.159.0 mot UTRULLET stage, gjennom de ekte dialogene i forfattersida (#1150), med ekte data:
//
//   1. «Arkiver» på et kurs der én modul også ligger i et annet kurs: dialogen viser hva som følger med, hva som blir stående
//      og hvorfor, og én deltaker midt i. Etter bekreftelsen er det eksklusive innholdet arkivert, og den delte modulen står.
//   2. Det arkiverte kurset åpnes: linja om at det er arkivert, skjemaet sperret, ingen Lagre. Deltakeren ser det ikke lenger.
//   3. «Gjenopprett»: dialogen viser hva som kommer tilbake; modulen får tilbake SAMME versjon. Kurset er et utkast, og
//      publiseres det igjen, blir det ingen ny hovedversjon.
//   4. Nettleserens tilbake-knapp fra et ulagret seksjonsskjema: Avbryt beholder skjemaet, og etter lagring fører tilbake til
//      seksjonslista (2.158.1). ⚠️ Playwrights `goBack` er ikke knappen i verktøylinja; se rapporten.
//
// Det testen skriver på stage: to kurs, to moduler, én seksjon («Stage-test 2.159.0 …»), og én lesing som stage-testkontoen gjør
// som deltaker (`x-stage-test-role: PARTICIPANT`). Alt arkiveres etterpå, og testen feiler hvis ryddingen feiler.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.159.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};
const bildesti = (navn: string) => path.join(RAPPORT, `2159-${navn}.png`);

type Som = "fagansvarlig" | "deltaker";
async function api(som: Som, metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: {
      ...hoder(),
      "x-locale": "nb",
      ...(som === "deltaker" ? { "x-stage-test-role": "PARTICIPANT" } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
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
const fag = (metode: string, sti: string, body?: unknown) => api("fagansvarlig", metode, sti, body);

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
    const sett: string[] = [];
    (window as unknown as { __meldinger: string[] }).__meldinger = sett;
    new MutationObserver((endringer) => {
      for (const endring of endringer) {
        for (const node of endring.addedNodes) {
          if (!(node instanceof Element)) continue;
          const funnet = node.matches(".toast__message") ? [node] : [...node.querySelectorAll(".toast__message")];
          for (const el of funnet) sett.push(el.textContent ?? "");
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
}
const meldinger = (page: Page) => page.evaluate(() => (window as unknown as { __meldinger?: string[] }).__meldinger ?? []);

/** En handling i hodet til det åpnede kurset, også når den står under «Mer». */
async function klikkHandling(page: Page, handling: "archive" | "restore") {
  const knapp = page.locator(`.form-page-actions [data-action="${handling}"]`);
  await expect(knapp).toHaveCount(1, { timeout: 45_000 });
  if (!(await knapp.isVisible())) await page.locator(".form-page-actions details.row-more > summary").click();
  await knapp.click();
}

const L = (en: string, nb: string = en) => ({ "en-GB": en, nb, nn: nb });
const stempel = Date.now();
const KURS = `Stage-test 2.159.0 kurs ${stempel}`;
const ANNET_KURS = `Stage-test 2.159.0 annet kurs ${stempel}`;
const MODUL = `Stage-test 2.159.0 egen modul ${stempel}`;
const DELT = `Stage-test 2.159.0 delt modul ${stempel}`;
const SEKSJON = `Stage-test 2.159.0 seksjon ${stempel}`;
const sporsmaal = { stem: L("Who receives an appeal?", "Hvem skal klagen sendes til?"), options: [L("The deciding body", "Vedtaksorganet"), L("The ombudsman", "Ombudet"), L("The county governor", "Statsforvalteren"), L("The court", "Domstolen")], correctAnswer: L("The deciding body", "Vedtaksorganet"), rationale: L("The body that made the decision.", "Organet som fattet vedtaket.") };

const tilstand: { kurs?: string; annet?: string; modul?: string; delt?: string; seksjon?: string; modulVersjon?: string; versionMajor?: number } = {};
const kurssti = (id = tilstand.kurs) => `/api/admin/content/courses/${id}`;

async function lagModul(navn: string): Promise<{ id: string; versjon: string }> {
  const modul = await fag("POST", "/api/admin/content/modules", { title: L(navn), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  const id = modul.json.module.id as string;
  const sett = await fag("POST", `/api/admin/content/modules/${id}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [sporsmaal] });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  const versjon = await fag("POST", `/api/admin/content/modules/${id}/module-versions`, { assessmentMode: "MCQ_ONLY", mcqSetVersionId: sett.json.mcqSetVersion.id, assessmentPolicy: { passRules: { mcqMinPercent: 50 } } });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  const publisert = await fag("POST", `/api/admin/content/modules/${id}/module-versions/${versjon.json.moduleVersion.id}/publish`, {});
  expect([200, 201], publisert.tekst.slice(0, 600)).toContain(publisert.status);
  return { id, versjon: versjon.json.moduleVersion.id };
}
const modulRad = async (id: string) => (await fag("GET", `/api/admin/content/modules/${id}/export`)).json.moduleExport?.module ?? null;
const seksjonRad = async (id: string) => (await fag("GET", `/api/admin/content/sections/${id}`)).json.section ?? null;
const kursRad = async (id = tilstand.kurs!) => (await fag("GET", kurssti(id))).json.course ?? null;

test.afterAll(async () => {
  const mislyktes: string[] = [];
  for (const [navn, id] of [["kurset", tilstand.kurs], ["det andre kurset", tilstand.annet]] as const) {
    if (!id) continue;
    const rad = await kursRad(id);
    if (rad && !rad.archivedAt) {
      if (rad.publishedAt) await fag("POST", `${kurssti(id)}/unpublish`);
      const svar = await arkiverKurs(fag, id);
      noter(`rydding: arkiver ${navn}`, { status: svar.status, fulgte: [...svar.fulgte].length });
      if (svar.status >= 400) mislyktes.push(`arkiver ${navn}: ${svar.status} ${svar.tekst.slice(0, 200)}`);
    }
  }
  for (const [navn, id, les] of [["egen modul", tilstand.modul, modulRad], ["delt modul", tilstand.delt, modulRad], ["seksjon", tilstand.seksjon, seksjonRad]] as const) {
    if (!id) continue;
    let rad = await les(id);
    if (rad && !rad.archivedAt) {
      await fag("POST", `/api/admin/content/${navn === "seksjon" ? "sections" : "modules"}/${id}/archive`, {});
      rad = await les(id);
    }
    noter(`rydding: ${navn}`, { arkivert: Boolean(rad?.archivedAt) });
    if (!rad?.archivedAt) mislyktes.push(`${navn} er ikke arkivert`);
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.159.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.159.0"));
});

test("testdata: et publisert kurs med egen modul, egen seksjon og en modul som også ligger i et annet kurs, og én deltaker midt i", async () => {
  test.setTimeout(300_000);
  const egen = await lagModul(MODUL);
  tilstand.modul = egen.id;
  tilstand.modulVersjon = egen.versjon;
  tilstand.delt = (await lagModul(DELT)).id;
  const seksjon = await fag("POST", "/api/admin/content/sections", { title: L(SEKSJON), bodyMarkdown: L("Text.", "Tekst.") });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  tilstand.seksjon = seksjon.json.section.id;

  // Åpent kurs, så stage-testkontoen som deltaker ser det uten klasse.
  const kurs = await fag("POST", "/api/admin/content/courses", { title: L(KURS), certificationLevel: "basic", enrollmentPolicy: "OPEN" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kurs = kurs.json.course.id;
  const elementer = await fag("PUT", `${kurssti()}/items`, { items: [{ type: "SECTION", sectionId: tilstand.seksjon }, { type: "MODULE", moduleId: tilstand.modul }, { type: "MODULE", moduleId: tilstand.delt }] });
  expect(elementer.status, elementer.tekst.slice(0, 300)).toBe(204);
  const publiser = await fag("POST", `${kurssti()}/publish`);
  expect(publiser.status, publiser.tekst.slice(0, 600)).toBe(200);

  const annet = await fag("POST", "/api/admin/content/courses", { title: L(ANNET_KURS), certificationLevel: "basic" });
  expect(annet.status, annet.tekst.slice(0, 300)).toBe(201);
  tilstand.annet = annet.json.course.id;
  expect((await fag("PUT", `${kurssti(tilstand.annet)}/items`, { items: [{ type: "MODULE", moduleId: tilstand.delt }] })).status).toBe(204);

  // Deltakeren leser seksjonen: midt i kurset (ett av tre steg).
  // Som klienten: lesingen sier hvilken versjon av seksjonen deltakeren så (#934 skive 5a-1; uten den 409 client_outdated).
  const sectionVersionId = (await seksjonRad(tilstand.seksjon!))?.activeVersionId;
  const lest = await api("deltaker", "POST", `/api/courses/${tilstand.kurs}/sections/${tilstand.seksjon}/read`, { sectionVersionId });
  noter("deltakeren leser seksjonen", lest.status);
  expect([200, 201, 204], lest.tekst.slice(0, 300)).toContain(lest.status);
  tilstand.versionMajor = (await kursRad())?.versionMajor;
  const forhånd = await fag("GET", `${kurssti()}/archive-preview`);
  noter("forhåndsvisningen før dialogen", { inProgressCount: forhånd.json.inProgressCount, følger: forhånd.json.follows?.map((f: { title: string }) => f.title), blir: forhånd.json.stays?.map((s: { title: string }) => s.title) });
});

test("1: «Arkiver» i det åpnede kurset viser følger med / blir stående / deltaker midt i, og arkiverer det eksklusive", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!tilstand.kurs, "testdataene ble ikke laget");
  await forberedSide(page);
  await page.goto(`${BASE}/admin-content/courses/${tilstand.kurs}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#formPageTitle")).toHaveText(KURS, { timeout: 45_000 });
  await klikkHandling(page, "archive");

  const dialog = page.locator("#courseArchiveDialog");
  await expect(dialog).toBeVisible();
  const kropp = page.locator("#courseArchiveBody");
  await expect(kropp).toContainText(MODUL, { timeout: 30_000 });
  const tekst = await kropp.innerText();
  noter("1, dialogen", tekst);
  fs.mkdirSync(RAPPORT, { recursive: true });
  await dialog.screenshot({ path: bildesti("arkiver-dialog") });
  // Følger med: egen modul og seksjon. Blir stående: den delte modulen, med det andre kurset.
  const følgerDel = tekst.split(/Blir stående/)[0] ?? "";
  const blirDel = tekst.split(/Blir stående/)[1] ?? "";
  expect(følgerDel).toContain(MODUL);
  expect(følgerDel).toContain(SEKSJON);
  expect(følgerDel).not.toContain(DELT);
  expect(blirDel).toContain(DELT);
  expect(blirDel).toContain(ANNET_KURS);
  expect(tekst).toMatch(/Deltakere midt i kurset \(1\)/);

  await page.locator("#courseArchiveConfirmBtn").click();
  await expect(dialog).toBeHidden({ timeout: 45_000 });
  await expect.poll(() => meldinger(page), { timeout: 30_000 }).not.toEqual([]);
  noter("1, meldingen", await meldinger(page));

  const [kurs, egen, delt, seksjon] = await Promise.all([kursRad(), modulRad(tilstand.modul!), modulRad(tilstand.delt!), seksjonRad(tilstand.seksjon!)]);
  noter("1, etter arkivering", { kurs: Boolean(kurs?.archivedAt), egenModul: Boolean(egen?.archivedAt), seksjon: Boolean(seksjon?.archivedAt), deltModul: Boolean(delt?.archivedAt) });
  expect(Boolean(kurs?.archivedAt)).toBe(true);
  expect(Boolean(egen?.archivedAt)).toBe(true);
  expect(Boolean(seksjon?.archivedAt)).toBe(true);
  expect(Boolean(delt?.archivedAt), "den delte modulen ble arkivert").toBe(false);
});

test("2: det arkiverte kurset er sperret i kursbyggeren, og deltakeren ser det ikke", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.kurs, "testdataene ble ikke laget");
  await forberedSide(page);
  await page.goto(`${BASE}/admin-content/courses/${tilstand.kurs}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-course-archived-notice]")).toBeVisible({ timeout: 45_000 });
  // Én sperre per fane (Rediger og Innstillinger); alle skal være sperret.
  const sperrer = page.locator("fieldset[data-course-archived-lock]");
  expect(await sperrer.count()).toBeGreaterThan(0);
  // Playwright regner bare skjemafelt som «disabled», ikke selve <fieldset>: sjekk attributtet her, og feltene under.
  for (const sperre of await sperrer.all()) await expect(sperre).toHaveAttribute("disabled", "");
  for (const felt of await page.locator("fieldset[data-course-archived-lock] :is(input, textarea, select)").all()) await expect(felt).toBeDisabled();
  await expect(page.locator("#formSaveBtn")).toBeHidden();
  const navn = page.locator("fieldset[data-course-archived-lock] input").first();
  await expect(navn).toBeDisabled();
  await page.screenshot({ path: bildesti("arkivert-kurs"), fullPage: false });

  const mineKurs = await api("deltaker", "GET", "/api/courses");
  const synlig = JSON.stringify(mineKurs.json).includes(tilstand.kurs!);
  noter("2", { varsellinje: true, skjemaSperret: true, lagreSkjult: true, deltakerSerKurset: synlig, mineKursStatus: mineKurs.status });
  expect(mineKurs.status).toBe(200);
  expect(synlig, "deltakeren ser fortsatt det arkiverte kurset").toBe(false);
});

test("3: «Gjenopprett» setter innholdet tilbake med samme versjon; kurset er utkast og publiseres uten ny hovedversjon", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!tilstand.kurs, "testdataene ble ikke laget");
  await forberedSide(page);
  await page.goto(`${BASE}/admin-content/courses/${tilstand.kurs}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-course-archived-notice]")).toBeVisible({ timeout: 45_000 });
  await klikkHandling(page, "restore");
  const dialog = page.locator("#courseRestoreDialog");
  await expect(dialog).toBeVisible();
  const kropp = page.locator("#courseRestoreBody");
  await expect(kropp).toContainText(MODUL, { timeout: 30_000 });
  noter("3, dialogen", await kropp.innerText());
  await dialog.screenshot({ path: bildesti("gjenopprett-dialog") });
  await page.locator("#courseRestoreConfirmBtn").click();
  await expect(dialog).toBeHidden({ timeout: 45_000 });
  await expect.poll(() => meldinger(page), { timeout: 30_000 }).not.toEqual([]);
  noter("3, meldingen", await meldinger(page));
  // Skjemaet åpnes igjen uten sidelasting.
  await expect(page.locator("fieldset[data-course-archived-lock]")).toHaveCount(0, { timeout: 30_000 });

  const [kurs, egen, seksjon] = await Promise.all([kursRad(), modulRad(tilstand.modul!), seksjonRad(tilstand.seksjon!)]);
  noter("3, etter gjenoppretting", { kursLifecycle: kurs?.lifecycle, egenModulSammeVersjon: egen?.activeVersionId === tilstand.modulVersjon, egenModulArkivert: Boolean(egen?.archivedAt), seksjonAktiv: Boolean(seksjon?.activeVersionId), seksjonArkivert: Boolean(seksjon?.archivedAt) });
  expect(kurs?.lifecycle).toBe("draft");
  expect(egen?.archivedAt ?? null).toBeNull();
  expect(egen?.activeVersionId).toBe(tilstand.modulVersjon);
  expect(seksjon?.archivedAt ?? null).toBeNull();
  expect(seksjon?.activeVersionId).toBeTruthy();

  const publiser = await fag("POST", `${kurssti()}/publish`);
  const etter = await kursRad();
  noter("3, publisering etter gjenoppretting", { status: publiser.status, versionMajorFør: tilstand.versionMajor, versionMajorEtter: etter?.versionMajor, feil: publiser.json.error ?? null });
  expect(publiser.status, publiser.tekst.slice(0, 600)).toBe(200);
  expect(etter?.versionMajor).toBe(tilstand.versionMajor);
  // Deltakeren har fortsatt lesingen sin.
  const deltaker = await api("deltaker", "GET", `/api/courses/${tilstand.kurs}`);
  noter("3, deltakeren etter publisering", deltaker.status);
  expect(deltaker.status).toBe(200);
});

test("4: tilbake-knappen fra et ulagret seksjonsskjema spør; Avbryt beholder; etter lagring fører tilbake til seksjonslista", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.seksjon, "testdataene ble ikke laget");
  await forberedSide(page);

  const dialoger: string[] = [];
  // Forfatteren svarer Avbryt på spørsmålet om å forlate sida.
  page.on("dialog", (d) => { dialoger.push(d.type()); void d.dismiss(); });

  // Kurs → Seksjoner → seksjonen, slik QA-porten beskrev.
  await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
  await page.locator("#navSeksjoner").click();
  const sok = page.locator("#sectionsSearch");
  await expect(sok).toBeVisible({ timeout: 45_000 });
  await sok.fill("2.159.0 seksjon");
  await page.locator(`[data-action="edit"][data-id="${tilstand.seksjon}"]`).click();
  await expect(page.locator("#titleInput")).toHaveValue(SEKSJON, { timeout: 45_000 });
  await page.locator("#markdownInput").fill("Tekst. Endret av stage-testen.");

  await page.goBack();
  await expect.poll(() => dialoger, { timeout: 15_000 }).toEqual(["confirm"]);
  await expect(page.locator("#markdownInput")).toHaveValue("Tekst. Endret av stage-testen.");
  expect(new URL(page.url()).searchParams.get("id")).toBe(tilstand.seksjon);

  await page.locator("#formSaveBtn").click();
  await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret", { timeout: 45_000 });
  await page.goBack();
  await expect(page.locator("#sectionsTableBody")).toBeVisible({ timeout: 45_000 });
  noter("4", { dialoger, adresse: new URL(page.url()).pathname + new URL(page.url()).search });
  expect(new URL(page.url()).pathname).toBe("/admin-content/sections");
  expect(dialoger).toEqual(["confirm"]);
});
