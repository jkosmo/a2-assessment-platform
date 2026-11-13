import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.154.0 mot UTRULLET stage: #1140 etappe 1 — hvilken versjon av en modul en deltaker får, avgjøres ett sted, og kurset modulen
// åpnes fra, følger med (doc/DESIGN_1140.md, doc/design/PLAN_1140_E1.md).
//
// Ingen kurs kan låse en hovedversjon ennå, så det testen kan vise på stage, er at ALT ER SOM FØR med den nye koden i veien:
//   - migreringen er lagt inn (innleveringen leser låsene under innholdslåsen; uten kolonnen ville den feilet med 500);
//   - de tre lesingene gir modulens aktive versjon, med og uten kurs, og med et kurs som ikke finnes;
//   - innlevering med kurset → 201 på versjonen siden viste; flervalg og resultat; kurset viser modulen som bestått;
//   - en ny versjon: den gamle gir 409 `module_version_changed`, også med kurset, og ingenting er skrevet;
//   - den EKTE deltakersiden: åpner modulen fra kurset, henter modullista med `?courseId=`, og sender kurset med innleveringen.
//
// Hva testen IKKE kan se: et kurs som viser en eldre hovedversjon (feltet har ingen skriver før etappe 3). Regelen er prøvd
// i `test/m2-participant-module-version-1140.test.ts`, deltakersiden mot etterlignede API-er i
// `test/e2e/participant-module-course-context-1140.spec.ts`.
//
// Det testen skriver på stage: to moduler og ett kurs («Stage-test 2.154 …»), og tre innleveringer for testkontoen. Kurset og
// modulene arkiveres etterpå. ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` (eller `.stage-service-auth.json`) og
// skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.154.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

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
const tilstand: { kursId?: string; modulA?: string; modulB?: string; versjonA?: string; versjonB?: string } = {};

