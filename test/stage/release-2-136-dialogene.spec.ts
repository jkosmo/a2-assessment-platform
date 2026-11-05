import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.136.0 mot UTRULLET stage: #934 skive 5b (doc/DESIGN_934.md, «5b — bygget»). Bare API, med tjenestekontoen. Dialogene selv er testet i
// test/e2e/admin-content-module-publish-934-5b.spec.ts og admin-content-course-pending-934-5b.spec.ts, mot falske API-er. Her måles det
// de lener seg på, mot en ekte server:
//   - forhåndsvisningen gir enten `409 module_versioning_not_active` (da brukes den gamle dialogen) eller kursene. Noe annet ville stoppet
//     publisering, for siden kan ikke vite hva den skal spørre om;
//   - en publisering går gjennom med den veien bryteren sier, og modulen får nummer;
//   - modullistene har nummeret, og `versionNo` står som før;
//   - kurseksporten har kursets versjon, og importen leser den ikke.
//
// Testen virker både med bryteren av og på, og noterer hvilken den så.
//
// Det testen skriver på stage: én modul og to kurs («Stage-test 2.136 …»). Kursene og modulen arkiveres etterpå.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` (eller `.stage-auth.json`) og skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.136.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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
const tilstand: { moduleId?: string; kursId?: string; importert?: string; utkast?: string; bryterPå?: boolean } = {};
const modulsti = () => `/api/admin/content/modules/${tilstand.moduleId}/module-versions`;

async function nyVersjon(navn: string) {
  const sett = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/mcq-set-versions`, {
    title: L("Sett"),
    questions: [{ stem: L(`Hva er riktig i ${navn}?`), options: [L("Riktig"), L("Galt")], correctAnswer: L("Riktig"), rationale: L("Fordi.") }],
  });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  const versjon = await api("POST", modulsti(), {
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: sett.json.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 }, mcq: { reviewAfterSubmit: true, shuffleQuestions: false } },
  });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  return versjon.json.moduleVersion.id as string;
}

/** Som dialogen: forhåndsvisningen avgjør veien. */
async function publiserSomDialogen(versjonId: string) {
  const forhånd = await api("GET", `${modulsti()}/${versjonId}/publish-preview-versioned`);
  if (forhånd.status === 409) {
    expect(forhånd.json.error).toBe("module_versioning_not_active");
    tilstand.bryterPå = false;
    return api("POST", `${modulsti()}/${versjonId}/publish`, { supersedesEarlierPasses: false });
  }
  expect(forhånd.status, forhånd.tekst.slice(0, 300)).toBe(200);
  expect(Array.isArray(forhånd.json.courses)).toBe(true);
  tilstand.bryterPå = true;
  return api("POST", `${modulsti()}/${versjonId}/publish-versioned`, { moduleVersion: "minor" });
}

test.afterAll(async () => {
  for (const id of [tilstand.kursId, tilstand.importert]) {
    if (!id) continue;
    await api("POST", `/api/admin/content/courses/${id}/unpublish`);
    noter("arkiver testkurs", (await api("POST", `/api/admin/content/courses/${id}/archive`)).status);
  }
  if (tilstand.moduleId) noter("arkiver testmodul", (await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/archive`)).status);
});

test("versjonen er 2.136.0", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.136.0");
});

