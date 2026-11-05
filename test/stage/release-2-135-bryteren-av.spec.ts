import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.135.0 mot UTRULLET stage: #934 skive 5a-3 med bryteren AV (doc/DESIGN_934.md, «5a-3 — bygget»). Bare API, med tjenestekontoen.
// Det viktigste kravet ved utrullingen er at ingenting endrer seg for noen, så testen måler at:
//   - de nye endepunktene svarer `409 module_versioning_not_active`, og ingenting er skrevet;
//   - kursdetaljen og `pending-versions` har de samme feltene som i 2.134.0;
//   - den gamle avkrysningen, og kravet om svar på revisjon, virker som i 2.134.0.
//
// Hva testen IKKE kan se: regelen med bryteren PÅ. Den slås ikke på her. Den er dekket av
// `test/m2-module-pass-per-course-934-5a3.test.ts`, og av produkteiers gjennomgang når 5b er ute.
//
// Stopper testen på at bryteren er på, er det ikke noe galt med koden: da er det stage som er i en annen tilstand enn testen måler.
//
// Det testen skriver på stage: én modul og ett kurs («Stage-test 2.135 …») med versjoner, ett kursbevis og én bestått for
// testkontoen, og en revisjon (#997) på modulen. Kurset og modulen arkiveres etterpå.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` (eller `.stage-auth.json`) og skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.135.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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

const L = (nb: string) => ({ "en-GB": nb, nb, nn: nb });
const stempel = Date.now();
const tilstand: { kursId?: string; moduleId?: string; aktiv?: string; utkast?: string; versjoner: string[] } = { versjoner: [] };

async function nyVersjon(navn: string) {
  const sett = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/mcq-set-versions`, {
    title: L("Sett"),
    questions: [{ stem: L(`Hva er riktig i ${navn}?`), options: [L("Riktig"), L("Galt")], correctAnswer: L("Riktig"), rationale: L("Fordi.") }],
  });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  const versjon = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/module-versions`, {
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: sett.json.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 }, mcq: { reviewAfterSubmit: true, shuffleQuestions: false } },
  });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  const id = versjon.json.moduleVersion.id as string;
  tilstand.versjoner.push(id);
  return id;
}

const publiser = (versjonId: string, body: object = {}) =>
  api("POST", `/api/admin/content/modules/${tilstand.moduleId}/module-versions/${versjonId}/publish`, body);

