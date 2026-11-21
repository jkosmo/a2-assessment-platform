import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.174.0 mot UTRULLET stage, med ekte data (#1185, produkteier 21.11.2026: «Deltager får 7 dager så sletting»):
//
//   A. En modul med fritekst og flervalg: stage-kontoen leverer teksten, men sender ikke inn flervalget. Kurset arkiveres. «Slett»
//      svarer `course_has_unfinished_submissions` med `{ count: 1, untilDate }`, der datoen er i dag + 7 (norsk kalender), og
//      kurslista under «Arkiverte» sier det samme.
//   B. KONTROLL: en ren flervalgsmodul som bare er åpnet, holder ikke sitt kurs igjen; kurset slettes.
//   C. Deltakeren kan fortsatt starte flervalget etter arkiveringen (hele grunnen til de sju dagene).
//   D. I nettleseren: linja under «Arkiverte» med datoen på bokmål, og «Slett» gir toasten med datoen.
//   E. Deltakersidene laster uten feil i konsollen (api-error.js importerer nå content-status-badge.js).
//
// Det testen etterlater: kurs A blir stående arkivert i sju dager (det er regelen), og fritekstmodulen blir stående arkivert for
// godt (den har en levert innlevering). Alt heter «Stage-test 2.174.0 …». Kurs B og flervalgsmodulen slettes.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.174.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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
const navn = (hva: string) => `Stage-test 2.174.0 ${hva} ${stempel}`;
const sporsmaal = (n: number) => ({
  stem: L(`Question ${n}?`, `Spørsmål ${n}?`),
  options: [L("Alpha", "Alfa"), L("Beta", "Beta"), L("Gamma", "Gamma"), L("Delta", "Delta")],
  correctAnswer: L("Beta", "Beta"),
  rationale: L("Because.", "Fordi."),
});

/** I dag + 7, norsk kalender, som YYYY-MM-DD. */
function omSjuDager(): string {
  const deler = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const hent = (t: string) => Number(deler.find((d) => d.type === t)?.value);
  const dato = new Date(Date.UTC(hent("year"), hent("month") - 1, hent("day") + 7));
  return dato.toISOString().slice(0, 10);
}
const norsk = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };

const tilstand: { fritekstModul?: string; flervalgModul?: string; kursA?: string; kursB?: string; innleveringA?: string; bSlettet?: boolean } = {};
const kurssti = (id: string) => `/api/admin/content/courses/${id}`;
const modulsti = (id: string) => `/api/admin/content/modules/${id}`;

