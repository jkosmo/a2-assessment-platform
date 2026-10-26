// #1119: skillets hint-kontroll kjøres av plattformen på veiene inn — kursimport, modulimport og
// lagring i redigeringsverktøyet — og gir VARSEL, ikke stopp. Gjennom rutene, slik klienten kaller dem.
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";

const admin = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin" };
const tre = (nb: string) => ({ nb, nn: nb, "en-GB": nb });
const stempel = Date.now();
const SEKSJON = "Før møtet bør du legge bakgrunnsdokumentene i et prosjekt slik at kildene er tilgjengelige i alle samtalene hele tiden.";

const sp = (stem: string, options: string[], correct = 0) => ({ stem: tre(stem), options: options.map(tre), correctAnswer: tre(options[correct]!), rationale: tre("Fordi.") });
// Spørsmål 1 spør hva kurset sier og gjentar seksjonen; 2–4 har «automatisk», «alltid», «aldri» bare blant de gale.
const avslørende = [
  sp("Hvorfor anbefaler kurset et prosjekt?", ["Kildene er tilgjengelige i alle samtalene hele tiden", "Prosjekter er raskere å åpne", "Det gir penere formatering"]),
  sp("Hva gjør du med utkastet fra KI?", ["Leser gjennom og retter før det sendes", "Lar KI sende det automatisk", "Sender det til alle i firmaet"]),
  sp("Hvem eier innholdet i rapporten?", ["Den som leverer den til kunden", "KI-verktøyet, alltid", "Leverandøren av verktøyet"]),
  sp("Når kan du bruke kundedata i en chat?", ["Når avtalen og verktøyet tillater det", "Aldri, under noen omstendighet", "Når kunden har sagt ja muntlig"]),
];
const rene = [
  sp("En kollega vil sende et KI-utkast til kunden. Hva gjør du?", ["Leser og retter før det sendes", "Sender det slik det står nå", "Ber KI skrive det helt på nytt"]),
  sp("Hvem eier innholdet i rapporten?", ["Den som leverer den til kunden", "Den som skrev selve prompten", "Leverandøren av KI-verktøyet"]),
  sp("Hva bør ligge i prosjektet?", ["Mandatet og kildene", "Bare den siste chatten", "Kundens passord"]),
];

async function post(path: string, body: object) {
  const r = await request(app).post(path).set(admin).send(body);
  expect(r.status, `${path}: ${JSON.stringify(r.body).slice(0, 300)}`).toBeLessThan(300);
  return r.body;
}