async function lagModul(navn: string) {
  const modul = await api("POST", "/api/admin/content/modules", { title: L(`Stage-test 2.154 ${navn} ${stempel}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  return modul.json.module.id as string;
}

async function publiserModulversjon(moduleId: string, oppgavenavn: string) {
  const sett = await api("POST", `/api/admin/content/modules/${moduleId}/mcq-set-versions`, {
    title: L("Sett"),
    questions: [{ stem: L(`Hva er riktig i ${oppgavenavn}?`), options: [L("Riktig"), L("Galt")], correctAnswer: L("Riktig"), rationale: L("Fordi.") }],
  });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  const versjon = await api("POST", `/api/admin/content/modules/${moduleId}/module-versions`, {
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: sett.json.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 }, mcq: { reviewAfterSubmit: true, shuffleQuestions: false } },
  });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  const publisert = await api("POST", `/api/admin/content/modules/${moduleId}/module-versions/${versjon.json.moduleVersion.id}/publish`, {});
  expect([200, 201], publisert.tekst.slice(0, 300)).toContain(publisert.status);
  return versjon.json.moduleVersion.id as string;
}

/** De tre lesingene, i kursets sammenheng eller uten. */
async function visteVersjoner(moduleId: string, courseId?: string) {
  const q = courseId === undefined ? "" : `?courseId=${encodeURIComponent(courseId)}`;
  const liste = await api("GET", `/api/modules${q}`);
  expect(liste.status, liste.tekst.slice(0, 300)).toBe(200);
  const iLista = (liste.json.modules as Array<{ id: string; activeVersion?: { id?: string } }>).find((m) => m.id === moduleId);
  const enkel = await api("GET", `/api/modules/${moduleId}${q}`);
  const aktiv = await api("GET", `/api/modules/${moduleId}/active-version${q}`);
  expect([enkel.status, aktiv.status]).toEqual([200, 200]);
  return [iLista?.activeVersion?.id, enkel.json.module?.activeVersion?.id, aktiv.json.activeVersion?.id];
}

test.afterAll(async () => {
  if (tilstand.kursId) {
    await api("POST", `/api/admin/content/courses/${tilstand.kursId}/unpublish`);
    // Testkontoen står som påbegynt i kurset (modul B er åpnet, ikke fullført), og et kurs med påbegynte deltakere kan ikke
    // arkiveres; en modul som ligger i et kurs, kan heller ikke. Kurset tømmes derfor først (første kjøring 2026-11-11 lot
    // begge ligge igjen med 400).
    const kurs = await api("GET", `/api/admin/content/courses/${tilstand.kursId}`);
    noter("tøm testkurs", (await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items: [], expectedRevision: kurs.json.course?.contentRevision })).status);
    noter("arkiver testkurs", (await arkiverKurs(api, tilstand.kursId)).status);
  }
  for (const id of [tilstand.modulA, tilstand.modulB]) {
    if (id) noter("arkiver testmodul", (await api("POST", `/api/admin/content/modules/${id}/archive`)).status);
  }
});

test("versjonen er minst 2.154.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.154.0"));
});

test("lesing, innlevering, flervalg og resultat med kurset oppgitt: som før, og en eldre versjon avvises", async () => {
  test.setTimeout(240_000);
  tilstand.modulA = await lagModul("modul A");
  tilstand.modulB = await lagModul("modul B");
  tilstand.versjonA = await publiserModulversjon(tilstand.modulA, "A");
  tilstand.versjonB = await publiserModulversjon(tilstand.modulB, "B");
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test 2.154 kurs ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, {
    items: [{ type: "MODULE", moduleId: tilstand.modulA }, { type: "MODULE", moduleId: tilstand.modulB }],
  })).status).toBe(204);
  const publisert = await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish`);
  expect(publisert.status, publisert.tekst.slice(0, 400)).toBe(200);

  // Lesingene: modulens aktive versjon, i kurset, uten kurs, og med et kurs som ikke finnes.
  for (const kursId of [tilstand.kursId, undefined, "finnes-ikke"]) {
    const vist = await visteVersjoner(tilstand.modulA, kursId);
    noter(`lesing (${kursId === undefined ? "uten kurs" : kursId === tilstand.kursId ? "kurset" : "ukjent kurs"})`, vist.every((id) => id === tilstand.versjonA));
    expect(vist).toEqual([tilstand.versjonA, tilstand.versjonA, tilstand.versjonA]);
  }

  // Innlevering med kurset, slik deltakersiden sender den. Leser låsene under innholdslåsen: uten migreringen, 500.
  const levert = await api("POST", "/api/submissions", { moduleId: tilstand.modulA, moduleVersionId: tilstand.versjonA, courseId: tilstand.kursId, deliveryType: "text", responseJson: {} });
  noter("innlevering med kurset", { status: levert.status, error: levert.json.error });
  expect(levert.status, levert.tekst.slice(0, 300)).toBe(201);
  expect(levert.json.submission.moduleVersionId).toBe(tilstand.versjonA);
  const submissionId = levert.json.submission.id as string;

  const start = await api("GET", `/api/modules/${tilstand.modulA}/mcq/start?submissionId=${submissionId}`);
  expect(start.status, start.tekst.slice(0, 300)).toBe(200);
  const svar = await api("POST", `/api/modules/${tilstand.modulA}/mcq/submit`, {
    submissionId,
    attemptId: start.json.attemptId,
    responses: (start.json.questions as Array<{ id: string }>).map((q) => ({ questionId: q.id, selectedAnswer: "Riktig" })),
  });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  const resultat = await api("GET", `/api/submissions/${submissionId}/result`);
  noter("resultat", { status: resultat.json.status, bestått: resultat.json.decision?.passFailTotal });
  expect(resultat.json.decision?.passFailTotal).toBe(true);

  const detalj = await api("GET", `/api/courses/${tilstand.kursId}`);
  const iKurset = (detalj.json.course.items as Array<{ moduleId?: string; moduleStatus?: string; available?: boolean }>).find((i) => i.moduleId === tilstand.modulA);
  noter("modulen i kurset etter bestått", iKurset);
  expect(iKurset?.moduleStatus).toBe("PASSED");
  expect(iKurset?.available).toBe(true);

  // En ny versjon: den forrige gjelder ikke lenger, heller ikke når kurset er oppgitt, og ingenting skrives.
  const ny = await publiserModulversjon(tilstand.modulA, "A, rettet");
  expect(ny).not.toBe(tilstand.versjonA);
  expect(await visteVersjoner(tilstand.modulA, tilstand.kursId)).toEqual([ny, ny, ny]);
  const utdatert = await api("POST", "/api/submissions", { moduleId: tilstand.modulA, moduleVersionId: tilstand.versjonA, courseId: tilstand.kursId, deliveryType: "text", responseJson: {} });
  noter("innlevering med eldre versjon og kurset", { status: utdatert.status, error: utdatert.json.error });
  expect(utdatert.status).toBe(409);
  expect(utdatert.json.error).toBe("module_version_changed");
  const utenKurs = await api("POST", "/api/submissions", { moduleId: tilstand.modulA, moduleVersionId: ny, deliveryType: "text", responseJson: {} });
  noter("innlevering uten kurset (eldre klient)", { status: utenKurs.status });
  expect(utenKurs.status, utenKurs.tekst.slice(0, 300)).toBe(201);
  expect(utenKurs.json.submission.moduleVersionId).toBe(ny);
});

test("den ekte deltakersiden: modulen åpnet fra kurset henter lista for kurset og sender kurset med innleveringen", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!tilstand.kursId || !tilstand.modulB, "kurset ble ikke laget");
  await forberedSide(page);
  const lister: string[] = [];
  const innleveringer: Array<{ body: Record<string, unknown>; status?: number }> = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (req.method() === "GET" && url.pathname === "/api/modules") lister.push(url.searchParams.get("courseId") ?? "(uten kurs)");
  });
  page.on("response", async (res) => {
    const req = res.request();
    if (req.method() === "POST" && /\/api\/submissions$/.test(new URL(req.url()).pathname)) {
      innleveringer.push({ body: req.postDataJSON() as Record<string, unknown>, status: res.status() });
    }
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/participant?courseId=${tilstand.kursId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".course-sequence")).toBeVisible({ timeout: 45000 });
  // Modul B er en ren flervalgsmodul som ikke er tatt: å åpne den starter innleveringen.
  await page.locator(".course-sequence .course-module-row").nth(1).click();

  await expect.poll(() => innleveringer.length, { timeout: 60000 }).toBe(1);
  noter("modullista hentet for", lister);
  noter("innleveringen fra siden", { status: innleveringer[0].status, courseId: innleveringer[0].body.courseId === tilstand.kursId, versjon: innleveringer[0].body.moduleVersionId === tilstand.versjonB });
  expect(lister).toContain(tilstand.kursId);
  expect(innleveringer[0].status).toBe(201);
  expect(innleveringer[0].body).toMatchObject({ moduleId: tilstand.modulB, moduleVersionId: tilstand.versjonB, courseId: tilstand.kursId });
  // Spørsmålet fra versjonen innleveringen står på, vises.
  await expect(page.getByText("Hva er riktig i B?")).toBeVisible({ timeout: 45000 });
  await page.screenshot({ path: path.join(RAPPORT, "2154-modul-fra-kurs.png"), fullPage: true });
});
