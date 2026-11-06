import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.136.0 mot UTRULLET stage MED BRYTEREN PÅ: hele veien for regelen om beståtte per kurs, på ekte database og worker. Én modul i to kurs,
// hovedversjon i A og mindre i B:
//   - B beholder beståtten, og deltakeren er ferdig der;
//   - A krever nytt forsøk, og deltakeren får kursbevis for versjon 2 først når hen har bestått på nytt;
//   - en gammel avkrysning gir 409, og kravet i A står.
// Hopper over hvis bryteren er av. Det testen skriver på stage: en modul, to kurs («Stage-test regel …») og kursbevis for testkontoen. Kursene og
// modulen arkiveres etterpå. E-posten om hovedversjon er på på stage, så testkontoens adresse kan få en.
// ⚠️ Tokenet skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { authorization: `Bearer ${auth!.accessToken}`, "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const L = (nb: string) => ({ "en-GB": nb, nb, nn: nb });
const stempel = Date.now();
const t: { moduleId?: string; a?: string; b?: string; v1?: string; v2?: string } = {};

async function nyVersjon(navn: string) {
  const sett = await api("POST", `/api/admin/content/modules/${t.moduleId}/mcq-set-versions`, {
    title: L("Sett"),
    questions: [{ stem: L(`Hva er riktig i ${navn}?`), options: [L("Riktig"), L("Galt")], correctAnswer: L("Riktig"), rationale: L("Fordi.") }],
  });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  const versjon = await api("POST", `/api/admin/content/modules/${t.moduleId}/module-versions`, {
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: sett.json.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 }, mcq: { shuffleQuestions: false } },
  });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  return versjon.json.moduleVersion.id as string;
}