test.afterAll(async () => {
  if (tilstand.kursId) {
    await api("POST", `/api/admin/content/courses/${tilstand.kursId}/unpublish`);
    noter("arkiver testkurs", (await api("POST", `/api/admin/content/courses/${tilstand.kursId}/archive`)).status);
  }
  if (tilstand.moduleId) noter("arkiver testmodul", (await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/archive`)).status);
});

test("versjonen er 2.135.0", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.135.0");
});

test("en modul og et kurs: publisering og flervalg virker som før, og deltakeren får kursbevis", async () => {
  test.setTimeout(240_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: L(`Stage-test 2.135 modul ${stempel}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  tilstand.moduleId = modul.json.module.id;
  tilstand.aktiv = await nyVersjon("første");
  const første = await publiser(tilstand.aktiv);
  expect(første.status, første.tekst.slice(0, 300)).toBe(200);
  expect(`${første.json.moduleVersion.versionMajor}.${første.json.moduleVersion.versionMinor}`).toBe("1.0");

  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test 2.135 kurs ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items: [{ type: "MODULE", moduleId: tilstand.moduleId }] })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish`)).status).toBe(200);

  const vist = await api("GET", `/api/modules/${tilstand.moduleId}`);
  const versjon = vist.json.module.activeVersion.id as string;
  const levert = await api("POST", "/api/submissions", { moduleId: tilstand.moduleId, moduleVersionId: versjon, deliveryType: "text", responseJson: {} });
  expect(levert.status, levert.tekst.slice(0, 300)).toBe(201);
  const submissionId = levert.json.submission.id as string;
  const start = await api("GET", `/api/modules/${tilstand.moduleId}/mcq/start?submissionId=${submissionId}&locale=nb`);
  expect(start.status, start.tekst.slice(0, 300)).toBe(200);
  const spørsmål = start.json.questions as Array<{ id: string; options: string[] }>;
  const svar = await api("POST", `/api/modules/${tilstand.moduleId}/mcq/submit`, {
    submissionId,
    attemptId: start.json.attemptId,
    responses: spørsmål.map((q) => ({ questionId: q.id, selectedAnswer: q.options.find((option) => option === "Riktig") ?? q.options[0] })),
  });
  expect(svar.status, svar.tekst.slice(0, 300)).toBeLessThan(300);

  // Kursbeviset kommer fra workeren eller kursbevissiden.
  let bevis: { versionMajor: number } | undefined;
  for (let forsøk = 0; forsøk < 40 && !bevis; forsøk += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const liste = await api("GET", "/api/courses/completions");
    expect(liste.status).toBe(200);
    bevis = (liste.json.completions as Array<{ courseId: string; versionMajor: number }>).find((row) => row.courseId === tilstand.kursId);
  }
  noter("kursbevis", bevis ?? "fant ikke");
  expect(bevis, "en bestått gir kursbevis").toBeTruthy();
});

test("kursdetaljen har samme felt som i 2.134.0: modulen er bestått, og feltet for den nye regelen finnes ikke", async () => {
  const svar = await api("GET", `/api/courses/${tilstand.kursId}`);
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  const rad = (svar.json.course.items as Array<Record<string, unknown>>).find((item) => item.moduleId === tilstand.moduleId);
  noter("modulrad", rad);
  expect(rad).toMatchObject({ moduleStatus: "PASSED" });
  expect(rad).not.toHaveProperty("retakeRequired");
  expect(Object.keys(rad ?? {}).sort()).toEqual(["available", "courseItemId", "discussionsEnabled", "moduleId", "moduleStatus", "required", "sortOrder", "title", "type"].sort());
});

test("de nye endepunktene: 409 module_versioning_not_active, og ingenting er skrevet", async () => {
  test.setTimeout(120_000);
  tilstand.utkast = await nyVersjon("andre");
  const modulsti = `/api/admin/content/modules/${tilstand.moduleId}/module-versions/${tilstand.utkast}`;
  for (const [navn, svar] of [
    ["forhåndsvisning", await api("GET", `${modulsti}/publish-preview-versioned`)],
    ["modul, mindre", await api("POST", `${modulsti}/publish-versioned`, { moduleVersion: "minor" })],
    ["modul, hoved", await api("POST", `${modulsti}/publish-versioned`, { moduleVersion: "major", courseVersions: { [tilstand.kursId!]: "major" }, expectedCourseIds: [tilstand.kursId] })],
    ["kurs", await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish-pending-versioned`, { versionIds: [tilstand.utkast], courseVersions: { [tilstand.kursId!]: "major" }, expectedCourseIds: [tilstand.kursId] })],
  ] as const) {
    noter(navn, { status: svar.status, error: svar.json.error });
    expect(svar.status, `${navn}: ${svar.tekst.slice(0, 300)}`).toBe(409);
    expect(svar.json.error).toBe("module_versioning_not_active");
  }
  const vist = await api("GET", `/api/modules/${tilstand.moduleId}`);
  expect(vist.json.module.activeVersion.id).toBe(tilstand.aktiv);
});

test("`pending-versions` har samme felt som i 2.134.0, og den gamle ruta krever svaret om revisjon", async () => {
  test.setTimeout(120_000);
  const svar = await api("GET", `/api/admin/content/courses/${tilstand.kursId}/pending-versions`);
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  noter("felt i pending-versions", Object.keys(svar.json).sort());
  expect(svar.json).not.toHaveProperty("affectedCourses");
  const utenSvar = await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish-pending`, { versionIds: [tilstand.utkast], courseVersion: "minor" });
  noter("uten svar om revisjon", { status: utenSvar.status, error: utenSvar.json.error });
  expect(utenSvar.status, utenSvar.tekst.slice(0, 300)).toBe(400);
  expect(utenSvar.json.error).toBe("revision_answer_required");
});

test("den gamle avkrysningen virker som før: ny hovedversjon, og statusen tas", async () => {
  test.setTimeout(120_000);
  const svar = await publiser(tilstand.utkast!, { supersedesEarlierPasses: true });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  expect(`${svar.json.moduleVersion.versionMajor}.${svar.json.moduleVersion.versionMinor}`).toBe("2.0");
  const eksport = await api("GET", "/api/me/data");
  const status = (eksport.json.profile.certifications as Array<{ moduleId: string; status: string }>).find((c) => c.moduleId === tilstand.moduleId);
  noter("modulstatus etter revisjon", status?.status);
  expect(status?.status).toBe("SUPERSEDED");
  const detalj = await api("GET", `/api/courses/${tilstand.kursId}`);
  const rad = (detalj.json.course.items as Array<Record<string, unknown>>).find((item) => item.moduleId === tilstand.moduleId);
  expect(rad).toMatchObject({ moduleStatus: "REVISED_RETAKE_REQUIRED" });
  expect(rad).not.toHaveProperty("retakeRequired");
});