test("forhåndsvisningen sier hvilken vei dialogen skal gå, og publiseringen virker den veien", async () => {
  test.setTimeout(120_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: L(`Stage-test 2.136 modul ${stempel}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  tilstand.moduleId = modul.json.module.id;
  const svar = await publiserSomDialogen(await nyVersjon("første"));
  noter("bryteren er på", tilstand.bryterPå);
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  expect(`${svar.json.moduleVersion.versionMajor}.${svar.json.moduleVersion.versionMinor}`).toBe("1.0");
});

test("kurset er ute, og forhåndsvisningen eller `pending-versions` stemmer med bryteren", async () => {
  test.setTimeout(120_000);
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test 2.136 kurs ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items: [{ type: "MODULE", moduleId: tilstand.moduleId }] })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish`)).status).toBe(200);

  tilstand.utkast = await nyVersjon("andre");
  const ventende = await api("GET", `/api/admin/content/courses/${tilstand.kursId}/pending-versions`);
  expect(ventende.status, ventende.tekst.slice(0, 300)).toBe(200);
  if (tilstand.bryterPå) {
    const rad = (ventende.json.affectedCourses as Array<Record<string, unknown>>).find((one) => one.courseId === tilstand.kursId);
    expect(rad).toMatchObject({ published: true, certificateHolders: 0, majorEmailRecipients: 0 });
  } else {
    // Dialogen velger den gamle veien fordi feltet mangler.
    expect(ventende.json).not.toHaveProperty("affectedCourses");
  }
  const sendt = await publiserSomDialogen(tilstand.utkast);
  expect(sendt.status, sendt.tekst.slice(0, 300)).toBe(200);
  expect(`${sendt.json.moduleVersion.versionMajor}.${sendt.json.moduleVersion.versionMinor}`).toBe("1.1");
});

test("modullistene har nummeret, og `versionNo` står som før", async () => {
  const bibliotek = await api("GET", "/api/admin/content/modules/library");
  expect(bibliotek.status).toBe(200);
  const rad = (bibliotek.json.modules as Array<Record<string, unknown>>).find((module) => module.id === tilstand.moduleId);
  noter("bibliotekrad", { activeVersionNo: rad?.activeVersionNo, activeVersionMajor: rad?.activeVersionMajor, activeVersionMinor: rad?.activeVersionMinor });
  expect(rad).toMatchObject({ activeVersionNo: 2, activeVersionMajor: 1, activeVersionMinor: 1 });

  const deltaker = await api("GET", `/api/modules/${tilstand.moduleId}`);
  expect(deltaker.status, deltaker.tekst.slice(0, 300)).toBe(200);
  expect(deltaker.json.module.activeVersion).toMatchObject({ versionNo: 2, versionMajor: 1, versionMinor: 1 });

  const pakke = await api("GET", `/api/admin/content/modules/${tilstand.moduleId}/export`);
  expect(pakke.status, pakke.tekst.slice(0, 300)).toBe(200);
  const versjoner = pakke.json.moduleExport.versions.moduleVersions as Array<Record<string, unknown>>;
  expect(versjoner.find((version) => version.id === tilstand.utkast)).toMatchObject({ versionNo: 2, versionMajor: 1, versionMinor: 1 });
});

test("kurseksporten har versjonen, og en fil med et annet nummer endrer ikke noe", async () => {
  test.setTimeout(120_000);
  const ut = await api("GET", `/api/admin/content/courses/${tilstand.kursId}/export-package`);
  expect(ut.status, ut.tekst.slice(0, 300)).toBe(200);
  const fil = ut.json.envelope ?? ut.json;
  noter("eksportert versjon", { major: fil.course.course.versionMajor, minor: fil.course.course.versionMinor });
  expect(Number.isInteger(fil.course.course.versionMajor)).toBe(true);
  expect(Number.isInteger(fil.course.course.versionMinor)).toBe(true);

  fil.course.course.versionMajor = 7;
  fil.course.course.versionMinor = 9;
  const inn = await api("POST", "/api/admin/content/courses/import", { payload: fil, mode: "createNew" });
  expect(inn.status, inn.tekst.slice(0, 400)).toBe(201);
  tilstand.importert = inn.json.courseId;
  const lest = await api("GET", `/api/admin/content/courses/${tilstand.importert}`);
  expect(lest.status, lest.tekst.slice(0, 300)).toBe(200);
  expect(lest.json.course).toMatchObject({ versionMajor: 1, versionMinor: 0 });
});