async function nyttKurs(navn: string) {
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test regel ${navn} ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  const id = kurs.json.course.id as string;
  expect((await api("PUT", `/api/admin/content/courses/${id}/items`, { items: [{ type: "MODULE", moduleId: t.moduleId }] })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${id}/publish`)).status).toBe(200);
  return id;
}

async function taModulen() {
  const vist = await api("GET", `/api/modules/${t.moduleId}`);
  const levert = await api("POST", "/api/submissions", { moduleId: t.moduleId, moduleVersionId: vist.json.module.activeVersion.id, deliveryType: "text", responseJson: {} });
  expect(levert.status, levert.tekst.slice(0, 300)).toBe(201);
  const submissionId = levert.json.submission.id as string;
  const start = await api("GET", `/api/modules/${t.moduleId}/mcq/start?submissionId=${submissionId}&locale=nb`);
  expect(start.status, start.tekst.slice(0, 300)).toBe(200);
  const spm = start.json.questions as Array<{ id: string; options: string[] }>;
  const svar = await api("POST", `/api/modules/${t.moduleId}/mcq/submit`, {
    submissionId,
    attemptId: start.json.attemptId,
    responses: spm.map((q) => ({ questionId: q.id, selectedAnswer: q.options.find((o) => o === "Riktig") ?? q.options[0] })),
  });
  expect(svar.status, svar.tekst.slice(0, 300)).toBeLessThan(300);
  return submissionId;
}

async function modulen(courseId: string) {
  const detalj = await api("GET", `/api/courses/${courseId}`);
  expect(detalj.status, detalj.tekst.slice(0, 300)).toBe(200);
  return (detalj.json.course.items as Array<{ moduleId?: string; moduleStatus?: string; retakeRequired?: boolean }>).find((item) => item.moduleId === t.moduleId);
}

async function ventPåStatus(courseId: string, status: string) {
  for (let forsøk = 0; forsøk < 40; forsøk += 1) {
    if ((await modulen(courseId))?.moduleStatus === status) return;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  expect((await modulen(courseId))?.moduleStatus).toBe(status);
}

const bevis = async (courseId: string) =>
  ((await api("GET", "/api/courses/completions")).json.completions as Array<{ courseId: string; versionMajor: number }>).filter((c) => c.courseId === courseId);

test.afterAll(async () => {
  for (const id of [t.a, t.b]) {
    if (!id) continue;
    await api("POST", `/api/admin/content/courses/${id}/unpublish`);
    await api("POST", `/api/admin/content/courses/${id}/archive`);
  }
  if (t.moduleId) await api("POST", `/api/admin/content/modules/${t.moduleId}/archive`);
});

test("bestått i to kurs, så hovedversjon i A og mindre i B: B beholder, A må på nytt", async () => {
  test.setTimeout(240_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: L(`Stage-test regel modul ${stempel}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  t.moduleId = modul.json.module.id;
  t.v1 = await nyVersjon("første");
  expect((await api("POST", `/api/admin/content/modules/${t.moduleId}/module-versions/${t.v1}/publish-versioned`, { moduleVersion: "minor" })).status).toBe(200);
  t.a = await nyttKurs("A");
  t.b = await nyttKurs("B");

  await taModulen();
  await ventPåStatus(t.a, "PASSED");
  await ventPåStatus(t.b, "PASSED");
  expect(await bevis(t.a)).toHaveLength(1);
  expect(await bevis(t.b)).toHaveLength(1);

  t.v2 = await nyVersjon("andre");
  const forhånd = await api("GET", `/api/admin/content/modules/${t.moduleId}/module-versions/${t.v2}/publish-preview-versioned`);
  test.skip(forhånd.status === 409, "bryteren er av");
  expect(forhånd.status, forhånd.tekst.slice(0, 300)).toBe(200);
  expect(forhånd.json.anyonePassed).toBe(true);
  const rader = forhånd.json.courses as Array<{ courseId: string; certificateHolders: number; majorEmailRecipients: number }>;
  expect(rader.map((r) => r.courseId).sort()).toEqual([t.a, t.b].sort());
  expect(rader.find((r) => r.courseId === t.a)?.certificateHolders).toBe(1);

  const publisert = await api("POST", `/api/admin/content/modules/${t.moduleId}/module-versions/${t.v2}/publish-versioned`, {
    moduleVersion: "major",
    courseVersions: { [t.a!]: "major", [t.b!]: "minor" },
    expectedCourseIds: [t.a, t.b],
    confirmEmailRecipients: { [t.a!]: rader.find((r) => r.courseId === t.a)?.majorEmailRecipients },
  });
  expect(publisert.status, publisert.tekst.slice(0, 400)).toBe(200);
  expect(publisert.json.moduleVersion).toMatchObject({ versionMajor: 2, versionMinor: 0 });

  expect(await modulen(t.b)).toMatchObject({ moduleStatus: "PASSED" });
  expect(await modulen(t.a)).toMatchObject({ moduleStatus: "REVISED_RETAKE_REQUIRED", retakeRequired: true });
});

test("den gamle avkrysningen gir 409, og ingenting endres", async () => {
  test.setTimeout(60_000);
  const v3 = await nyVersjon("tredje");
  const gammel = await api("POST", `/api/admin/content/modules/${t.moduleId}/module-versions/${v3}/publish`, { supersedesEarlierPasses: true });
  expect(gammel.status, gammel.tekst.slice(0, 300)).toBe(409);
  expect(gammel.json.error).toBe("client_outdated");
  expect((await api("GET", `/api/modules/${t.moduleId}`)).json.module.activeVersion.id).toBe(t.v2);
  expect(await modulen(t.b)).toMatchObject({ moduleStatus: "PASSED" });
});

test("består på nytt: A er ferdig, med kursbevis for versjon 2, og B står urørt", async () => {
  test.setTimeout(240_000);
  // Den tredje versjonen fra forrige test er ikke publisert, så deltakeren får v2.
  await taModulen();
  await ventPåStatus(t.a!, "PASSED");
  expect((await modulen(t.a!))?.retakeRequired).toBeUndefined();
  let iA: Array<{ versionMajor: number }> = [];
  for (let forsøk = 0; forsøk < 20 && !iA.some((c) => c.versionMajor === 2); forsøk += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    iA = await bevis(t.a!);
  }
  expect(iA.map((c) => c.versionMajor).sort()).toEqual([1, 2]);
  expect(await bevis(t.b!)).toHaveLength(1);
  expect(await modulen(t.b!)).toMatchObject({ moduleStatus: "PASSED" });
});