async function publisertModul(tittel: string) {
  const modul = await post("/api/admin/content/modules", { title: tre(tittel), description: tre("Beskrivelse"), certificationLevel: "basic" });
  const moduleId = modul.module.id as string;
  const rubric = await post(`/api/admin/content/modules/${moduleId}/rubric-versions`, { criteria: { relevance: "0-4", quality: "0-4" }, scalingRule: { practical_weight: 70, max_total: 20 } });
  const prompt = await post(`/api/admin/content/modules/${moduleId}/prompt-template-versions`, { systemPrompt: tre("Sys"), userPromptTemplate: tre("Eval"), examples: [{ note: "fixture" }] });
  const mcq = await post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`, { title: tre("MCQ"), questions: rene });
  const versjon = await post(`/api/admin/content/modules/${moduleId}/module-versions`, {
    taskText: tre("Reflekter"),
    assessorExpectedContent: tre("Nevn QA"),
    rubricVersionId: rubric.rubricVersion.id,
    promptTemplateVersionId: prompt.promptTemplateVersion.id,
    mcqSetVersionId: mcq.mcqSetVersion.id,
  });
  await post(`/api/admin/content/modules/${moduleId}/module-versions/${versjon.moduleVersion.id}/publish`, {});
  return moduleId;
}

describe("#1119 varsel om spørsmål der svaret kan røpe seg", () => {
  let moduleId: string;
  let kursEksport: any;
  let modulEksport: any;

  beforeAll(async () => {
    const s = await post("/api/admin/content/sections", { title: tre(`Prosjekter ${stempel}`), bodyMarkdown: tre(SEKSJON) });
    await post(`/api/admin/content/sections/${s.section.id}/publish`, {});
    moduleId = await publisertModul(`Hinttest ${stempel}`);
    const kurs = await post("/api/admin/content/courses", { title: tre(`Hintkurs ${stempel}`) });
    const plass = await request(app).put(`/api/admin/content/courses/${kurs.course.id}/items`).set(admin).send({ items: [{ type: "SECTION", sectionId: s.section.id }, { type: "MODULE", moduleId }] });
    expect(plass.status).toBe(204);
    const ut = await request(app).get(`/api/admin/content/courses/${kurs.course.id}/export-package`).set(admin);
    expect(ut.status, JSON.stringify(ut.body).slice(0, 300)).toBe(200);
    kursEksport = ut.body.envelope ?? ut.body;
    const mut = await request(app).get(`/api/admin/content/modules/${moduleId}/export-package`).set(admin);
    expect(mut.status, JSON.stringify(mut.body).slice(0, 300)).toBe(200);
    modulEksport = mut.body.envelope ?? mut.body;
  });

  const medSpørsmål = (env: any, spørsmål: object[], hvor: (e: any) => any) => {
    const kopi = JSON.parse(JSON.stringify(env));
    hvor(kopi).activeVersion.mcqSet.questions = spørsmål;
    return kopi;
  };
  const iKurs = (e: any) => e.course.course.items.find((i: any) => i.type === "MODULE").module;

  it("kursimport: testen med funn meldes med tittel og hvert funn — med seksjonen før den som lesestoff; importen går gjennom", async () => {
    const svar = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: medSpørsmål(kursEksport, avslørende, iKurs), mode: "createNew" });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 400)).toBe(201);
    expect(svar.body.cueWarnings).toHaveLength(1);
    expect(svar.body.cueWarnings[0].title).toMatchObject({ nb: `Hinttest ${stempel}` });
    expect(svar.body.cueWarnings[0].warnings).toEqual(expect.arrayContaining([
      { code: "stem_about_course", question: 1 },
      { code: "answer_echoes_text", question: 1 },
      { code: "absolute_words", question: null, count: 3 },
    ]));
  });

  it("kursimport uten funn: tom liste", async () => {
    const svar = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: medSpørsmål(kursEksport, rene, iKurs), mode: "createNew" });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 400)).toBe(201);
    expect(svar.body.cueWarnings).toEqual([]);
  });

  it("modulimport: funnene som en flat liste (ingen seksjoner i en modulpakke, så ingen ekko-regel)", async () => {
    const svar = await request(app).post("/api/admin/content/modules/import").set(admin).send({ payload: medSpørsmål(modulEksport, avslørende, (e) => e.module), mode: "createNew", autoPublish: false });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 400)).toBe(201);
    const koder = (svar.body.cueWarnings as Array<{ code: string }>).map((w) => w.code);
    expect(koder).toEqual(expect.arrayContaining(["stem_about_course", "absolute_words"]));
    expect(koder).not.toContain("answer_echoes_text");
  });

  it("lagring i redigeringsverktøyet: lagres, og svaret bærer funnene", async () => {
    const svar = await request(app).post(`/api/admin/content/modules/${moduleId}/versions`).set(admin).send({
      assessmentMode: "MCQ_ONLY",
      mcqSet: { title: tre("MCQ"), questions: avslørende },
    });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 400)).toBe(201);
    expect(svar.body.moduleVersion?.id).toBeTruthy();
    expect(svar.body.cueWarnings).toEqual(expect.arrayContaining([{ code: "stem_about_course", question: 1 }, { code: "absolute_words", question: null, count: 3 }]));
  });

  it("lagring av en ren test gir ingen funn", async () => {
    const ren = await request(app).post(`/api/admin/content/modules/${moduleId}/versions`).set(admin).send({
      assessmentMode: "MCQ_ONLY",
      mcqSet: { title: tre("MCQ"), questions: rene },
    });
    expect(ren.status, JSON.stringify(ren.body).slice(0, 400)).toBe(201);
    expect(ren.body.cueWarnings).toEqual([]);
    expect(ren.body.rubricWarnings).toEqual([]);
  });
});

// #1122: kriterier med én linje for hele skalaen — samme deling: varsel på plattformen, stopp i skillet.
// Testmodulens kriterier er «0-4» uten beskrivelse, slik 55 av 74 kriterier på stage var.
describe("#1122 varsel om kriterier som ikke beskriver skalaen", () => {
  let moduleId: string;
  let kursEksport: any;
  const beskrevet = { relevance: "0–2: 0 = ikke relevant; 1 = delvis; 2 = treffer oppgaven", quality: "0–2: 0 = uklart; 1 = forståelig; 2 = presist" };

  beforeAll(async () => {
    moduleId = await publisertModul(`Kriterietest ${stempel}`);
    const kurs = await post("/api/admin/content/courses", { title: tre(`Kriteriekurs ${stempel}`) });
    const plass = await request(app).put(`/api/admin/content/courses/${kurs.course.id}/items`).set(admin).send({ items: [{ type: "MODULE", moduleId }] });
    expect(plass.status).toBe(204);
    const ut = await request(app).get(`/api/admin/content/courses/${kurs.course.id}/export-package`).set(admin);
    expect(ut.status, JSON.stringify(ut.body).slice(0, 300)).toBe(200);
    kursEksport = ut.body.envelope ?? ut.body;
  });

  it("kursimport: modulen meldes med tittel og hvert kriterium; importen går gjennom", async () => {
    const svar = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: kursEksport, mode: "createNew" });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 400)).toBe(201);
    expect(svar.body.rubricWarnings).toEqual([{ title: expect.objectContaining({ nb: `Kriterietest ${stempel}` }), warnings: [{ code: "scale_not_described", criterion: "relevance" }, { code: "scale_not_described", criterion: "quality" }] }]);
  });

  it("modulimport: kriteriene som en flat liste", async () => {
    const mut = await request(app).get(`/api/admin/content/modules/${moduleId}/export-package`).set(admin);
    const svar = await request(app).post("/api/admin/content/modules/import").set(admin).send({ payload: mut.body.envelope ?? mut.body, mode: "createNew", autoPublish: false });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 400)).toBe(201);
    expect((svar.body.rubricWarnings as Array<{ criterion: string }>).map((w) => w.criterion)).toEqual(["relevance", "quality"]);
  });

  it("ny rubrikkversjon: funn for én linje, ingen for beskrevne trinn", async () => {
    const svak = await post(`/api/admin/content/modules/${moduleId}/rubric-versions`, { criteria: { relevance: "0-4: Relevant." }, scalingRule: { practical_weight: 70, max_total: 4 } });
    expect(svak.rubricWarnings).toEqual([{ code: "scale_not_described", criterion: "relevance" }]);
    const god = await post(`/api/admin/content/modules/${moduleId}/rubric-versions`, { criteria: beskrevet, scalingRule: { practical_weight: 70, max_total: 4 } });
    expect(god.rubricWarnings).toEqual([]);
  });

  it("ny rubrikk laget av plattformen (ensure) får varselet; en gjenbrukt får det ikke", async () => {
    const body = { taskText: "Reflekter over saken.", assessorExpectedContent: "Nevner QA.", certificationLevel: "basic", locale: "nb" };
    const ny = await request(app).post(`/api/admin/content/modules/${moduleId}/rubric-versions/ensure`).set(admin).send({ ...body, force: true });
    expect(ny.status, JSON.stringify(ny.body).slice(0, 400)).toBe(201);
    const navn = Object.keys(ny.body.criteria);
    expect(navn.length).toBeGreaterThan(0);
    // Hvert kriterium uten beskrevne trinn meldes — i testmiljøet standardrubrikken, som bare har vekter.
    if (!ny.body.autoGenerated) expect((ny.body.rubricWarnings as Array<{ criterion: string }>).map((w) => w.criterion)).toEqual(navn);
    const gjenbrukt = await request(app).post(`/api/admin/content/modules/${moduleId}/rubric-versions/ensure`).set(admin).send(body);
    expect(gjenbrukt.status).toBe(200);
    expect(gjenbrukt.body.rubricWarnings).toEqual([]);
  });

  it("lagring i redigeringsverktøyet med kriteriene i samme lagring: svaret bærer funnene", async () => {
    const svar = await request(app).post(`/api/admin/content/modules/${moduleId}/versions`).set(admin).send({
      assessmentMode: "FREETEXT_ONLY",
      taskText: tre("Reflekter over saken."),
      assessorExpectedContent: tre("Nevner QA."),
      rubric: { criteria: { relevance: "0-4: Relevant.", quality: beskrevet.quality }, scalingRule: { practical_weight: 100, max_total: 6 } },
      promptTemplate: { systemPrompt: tre("Sys"), userPromptTemplate: tre("Eval") },
    });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 400)).toBe(201);
    expect(svar.body.rubricWarnings).toEqual([{ code: "scale_not_described", criterion: "relevance" }]);
  });
});
