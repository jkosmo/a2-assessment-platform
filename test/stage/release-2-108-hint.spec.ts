import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.108.0 mot UTRULLET stage: #1119, skillets hint-kontroll på plattformen — varsel, ikke stopp. Lagring
// og kursimport går gjennom, og svaret bærer funnene: stamme om kurset, absolutte ord bare blant de gale,
// og (ved kursimport, der seksjonen før testen følger med) riktig svar som gjentar seksjonen ordrett.
//
// Det testen skriver på stage: en seksjon, en modul og to kurs med navn som begynner på «Stage-test»,
// slettet til slutt. Ingen språkmodell kalles.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` (eller `.stage-service-auth.json`) og skal
// ALDRI logges eller skrives ut.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.108.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const tre = (nb: string) => ({ nb, nn: nb, "en-GB": nb });
const SEKSJON = "Før møtet bør du legge bakgrunnsdokumentene i et prosjekt slik at kildene er tilgjengelige i alle samtalene hele tiden.";
const sp = (stem: string, options: string[]) => ({ stem: tre(stem), options: options.map(tre), correctAnswer: tre(options[0]!), rationale: tre("Fordi.") });
const avslørende = [
  sp("Hvorfor anbefaler kurset et prosjekt?", ["Kildene er tilgjengelige i alle samtalene hele tiden", "Prosjekter er raskere å åpne", "Det gir penere formatering"]),
  sp("Hva gjør du med utkastet fra KI?", ["Leser og retter før det sendes", "Lar KI sende det automatisk", "Sender det til alle i firmaet"]),
  sp("Hvem eier innholdet i rapporten?", ["Den som leverer den til kunden", "KI-verktøyet, alltid", "Leverandøren av verktøyet"]),
  sp("Når kan du bruke kundedata i en chat?", ["Når avtalen og verktøyet tillater det", "Aldri, under noen omstendighet", "Når kunden har sagt ja muntlig"]),
];
const tilstand: { sectionId?: string; moduleId?: string; courseIds: string[]; importedModuleIds: string[] } = { courseIds: [], importedModuleIds: [] };
const policy = { passRules: { mcqMinPercent: 60 }, mcq: { reviewAfterSubmit: true } };

test("versjonen er 2.108.0", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.108.0");
});

test("lagring: lagres, og svaret bærer funnene", async () => {
  test.setTimeout(120_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: tre(`Stage-test 1119 hint ${Date.now()}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst).toBe(201);
  tilstand.moduleId = modul.json.module.id;
  const lagret = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/versions`, { assessmentMode: "MCQ_ONLY", mcqSet: { title: tre("Sett"), questions: avslørende }, assessmentPolicy: policy });
  expect(lagret.status, lagret.tekst).toBe(201);
  noter("lagring: funn", lagret.json.cueWarnings);
  expect(lagret.json.cueWarnings).toEqual(expect.arrayContaining([{ code: "stem_about_course", question: 1 }, { code: "absolute_words", question: null, count: 3 }]));
});

test("kursimport: går gjennom, og funnene meldes per test — også at svaret gjentar seksjonen", async () => {
  test.setTimeout(180_000);
  const seksjon = await api("POST", "/api/admin/content/sections", { title: tre(`Stage-test 1119 seksjon ${Date.now()}`), bodyMarkdown: tre(SEKSJON) });
  expect(seksjon.status, seksjon.tekst).toBe(201);
  tilstand.sectionId = seksjon.json.section.id;
  const kurs = await api("POST", "/api/admin/content/courses", { title: tre(`Stage-test 1119 kurs ${Date.now()}`) });
  expect(kurs.status, kurs.tekst).toBe(201);
  tilstand.courseIds.push(kurs.json.course.id);
  const plass = await api("PUT", `/api/admin/content/courses/${kurs.json.course.id}/items`, { items: [{ type: "SECTION", sectionId: tilstand.sectionId }, { type: "MODULE", moduleId: tilstand.moduleId }] });
  expect(plass.status, plass.tekst).toBe(204);
  const eksport = await api("GET", `/api/admin/content/courses/${kurs.json.course.id}/export-package`);
  expect(eksport.status, eksport.tekst.slice(0, 300)).toBe(200);
  const fil = eksport.json.envelope ?? eksport.json;
  delete fil.course.course.origin;
  fil.course.course.title = tre(`Stage-test 1119 importert ${Date.now()}`);

  const importert = await api("POST", "/api/admin/content/courses/import", { payload: fil, mode: "createNew" });
  expect(importert.status, importert.tekst.slice(0, 400)).toBe(201);
  tilstand.courseIds.push(importert.json.courseId);
  tilstand.importedModuleIds.push(...(importert.json.moduleIds ?? []));
  noter("kursimport: funn", importert.json.cueWarnings);
  expect(importert.json.cueWarnings).toHaveLength(1);
  expect(importert.json.cueWarnings[0].warnings).toEqual(expect.arrayContaining([
    { code: "stem_about_course", question: 1 },
    { code: "answer_echoes_text", question: 1 },
    { code: "absolute_words", question: null, count: 3 },
  ]));
});

test.afterAll(async () => {
  for (const id of tilstand.courseIds) noter(`slett kurs`, (await api("DELETE", `/api/admin/content/courses/${id}`)).status);
  for (const id of [...tilstand.importedModuleIds, tilstand.moduleId].filter(Boolean)) {
    const slettet = await api("DELETE", `/api/admin/content/modules/${id}`);
    noter("slett modul", slettet.status);
    if (slettet.status !== 200) noter("arkiver modul", (await api("POST", `/api/admin/content/modules/${id}/archive`, {})).status);
  }
  if (tilstand.sectionId) noter("slett seksjon", (await api("DELETE", `/api/admin/content/sections/${tilstand.sectionId}`)).status);
});
