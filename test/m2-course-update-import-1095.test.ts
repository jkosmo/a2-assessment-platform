// #1095: et publisert kurs eksporteres med identiteter, justeres i fila, og importeres som en
// OPPDATERING av det samme kurset: eksisterende elementer får en ny, upublisert versjon, nye
// opprettes som utkast, fjernede tas ut av kurset — og kursets id, publisering, klassetildeling
// og deltakernes framdrift er urørt. Produkteier: «det bør en bevisst handling til for å publisere».
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const admin = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin" };
const deltaker = { "x-user-id": "deltaker-1095", "x-user-email": "deltaker1095@company.com", "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT" };
const tre = (nb: string) => ({ nb, nn: nb, "en-GB": nb });
const stempel = Date.now();

// En publisert modul laget gjennom API-et, slik eksporten krever (rubrikk, prompt, flervalg, versjon).
async function publisertModul(tittel: string) {
  const post = async (path: string, body: object) => {
    const r = await request(app).post(path).set(admin).send(body);
    expect(r.status, `${path}: ${JSON.stringify(r.body).slice(0, 300)}`).toBeLessThan(300);
    return r.body;
  };
  const modul = await post("/api/admin/content/modules", { title: tre(tittel), description: tre("Beskrivelse"), certificationLevel: "basic" });
  const moduleId = modul.module.id as string;
  const rubric = await post(`/api/admin/content/modules/${moduleId}/rubric-versions`, { criteria: { relevance: "0-4", quality: "0-4" }, scalingRule: { practical_weight: 70, max_total: 20 } });
  const prompt = await post(`/api/admin/content/modules/${moduleId}/prompt-template-versions`, { systemPrompt: tre("Sys"), userPromptTemplate: tre("Eval"), examples: [{ note: "fixture" }] });
  const mcq = await post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`, { title: tre("MCQ"), questions: [{ stem: tre("Hva er 1+1?"), options: [tre("2"), tre("3")], correctAnswer: tre("2"), rationale: tre("Matte") }] });
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

async function seksjon(tittel: string, tekst: string) {
  const r = await request(app).post("/api/admin/content/sections").set(admin).send({ title: tre(tittel), bodyMarkdown: tre(tekst) });
  expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
  const id = r.body.section.id as string;
  const pub = await request(app).post(`/api/admin/content/sections/${id}/publish`).set(admin);
  expect(pub.status, JSON.stringify(pub.body).slice(0, 300)).toBe(200);
  return id;
}

describe("#1095 oppdatere et publisert kurs fra en eksportfil", () => {
  let courseId: string;
  let s1: string;
  let s2: string;
  let m1: string;
  let klasseId: string;
  let eksport: Record<string, unknown>;

  beforeAll(async () => {
    s1 = await seksjon(`Innledning ${stempel}`, "Første versjon av innledningen.");
    s2 = await seksjon(`Gammel del ${stempel}`, "Denne tas ut.");
    m1 = await publisertModul(`Test ${stempel}`);
    const opprettet = await request(app).post("/api/admin/content/courses").set(admin).send({ title: tre(`Justert kurs ${stempel}`), sortOrder: 2 });
    expect(opprettet.status).toBe(201);
    courseId = opprettet.body.course.id as string;
    const elementer = await request(app).put(`/api/admin/content/courses/${courseId}/items`).set(admin).send({ items: [{ type: "SECTION", sectionId: s1 }, { type: "SECTION", sectionId: s2 }, { type: "MODULE", moduleId: m1 }] });
    expect(elementer.status).toBe(204);
    const pub = await request(app).post(`/api/admin/content/courses/${courseId}/publish`).set(admin);
    expect(pub.status, JSON.stringify(pub.body).slice(0, 300)).toBe(200);

    // En klasse med kurset tildelt, og en deltaker som har lest første seksjon.
    const klasse = await prisma.class.create({ data: { name: `Klasse ${stempel}` }, select: { id: true } });
    klasseId = klasse.id;
    await prisma.courseGroupAssignment.create({ data: { classId: klasseId, courseId } });
    const lest = await request(app).post(`/api/courses/${courseId}/sections/${s1}/read`).set(deltaker);
    expect(lest.status).toBe(204);

    const ut = await request(app).get(`/api/admin/content/courses/${courseId}/export-package`).set(admin);
    expect(ut.status, JSON.stringify(ut.body).slice(0, 300)).toBe(200);
    eksport = (ut.body.envelope ?? ut.body) as Record<string, unknown>;
  });

  afterAll(async () => {
    await prisma.courseGroupAssignment.deleteMany({ where: { classId: klasseId } }).catch(() => undefined);
    await prisma.class.delete({ where: { id: klasseId } }).catch(() => undefined);
  });

  const kurs = () => (eksport as any).course.course;

  it("eksporten bærer identitetene: kursets id, og hvert elements id", () => {
    expect(kurs().origin).toMatchObject({ courseId });
    const items = kurs().items as Array<any>;
    expect(items.map((i) => i.origin)).toEqual([{ sectionId: s1 }, { sectionId: s2 }, { moduleId: m1 }]);
  });

  it("oppdaterer kurset: ny upublisert versjon, nytt utkast, fjernet element tatt ut — id, publisering, klasse og framdrift urørt", async () => {
    const fil = JSON.parse(JSON.stringify(eksport));
    const items = fil.course.course.items as Array<any>;
    // Justér første seksjon, ta ut den andre, legg til en ny, behold testen.
    items[0].section.bodyMarkdown = tre("Andre versjon av innledningen — justert.");
    const ny = JSON.parse(JSON.stringify(items[0]));
    delete ny.origin;
    ny.section.title = tre(`Ny del ${stempel}`);
    ny.section.bodyMarkdown = tre("Helt ny seksjon.");
    fil.course.course.items = [items[0], ny, items[2]].map((it, i) => ({ ...it, sortOrder: i }));
    fil.course.course.title = tre(`Justert kurs ${stempel} (v2)`);

    const svar = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fil, mode: "updateExisting", targetId: courseId });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 400)).toBe(201);
    expect(svar.body.courseId).toBe(courseId);
    expect(svar.body.summary).toEqual({ updatedSections: 1, updatedModules: 1, createdSections: 1, createdModules: 0, removedSections: 1, removedModules: 0 });

    // Kurset: samme id, fortsatt publisert, ny tittel, plasseringen beholdt.
    const kursRad = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { publishedAt: true, title: true, sortOrder: true } });
    expect(kursRad.publishedAt).not.toBeNull();
    expect(JSON.parse(kursRad.title).nb).toBe(`Justert kurs ${stempel} (v2)`);
    expect(kursRad.sortOrder).toBe(2);

    // Første seksjon: to versjoner, den levende er fortsatt den første.
    const s1Rad = await prisma.courseSection.findUniqueOrThrow({ where: { id: s1 }, select: { activeVersionId: true, versions: { orderBy: { versionNo: "asc" }, select: { versionNo: true, publishedAt: true, bodyMarkdown: true } } } });
    expect(s1Rad.versions).toHaveLength(2);
    expect(s1Rad.versions[1]!.publishedAt).toBeNull();
    expect(JSON.parse(s1Rad.versions[1]!.bodyMarkdown).nb).toContain("Andre versjon");
    expect(s1Rad.activeVersionId).not.toBeNull();
    const aktiv = await prisma.courseSectionVersion.findUniqueOrThrow({ where: { id: s1Rad.activeVersionId! }, select: { versionNo: true } });
    expect(aktiv.versionNo).toBe(1);

    // Testen: ny versjon, upublisert; den aktive er fortsatt v1.
    const m1Rad = await prisma.module.findUniqueOrThrow({ where: { id: m1 }, select: { activeVersionId: true, versions: { select: { versionNo: true, publishedAt: true } } } });
    expect(m1Rad.versions.map((v) => v.versionNo).sort()).toEqual([1, 2]);
    expect(m1Rad.versions.find((v) => v.versionNo === 2)!.publishedAt).toBeNull();

    // Rekkefølgen: s1, den nye (utkast), m1. Den gamle delen er ute av kurset, men finnes.
    const elementer = await prisma.courseItem.findMany({ where: { courseId }, orderBy: { sortOrder: "asc" }, select: { itemType: true, sectionId: true, moduleId: true } });
    expect(elementer.map((i) => i.itemType)).toEqual(["SECTION", "SECTION", "MODULE"]);
    expect(elementer[0]!.sectionId).toBe(s1);
    expect(elementer[2]!.moduleId).toBe(m1);
    const nySeksjon = await prisma.courseSection.findUniqueOrThrow({ where: { id: elementer[1]!.sectionId! }, select: { activeVersionId: true, archivedAt: true } });
    expect(nySeksjon.activeVersionId).toBeNull();
    expect(await prisma.courseSection.findUnique({ where: { id: s2 }, select: { archivedAt: true } })).toMatchObject({ archivedAt: null });

    // Klassen og framdriften står.
    expect(await prisma.courseGroupAssignment.count({ where: { classId: klasseId, courseId } })).toBe(1);
    // Leseraden er knyttet til brukerens interne id, ikke til identiteten i hodet.
    const bruker = await prisma.user.findUniqueOrThrow({ where: { externalId: deltaker["x-user-id"] }, select: { id: true } });
    expect(await prisma.courseSectionRead.count({ where: { courseId, sectionId: s1, userId: bruker.id } })).toBe(1);

    // Deltakeren ser kurset med den levende teksten, og den nye seksjonen er ikke tilgjengelig ennå.
    const detalj = await request(app).get(`/api/courses/${courseId}`).set(deltaker);
    expect(detalj.status).toBe(200);
    const tekst = await request(app).get(`/api/courses/${courseId}/sections/${s1}`).set(deltaker);
    expect(tekst.body.html).toContain("Første versjon");
  });

  it("en fil fra et annet kurs avvises, og uten targetId avvises forespørselen", async () => {
    const annet = await request(app).post("/api/admin/content/courses").set(admin).send({ title: tre(`Annet kurs ${stempel}`) });
    const fil = JSON.parse(JSON.stringify(eksport));
    const feil = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fil, mode: "updateExisting", targetId: annet.body.course.id });
    expect(feil.status).toBe(400);
    expect(JSON.stringify(feil.body)).toContain("different course");
    const utenMaal = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fil, mode: "updateExisting" });
    expect(utenMaal.status).toBe(400);

    // Riktig kurs, men et element som peker på en seksjon kurset ikke har: fila passer ikke.
    const fremmed = JSON.parse(JSON.stringify(eksport));
    fremmed.course.course.items[0].origin = { sectionId: s2 + "-fremmed" };
    const passerIkke = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fremmed, mode: "updateExisting", targetId: courseId });
    expect(passerIkke.status).toBe(400);
    expect(JSON.stringify(passerIkke.body)).toContain("does not match this course");
    // Ingenting ble skrevet: fortsatt én versjon til på første seksjon fra forrige test, ikke to.
    expect(await prisma.courseSectionVersion.count({ where: { sectionId: s1 } })).toBe(2);
  });

  it("en fil uten identiteter importeres som nytt kurs, som før", async () => {
    const fil = JSON.parse(JSON.stringify(eksport));
    delete fil.course.course.origin;
    for (const it of fil.course.course.items) delete it.origin;
    const svar = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fil, mode: "createNew" });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 300)).toBe(201);
    expect(svar.body.courseId).not.toBe(courseId);
    expect(svar.body.summary).toBeUndefined();
  });
});
