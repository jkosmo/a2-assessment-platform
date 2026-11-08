import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";

// 2.134.0 mot UTRULLET stage: #934 skive 5a-2, grunnmuren ved siden av dagens regel (doc/DESIGN_934.md, «5a-2»). Bare API,
// med tjenestekontoen.
//   - publisering gir versjonsnummer: 1.0, mindre uten avkrysning, og kalibreringen er mindre;
//   - flervalg gjennom hele veien: innsynseksporten viser en `modulePasses`-rad med versjonen deltakeren svarte på, og
//     status for modulen er som før.
//
// Testgjennomgangen 2026-11: testene av den gamle avkrysningen (2.0 og `SUPERSEDED`) og de to avvisningene som bygget på den,
// er fjernet. Med bryteren på gir avkrysningen `409 client_outdated` (src/modules/adminContent/adminContentCommands.ts), og
// det testes i `release-2-136-regelen-per-kurs.spec.ts`. Avvisningene med bryteren på er dekket av
// test/m2-module-pass-per-course-934-5a3.test.ts («module_version_number_fixed», «module_version_outdated»).
//
// Hva testen IKKE kan se: kravet per kurs, tilbakefyllingen og rapporten har ingen rute. De kjøres mot databasen (se
// «5a-2 — bygget» for rekkefølgen), og er dekket av `test/m2-module-credit-934-5a2.test.ts`.
//
// Det testen skriver på stage: én modul og ett kurs («Stage-test 2.134 …») med versjoner, én innlevering og én bestått for
// testkontoen. Kurset og modulen arkiveres etterpå.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` (eller `.stage-auth.json`) og skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.134.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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
const tilstand: { kursId?: string; moduleId?: string; versjoner: string[] } = { versjoner: [] };

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

async function publiserOk(versjonId: string, body: object = {}) {
  const svar = await publiser(versjonId, body);
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  return `${svar.json.moduleVersion.versionMajor}.${svar.json.moduleVersion.versionMinor}`;
}

test.afterAll(async () => {
  if (tilstand.kursId) {
    await api("POST", `/api/admin/content/courses/${tilstand.kursId}/unpublish`);
    noter("arkiver testkurs", (await api("POST", `/api/admin/content/courses/${tilstand.kursId}/archive`)).status);
  }
  if (tilstand.moduleId) noter("arkiver testmodul", (await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/archive`)).status);
});

test("versjonen er minst 2.134.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.134.0"));
});

test("publisering gir nummer: 1.0, 1.1 uten avkrysning, og kurset beholder modulen", async () => {
  test.setTimeout(120_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: L(`Stage-test 2.134 modul ${stempel}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  tilstand.moduleId = modul.json.module.id;

  const første = await publiserOk(await nyVersjon("første"));
  noter("første publisering", første);
  expect(første).toBe("1.0");

  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test 2.134 kurs ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items: [{ type: "MODULE", moduleId: tilstand.moduleId }] })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish`)).status).toBe(200);

  const mindre = await publiserOk(await nyVersjon("andre"), { supersedesEarlierPasses: false });
  noter("uten avkrysning", mindre);
  expect(mindre).toBe("1.1");
});

test("flervalg hele veien: innsynseksporten viser beståtten med versjonen, og status er som før", async () => {
  test.setTimeout(180_000);
  const vist = await api("GET", `/api/modules/${tilstand.moduleId}`);
  const versjon = vist.json.module.activeVersion.id as string;
  expect(versjon).toBe(tilstand.versjoner[1]);
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

  // Vedtaket kommer fra vurderingsjobben, så det kan ta litt.
  let rad: { moduleVersionId?: string; invalidatedAt?: string | null } | undefined;
  for (let forsøk = 0; forsøk < 40 && !rad; forsøk += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const eksport = await api("GET", "/api/me/data");
    expect(eksport.status).toBe(200);
    rad = (eksport.json.profile.modulePasses as Array<{ moduleId: string; moduleVersionId: string; invalidatedAt: string | null }>).find((p) => p.moduleId === tilstand.moduleId);
  }
  noter("modulePasses-rad", rad ?? "fant ingen");
  expect(rad, "en bestått gir en rad").toBeTruthy();
  expect(rad!.moduleVersionId).toBe(versjon);
  expect(rad!.invalidatedAt).toBeNull();

  const eksport = await api("GET", "/api/me/data");
  const status = (eksport.json.profile.certifications as Array<{ moduleId: string; status: string }>).find((c) => c.moduleId === tilstand.moduleId);
  noter("modulstatus etter bestått", status?.status);
  expect(status?.status).toBe("ACTIVE");
});

test("kalibreringen er mindre", async () => {
  test.setTimeout(60_000);
  const svar = await api("POST", "/api/calibration/workspace/publish-thresholds", { moduleId: tilstand.moduleId, totalMin: 70 });
  noter("kalibrering", { status: svar.status, versjon: svar.json.moduleVersion ? `${svar.json.moduleVersion.versionMajor}.${svar.json.moduleVersion.versionMinor}` : null });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  // Etter 1.0 og 1.1 over. Før testgjennomgangen kom avkrysningen (2.0) imellom, og svaret var 2.1.
  expect(`${svar.json.moduleVersion.versionMajor}.${svar.json.moduleVersion.versionMinor}`).toBe("1.2");
});
