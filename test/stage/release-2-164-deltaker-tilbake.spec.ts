import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.164.0 mot UTRULLET stage, i en ekte nettleser med ekte data (#1158, #1160, #1161):
//
//   A. #1158: åpnes en seksjon i kurset, står den i adressen; nettleserens tilbake lukker den og står i kurset (ikke utenfor
//      plattformen); fram åpner den igjen; oppdatering holder den åpen.
//   B. #1160 og #1161: en flervalgsmodul åpnes; en avkrysning overlever oppdatering; ingen tekniske meldinger («Opprett
//      innlevering», «Request completed.») og ingen «Forsøks-ID».
//
// #1159 (profilen for rene deltakere) kan ikke prøves med stage-kontoen, som er innholdsprodusent: dekket av
// test/e2e/profile-way-back-1159.spec.ts. Det testen skriver: ett kurs, én seksjon, én modul («Stage-test 2.164.0 …») og ett
// påbegynt forsøk for stage-kontoen. Kurset og seksjonen slettes; modulen blir stående arkivert (den har en innlevering).
// ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.164.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
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

const L = (en: string, nb: string = en) => ({ "en-GB": en, nb, nn: nb });
const stempel = Date.now();
const navn = (hva: string) => `Stage-test 2.164.0 ${hva} ${stempel}`;
const sporsmaal = (n: number) => ({
  stem: L(`Question ${n}?`, `Spørsmål ${n}?`),
  options: [L("Alpha", "Alfa"), L("Beta", "Beta"), L("Gamma", "Gamma"), L("Delta", "Delta")],
  correctAnswer: L("Beta", "Beta"),
  rationale: L("Because.", "Fordi."),
});

const tilstand: { seksjon?: string; modul?: string; kurs?: string; kursSlettet?: boolean } = {};
const kurssti = (id: string) => `/api/admin/content/courses/${id}`;

test.afterAll(async () => {
  const mislyktes: string[] = [];
  if (tilstand.kurs && !tilstand.kursSlettet) {
    await arkiverKurs(api, tilstand.kurs);
    const s = await api("DELETE", kurssti(tilstand.kurs));
    noter("rydding: kurs", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`kurs: ${s.status} ${s.json.error ?? ""}`);
  }
  if (tilstand.seksjon) {
    await api("POST", `/api/admin/content/sections/${tilstand.seksjon}/archive`);
    const s = await api("DELETE", `/api/admin/content/sections/${tilstand.seksjon}`);
    noter("rydding: seksjon", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`seksjon: ${s.status} ${s.json.error ?? ""}`);
  }
  if (tilstand.modul) {
    await api("POST", `/api/admin/content/modules/${tilstand.modul}/unpublish`, {});
    await api("POST", `/api/admin/content/modules/${tilstand.modul}/archive`, {});
    const s = await api("DELETE", `/api/admin/content/modules/${tilstand.modul}`);
    noter("rydding: modul (beholdes arkivert når den har en innlevering)", { status: s.status, error: s.json.error });
    const etter = await api("GET", `/api/admin/content/modules/${tilstand.modul}/export`);
    if (s.status >= 300 && etter.status === 200 && !etter.json.moduleExport?.module?.archivedAt) mislyktes.push("modulen står igjen uarkivert");
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.164.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.164.0"));
});

test("testdata: et publisert kurs med en seksjon og en flervalgsmodul", async () => {
  test.setTimeout(240_000);
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(navn("seksjon")), bodyMarkdown: L("Text for reading.", "Tekst å lese.") });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  tilstand.seksjon = seksjon.json.section.id as string;
  expect((await api("POST", `/api/admin/content/sections/${tilstand.seksjon}/publish`)).status).toBe(200);

  const modul = await api("POST", "/api/admin/content/modules", { title: L(navn("modul")), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  tilstand.modul = modul.json.module.id as string;
  const sett = await api("POST", `/api/admin/content/modules/${tilstand.modul}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [sporsmaal(1), sporsmaal(2)] });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  const versjon = await api("POST", `/api/admin/content/modules/${tilstand.modul}/module-versions`, { assessmentMode: "MCQ_ONLY", mcqSetVersionId: sett.json.mcqSetVersion.id, assessmentPolicy: { passRules: { mcqMinPercent: 50 } } });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  const publisert = await api("POST", `/api/admin/content/modules/${tilstand.modul}/module-versions/${versjon.json.moduleVersion.id}/publish`, {});
  expect([200, 201], publisert.tekst.slice(0, 300)).toContain(publisert.status);

  const kurs = await api("POST", "/api/admin/content/courses", { title: L(navn("kurs")), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kurs = kurs.json.course.id as string;
  expect((await api("PUT", `${kurssti(tilstand.kurs)}/items`, { items: [{ type: "SECTION", sectionId: tilstand.seksjon }, { type: "MODULE", moduleId: tilstand.modul }] })).status).toBe(204);
  const p = await api("POST", `${kurssti(tilstand.kurs)}/publish`);
  expect(p.status, p.tekst.slice(0, 300)).toBe(200);
});

test("A: seksjonen står i adressen; tilbake lukker den og står i kurset; fram og oppdatering holder den åpen", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.kurs, "testdataene ble ikke laget");
  await forberedSide(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/participant?courseId=${tilstand.kurs}`, { waitUntil: "domcontentloaded" });
  const detalj = page.locator(`#courseDetail_${tilstand.kurs}`);
  const seksjonsrad = detalj.locator('.course-item[data-type="SECTION"] .course-module-row').first();
  await expect(seksjonsrad).toBeVisible({ timeout: 45_000 });
  await seksjonsrad.click();
  await expect(page.locator("#sectionReaderBody")).toContainText("Tekst å lese.", { timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`sectionId=${tilstand.seksjon}`));
  noter("A, etter åpning", page.url().replace(BASE, ""));

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`courseId=${tilstand.kurs}(?!.*sectionId)`));
  await expect(seksjonsrad).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#sectionReaderBody")).toBeHidden();
  noter("A, etter tilbake", page.url().replace(BASE, ""));

  await page.goForward();
  await expect(page.locator("#sectionReaderBody")).toContainText("Tekst å lese.", { timeout: 30_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#sectionReaderBody")).toContainText("Tekst å lese.", { timeout: 45_000 });
  noter("A, etter oppdatering", page.url().replace(BASE, ""));
  fs.mkdirSync(RAPPORT, { recursive: true });
  await page.screenshot({ path: path.join(RAPPORT, "2164-seksjon-etter-oppdatering-390.png") });
});

test("B: en avkrysning i flervalgstesten overlever oppdatering, uten tekniske meldinger", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!tilstand.kurs, "testdataene ble ikke laget");
  await forberedSide(page);
  const meldinger: string[] = [];
  page.on("console", () => undefined);
  await page.addInitScript(() => {
    const sett: string[] = [];
    (window as unknown as { __meldinger: string[] }).__meldinger = sett;
    new MutationObserver((endringer) => {
      for (const endring of endringer) for (const node of endring.addedNodes) {
        if (node instanceof Element) for (const el of [node, ...node.querySelectorAll("*")]) if (el.matches(".toast, .toast__message")) sett.push(el.textContent ?? "");
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/participant?courseId=${tilstand.kurs}`, { waitUntil: "domcontentloaded" });
  const modulrad = page.locator(`#courseDetail_${tilstand.kurs} .course-item[data-type="MODULE"] .course-module-row`).first();
  await expect(modulrad).toBeVisible({ timeout: 45_000 });
  await modulrad.click();
  await expect(page).toHaveURL(new RegExp(`moduleId=${tilstand.modul}`));
  const valg = page.locator("#mcqQuestions input[type=radio], #mcqQuestions input[type=checkbox]");
  await expect(valg.first()).toBeVisible({ timeout: 60_000 });
  // Alternativene stokkes på nytt ved hver henting: sjekk det valgte alternativet etter verdien, ikke etter plassen.
  const valgt = valg.nth(1);
  const navnPåGruppa = await valgt.getAttribute("name");
  const verdi = await valgt.getAttribute("value");
  await valgt.check();
  // Vent til utkastet faktisk er lagret i nettleseren (ikke en fast pause): det bærer forsøket og avkrysningen (#1160).
  await expect
    .poll(async () => page.evaluate(() => {
      try { return localStorage.getItem("participant.moduleDrafts.v1") ?? ""; } catch { return ""; }
    }), { timeout: 15_000 })
    .toMatch(/submissionId/);
  meldinger.push(...(await page.evaluate(() => (window as unknown as { __meldinger?: string[] }).__meldinger ?? [])));

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(valg.first()).toBeVisible({ timeout: 60_000 });
  const sammeValg = page.locator(`#mcqQuestions input[name="${navnPåGruppa}"][value="${verdi}"]`);
  await expect(sammeValg, `alternativet «${verdi}» er ikke krysset av etter oppdateringen`).toBeChecked({ timeout: 30_000 });
  meldinger.push(...(await page.evaluate(() => (window as unknown as { __meldinger?: string[] }).__meldinger ?? [])));
  const forsøksId = await page.locator("#attemptIdLine").isVisible().catch(() => false);
  noter("B", { meldinger, forsøksIdSynlig: forsøksId, url: page.url().replace(BASE, "") });
  expect(meldinger.join(" | ")).not.toMatch(/Opprett innlevering|Request completed/);
  expect(forsøksId, "«Forsøks-ID» vises").toBe(false);
  fs.mkdirSync(RAPPORT, { recursive: true });
  await page.screenshot({ path: path.join(RAPPORT, "2164-flervalg-etter-oppdatering.png") });
});
