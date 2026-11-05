import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";
import { synthesizeModuleEnvelope } from "../../skills/a2-authoring-api/scripts/synthesize-envelopes.mjs";

// Skillet (references/modules.md, «Practice: a draw and a review») lover at `assessmentPolicy.mcq` i importfila virker. Mot UTRULLET
// stage, gjennom samme rute som `import-package.mjs` bruker: en modul med seks spørsmål, tre per forsøk og gjennomgang på. Og en uten,
// som kontroll: alle spørsmålene, og ingen fasit.
//
// Det testen skriver på stage: to moduler og to kurs («Stage-test skill …»), innleveringer for testkontoen. Alt arkiveres etterpå.
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
const moduler: string[] = [];
const kursene: string[] = [];

const spørsmål = (nr: number) => ({
  stem: L(`Hva er riktig om punkt ${nr}?`),
  options: [L(`Riktig ${nr}`), L(`Galt ${nr}`), L(`Også galt ${nr}`)],
  correctAnswer: L(`Riktig ${nr}`),
  rationale: L(`Fordi punkt ${nr} sier det.`),
});

async function importer(navn: string, mcq: Record<string, unknown> | undefined) {
  const svar = await api("POST", "/api/admin/content/modules/import", {
    // Samme konvolutt som skillet lager.
    payload: synthesizeModuleEnvelope({
      module: { title: L(`Stage-test skill ${navn} ${stempel}`), description: L("Stage-test."), certificationLevel: "basic" },
      activeVersion: {
        assessmentMode: "MCQ_ONLY",
        mcqSet: { title: L("Sett"), questions: [1, 2, 3, 4, 5, 6].map(spørsmål) },
        assessmentPolicy: { passRules: { mcqMinPercent: 50 }, ...(mcq ? { mcq } : {}) },
      },
    }),
    mode: "createNew",
    autoPublish: true,
  });
  expect(svar.status, svar.tekst.slice(0, 400)).toBeLessThan(300);
  const id = svar.json.moduleId as string;
  expect(id, svar.tekst.slice(0, 400)).toBeTruthy();
  moduler.push(id);
  // En deltaker når modulen gjennom et kurs.
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test skill ${navn} ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  kursene.push(kurs.json.course.id);
  expect((await api("PUT", `/api/admin/content/courses/${kurs.json.course.id}/items`, { items: [{ type: "MODULE", moduleId: id }] })).status).toBe(204);
  const publisert = await api("POST", `/api/admin/content/courses/${kurs.json.course.id}/publish`, { publishItems: true });
  expect(publisert.status, publisert.tekst.slice(0, 300)).toBe(200);
  return id;
}

async function taModulen(moduleId: string) {
  const vist = await api("GET", `/api/modules/${moduleId}`);
  const levert = await api("POST", "/api/submissions", { moduleId, moduleVersionId: vist.json.module.activeVersion.id, deliveryType: "text", responseJson: {} });
  expect(levert.status, levert.tekst.slice(0, 300)).toBe(201);
  const submissionId = levert.json.submission.id as string;
  const start = await api("GET", `/api/modules/${moduleId}/mcq/start?submissionId=${submissionId}&locale=nb`);
  expect(start.status, start.tekst.slice(0, 300)).toBe(200);
  const spm = start.json.questions as Array<{ id: string; options: string[] }>;
  const svar = await api("POST", `/api/modules/${moduleId}/mcq/submit`, {
    submissionId,
    attemptId: start.json.attemptId,
    responses: spm.map((q) => ({ questionId: q.id, selectedAnswer: q.options.find((o) => o.startsWith("Riktig")) ?? q.options[0] })),
  });
  expect(svar.status, svar.tekst.slice(0, 300)).toBeLessThan(300);
  return { submissionId, antall: spm.length };
}

async function gjennomgang(submissionId: string) {
  for (let forsøk = 0; forsøk < 20; forsøk += 1) {
    const svar = await api("GET", `/api/submissions/${submissionId}/mcq-review`);
    if (svar.status === 200 && (svar.json.enabled === false || (svar.json.questions?.length ?? 0) > 0)) return svar.json as { enabled: boolean; questions: Array<{ rationale?: unknown }> };
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error("Fikk ikke noe svar fra gjennomgangen");
}

test.afterAll(async () => {
  for (const id of kursene) {
    await api("POST", `/api/admin/content/courses/${id}/unpublish`);
    await api("POST", `/api/admin/content/courses/${id}/archive`);
  }
  for (const id of moduler) await api("POST", `/api/admin/content/modules/${id}/archive`);
});

test("med feltene i fila: tre av seks per forsøk, og gjennomgang etter innlevering", async () => {
  test.setTimeout(180_000);
  const id = await importer("trekk", { questionsPerAttempt: 3, reviewAfterSubmit: true });
  const { submissionId, antall } = await taModulen(id);
  expect(antall).toBe(3);
  const fasit = await gjennomgang(submissionId);
  expect(fasit.enabled).toBe(true);
  expect(fasit.questions).toHaveLength(3);
});

test("KONTROLL, uten feltene: alle seks, og ingen fasit", async () => {
  test.setTimeout(180_000);
  const id = await importer("uten", undefined);
  const { submissionId, antall } = await taModulen(id);
  expect(antall).toBe(6);
  const fasit = await gjennomgang(submissionId);
  expect(fasit.enabled).toBe(false);
});