async function publisertModul(hva: string, type: "FREETEXT_PLUS_MCQ" | "MCQ_ONLY"): Promise<string> {
  const modul = await api("POST", "/api/admin/content/modules", { title: L(navn(hva)), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  const id = modul.json.module.id as string;
  const sett = await api("POST", `${modulsti(id)}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [sporsmaal(1), sporsmaal(2)] });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  let body: Record<string, unknown> = { assessmentMode: "MCQ_ONLY", mcqSetVersionId: sett.json.mcqSetVersion.id, assessmentPolicy: { passRules: { mcqMinPercent: 50 } } };
  if (type === "FREETEXT_PLUS_MCQ") {
    const kriterier = await api("POST", `${modulsti(id)}/rubric-versions`, { criteria: { relevance: "0-4" }, scalingRule: { practical_weight: 70, max_total: 20 } });
    expect(kriterier.status, kriterier.tekst.slice(0, 300)).toBe(201);
    const ledetekst = await api("POST", `${modulsti(id)}/prompt-template-versions`, { systemPrompt: L("Assess the answer."), userPromptTemplate: L("Evaluate."), examples: [] });
    expect(ledetekst.status, ledetekst.tekst.slice(0, 300)).toBe(201);
    body = {
      taskText: L("Describe one thing you learned.", "Beskriv én ting du lærte."), assessorExpectedContent: L("A concrete example.", "Et konkret eksempel."),
      rubricVersionId: kriterier.json.rubricVersion.id, promptTemplateVersionId: ledetekst.json.promptTemplateVersion.id, mcqSetVersionId: sett.json.mcqSetVersion.id,
    };
  }
  const versjon = await api("POST", `${modulsti(id)}/module-versions`, body);
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  const publisert = await api("POST", `${modulsti(id)}/module-versions/${versjon.json.moduleVersion.id}/publish`, {});
  expect([200, 201], publisert.tekst.slice(0, 300)).toContain(publisert.status);
  return id;
}

async function publisertKurs(hva: string, modulId: string): Promise<string> {
  const kurs = await api("POST", "/api/admin/content/courses", { enrollmentPolicy: "OPEN", title: L(navn(hva)), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  const id = kurs.json.course.id as string;
  expect((await api("PUT", `${kurssti(id)}/items`, { items: [{ type: "MODULE", moduleId: modulId }] })).status).toBe(204);
  const p = await api("POST", `${kurssti(id)}/publish`);
  expect(p.status, p.tekst.slice(0, 300)).toBe(200);
  return id;
}

async function lever(modulId: string, kursId: string, responseJson: Record<string, unknown>): Promise<string> {
  const versjonId = (await api("GET", `/api/modules/${modulId}`)).json.module?.activeVersion?.id;
  const svar = await api("POST", "/api/submissions", { moduleId: modulId, moduleVersionId: versjonId, courseId: kursId, deliveryType: "text", responseJson });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(201);
  return (svar.json.submission?.id ?? svar.json.id) as string;
}

test.afterAll(async () => {
  const mislyktes: string[] = [];
  if (tilstand.kursB && !tilstand.bSlettet) {
    await arkiverKurs(api, tilstand.kursB);
    const s = await api("DELETE", kurssti(tilstand.kursB));
    noter("rydding: kurs B", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`kurs B: ${s.status} ${s.json.error ?? ""}`);
  }
  if (tilstand.flervalgModul) {
    await api("POST", `${modulsti(tilstand.flervalgModul)}/archive`, {});
    const s = await api("DELETE", modulsti(tilstand.flervalgModul));
    noter("rydding: flervalgsmodulen (bare åpnet, slettes)", { status: s.status, error: s.json.error });
  }
  if (tilstand.kursA) {
    const a = await api("GET", kurssti(tilstand.kursA));
    if (a.status === 200 && !a.json.course?.archivedAt) {
      await arkiverKurs(api, tilstand.kursA);
      mislyktes.push("kurs A var ikke arkivert; arkivert i ryddingen");
    }
    noter("rydding: kurs A står arkivert i sju dager (regelen)", tilstand.kursA);
  }
  if (tilstand.fritekstModul) noter("rydding: fritekstmodulen står arkivert (levert innlevering)", tilstand.fritekstModul);
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.174.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.174.0"));
});

test("testdata: to kurs, ett med en fritekstmodul der teksten er levert, ett med en flervalgsmodul som bare er åpnet", async () => {
  test.setTimeout(300_000);
  tilstand.fritekstModul = await publisertModul("fritekst og flervalg", "FREETEXT_PLUS_MCQ");
  tilstand.kursA = await publisertKurs("kurs A", tilstand.fritekstModul);
  tilstand.flervalgModul = await publisertModul("bare flervalg", "MCQ_ONLY");
  tilstand.kursB = await publisertKurs("kurs B", tilstand.flervalgModul);

  tilstand.innleveringA = await lever(tilstand.fritekstModul, tilstand.kursA, {
    response: "Jeg lærte at et vedtak må begrunnes skriftlig, og at begrunnelsen skal vise til regelen som er brukt. Det gjør vedtaket lettere å klage på.",
  });
  await lever(tilstand.flervalgModul, tilstand.kursB, {});

  const a = await arkiverKurs(api, tilstand.kursA);
  expect(a.status, a.tekst.slice(0, 300)).toBe(200);
  const b = await arkiverKurs(api, tilstand.kursB);
  expect(b.status, b.tekst.slice(0, 300)).toBe(200);
  noter("arkivert", { a: a.status, b: b.status });
});

test("A: «Slett» på kurs A svarer course_has_unfinished_submissions med 1 deltaker og datoen om sju dager; lista sier det samme", async () => {
  test.setTimeout(180_000);
  test.skip(!tilstand.kursA, "testdataene ble ikke laget");
  const svar = await api("DELETE", kurssti(tilstand.kursA!));
  noter("A: DELETE", { status: svar.status, error: svar.json.error, details: svar.json.details });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(400);
  expect(svar.json.error).toBe("course_has_unfinished_submissions");
  expect(svar.json.details).toEqual({ count: 1, untilDate: omSjuDager() });

  const liste = await api("GET", "/api/admin/content/courses?includeRetention=1");
  expect(liste.status).toBe(200);
  const rad = (liste.json.courses as Array<{ id: string; retention?: unknown }>).find((k) => k.id === tilstand.kursA);
  noter("A: lista", rad?.retention);
  expect(rad?.retention).toEqual({ kept: { code: "course_has_unfinished_submissions", details: { count: 1, untilDate: omSjuDager() } } });
});

test("B: KONTROLL — kurset med en flervalgsmodul som bare er åpnet, slettes", async () => {
  test.setTimeout(120_000);
  test.skip(!tilstand.kursB, "testdataene ble ikke laget");
  const svar = await api("DELETE", kurssti(tilstand.kursB!));
  noter("B: DELETE", { status: svar.status, error: svar.json.error });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(204);
  tilstand.bSlettet = true;
});

test("C: deltakeren kan fortsatt starte flervalget i det arkiverte kurset (det de sju dagene er til for)", async () => {
  test.setTimeout(120_000);
  test.skip(!tilstand.innleveringA, "testdataene ble ikke laget");
  const start = await api("GET", `/api/modules/${tilstand.fritekstModul}/mcq/start?submissionId=${tilstand.innleveringA}&locale=nb`);
  noter("C: start flervalg etter arkivering", { status: start.status, error: start.json.error, spørsmål: start.json.questions?.length });
  expect(start.status, start.tekst.slice(0, 300)).toBe(200);
  expect(start.json.questions?.length).toBe(2);
});

test("D: i nettleseren — linja under «Arkiverte» og toasten fra «Slett», med datoen på bokmål", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.kursA, "testdataene ble ikke laget");
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
  const arkivFilter = page.locator('.list-filter-btn[data-filter="archived"]');
  await expect(arkivFilter).toBeVisible({ timeout: 45_000 });
  await arkivFilter.click();
  const rad = page.locator("tr", { hasText: navn("kurs A") });
  await expect(rad).toBeVisible({ timeout: 45_000 });
  const dato = norsk(omSjuDager());
  await expect(rad.locator(".retention-line")).toHaveText(`Beholdes: en deltaker har levert tekst uten å fullføre, til ${dato}`, { timeout: 45_000 });
  fs.mkdirSync(RAPPORT, { recursive: true });
  await rad.screenshot({ path: path.join(RAPPORT, "2174-kursliste.png") });

  // «Slett» fra raden: handlingen ligger i «mer»-menyen (`details.row-more`).
  const slett = rad.locator('[data-action="delete"]').first();
  await slett.waitFor({ state: "attached" });
  const meny = slett.locator("xpath=ancestor::details[contains(@class, 'row-more')]");
  if ((await meny.count()) > 0 && !(await meny.first().evaluate((el) => (el as HTMLDetailsElement).open))) await meny.first().locator("summary").click();
  await slett.click();
  await page.locator("#deleteConfirmBtn").click();
  const toast = page.locator(".toast__message").last();
  await expect(toast).toContainText(`kurset kan slettes fra ${dato}`, { timeout: 45_000 });
  noter("D: toast", await toast.textContent());
  await page.screenshot({ path: path.join(RAPPORT, "2174-slett-toast.png") });
});

test("E: deltakersidene laster uten modulfeil i konsollen (api-error.js importerer content-status-badge.js)", async ({ page }) => {
  test.setTimeout(240_000);
  await forberedSide(page);
  const feil: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") feil.push(m.text()); });
  page.on("pageerror", (e) => feil.push(e.message));
  for (const side of ["/participant", "/profile", "/results"]) {
    await page.goto(`${BASE}${side}`, { waitUntil: "load" });
    await page.waitForTimeout(3000);
  }
  const modulfeil = feil.filter((f) => /module|import|content-status-badge|api-error|SyntaxError/i.test(f));
  noter("E: konsollfeil", feil.slice(0, 10));
  expect(modulfeil, "modulfeil i konsollen").toEqual([]);
});
