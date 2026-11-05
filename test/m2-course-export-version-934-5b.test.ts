// #934 skive 5b, gjennom rutene: kurseksporten har `versionMajor` og `versionMinor` som opplysning, og importen leser dem ikke. Modullistene
// har nummeret, og `versionNo` står som før. Rundturen er uendret: en fil med et annet nummer endrer ingenting.
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const admin = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin" };
const tre = (nb: string) => ({ nb, nn: nb, "en-GB": nb });

async function seksjon(tittel: string) {
  const r = await request(app).post("/api/admin/content/sections").set(admin).send({ title: tre(tittel), bodyMarkdown: tre(`Tekst ${tittel}.`) });
  expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
  const id = r.body.section.id as string;
  expect((await request(app).post(`/api/admin/content/sections/${id}/publish`).set(admin)).status).toBe(200);
  return id;
}

async function kurs(tag: string) {
  const stempel = `${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const s = await seksjon(`934 5b ${stempel}`);
  const opprettet = await request(app).post("/api/admin/content/courses").set(admin).send({ title: tre(`934 5b ${stempel}`) });
  expect(opprettet.status).toBe(201);
  const courseId = opprettet.body.course.id as string;
  expect((await request(app).put(`/api/admin/content/courses/${courseId}/items`).set(admin).send({ items: [{ type: "SECTION", sectionId: s }] })).status).toBe(204);
  expect((await request(app).post(`/api/admin/content/courses/${courseId}/publish`).set(admin)).status).toBe(200);
  return courseId;
}

async function eksport(courseId: string) {
  const ut = await request(app).get(`/api/admin/content/courses/${courseId}/export-package`).set(admin);
  expect(ut.status, JSON.stringify(ut.body).slice(0, 300)).toBe(200);
  return JSON.parse(JSON.stringify(ut.body.envelope ?? ut.body));
}

const versjon = (courseId: string) =>
  prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { versionMajor: true, versionMinor: true } });

async function modulMedVersjon(tag: string) {
  const stempel = `${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const modul = await request(app).post("/api/admin/content/modules").set(admin).send({ title: tre(`934 5b modul ${stempel}`), certificationLevel: "basic" });
  expect(modul.status, JSON.stringify(modul.body).slice(0, 300)).toBe(201);
  const moduleId = modul.body.module.id as string;
  const sett = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`).set(admin).send({
    title: tre("Sett"),
    questions: [{ stem: tre("Hva er riktig?"), options: [tre("Riktig"), tre("Galt")], correctAnswer: tre("Riktig"), rationale: tre("Fordi.") }],
  });
  expect(sett.status, JSON.stringify(sett.body).slice(0, 300)).toBe(201);
  const versjonRad = await request(app).post(`/api/admin/content/modules/${moduleId}/module-versions`).set(admin).send({
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: sett.body.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 }, mcq: { reviewAfterSubmit: true, shuffleQuestions: false } },
  });
  expect(versjonRad.status, JSON.stringify(versjonRad.body).slice(0, 300)).toBe(201);
  const moduleVersionId = versjonRad.body.moduleVersion.id as string;
  const publisert = await request(app).post(`/api/admin/content/modules/${moduleId}/module-versions/${moduleVersionId}/publish`).set(admin).send({});
  expect(publisert.status, JSON.stringify(publisert.body).slice(0, 300)).toBe(200);
  return { moduleId, moduleVersionId, versionNo: publisert.body.moduleVersion.versionNo as number };
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("#934 skive 5b — kurseksporten", () => {
  it("har versjonen kurset står på", async () => {
    const courseId = await kurs("eksport");
    const fil = await eksport(courseId);
    expect(fil.course.course).toMatchObject({ versionMajor: 1, versionMinor: 0 });
  });

  it("en fil med et annet nummer, importert som nytt kurs: det nye kurset starter på 1.0, som før", async () => {
    const courseId = await kurs("nytt");
    const fil = await eksport(courseId);
    fil.course.course.versionMajor = 7;
    fil.course.course.versionMinor = 9;
    const inn = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fil, mode: "createNew" });
    expect(inn.status, JSON.stringify(inn.body).slice(0, 400)).toBe(201);
    const nyttId = inn.body.courseId as string;
    expect(nyttId).toBeTruthy();
    expect(nyttId).not.toBe(courseId);
    expect(await versjon(nyttId)).toEqual({ versionMajor: 1, versionMinor: 0 });
    expect(await versjon(courseId)).toEqual({ versionMajor: 1, versionMinor: 0 });
  });

  it("rundturen er uendret: filen med og uten feltene gir samme kurs", async () => {
    const courseId = await kurs("rundtur");
    const fil = await eksport(courseId);
    const utenFeltene = JSON.parse(JSON.stringify(fil));
    delete utenFeltene.course.course.versionMajor;
    delete utenFeltene.course.course.versionMinor;

    const med = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fil, mode: "createNew" });
    const uten = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: utenFeltene, mode: "createNew" });
    expect(med.status, JSON.stringify(med.body).slice(0, 400)).toBe(201);
    expect(uten.status, JSON.stringify(uten.body).slice(0, 400)).toBe(201);
    const les = async (id: string) => {
      const rad = await prisma.course.findUniqueOrThrow({ where: { id }, select: { title: true, versionMajor: true, versionMinor: true, publishedAt: true } });
      return { title: rad.title, versionMajor: rad.versionMajor, versionMinor: rad.versionMinor, published: rad.publishedAt !== null, items: await prisma.courseItem.count({ where: { courseId: id } }) };
    };
    expect(await les(med.body.courseId as string)).toEqual(await les(uten.body.courseId as string));
  });

  it("en oppdatering av det samme kurset fra en fil med et annet nummer: versjonen følger reglene, ikke fila", async () => {
    const courseId = await kurs("erstatt");
    const fil = await eksport(courseId);
    fil.course.course.versionMajor = 7;
    fil.course.course.versionMinor = 9;
    const inn = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fil, mode: "replaceExisting", targetId: courseId });
    expect(inn.status, JSON.stringify(inn.body).slice(0, 400)).toBe(201);
    expect(await versjon(courseId)).toEqual({ versionMajor: 1, versionMinor: 1 });
  });
});

describe("#934 skive 5b — modullistene har nummeret", () => {
  it("forfatterens liste, modulens side og deltakerens liste: nummeret, og `versionNo` som før", async () => {
    const { moduleId, moduleVersionId, versionNo } = await modulMedVersjon("lister");

    const bibliotek = await request(app).get("/api/admin/content/modules/library").set(admin);
    const rad = (bibliotek.body.modules as Array<Record<string, unknown>>).find((module) => module.id === moduleId);
    expect(rad).toMatchObject({ activeVersionNo: versionNo, activeVersionMajor: 1, activeVersionMinor: 0 });

    const eksportert = await request(app).get(`/api/admin/content/modules/${moduleId}/export`).set(admin);
    expect(eksportert.status, JSON.stringify(eksportert.body).slice(0, 300)).toBe(200);
    const versjoner = eksportert.body.moduleExport.versions.moduleVersions as Array<Record<string, unknown>>;
    expect(versjoner.find((version) => version.id === moduleVersionId)).toMatchObject({ versionNo, versionMajor: 1, versionMinor: 0 });

    const deltaker = await request(app).get(`/api/modules/${moduleId}`).set(admin);
    expect(deltaker.status, JSON.stringify(deltaker.body).slice(0, 300)).toBe(200);
    expect(deltaker.body.module.activeVersion).toMatchObject({ versionNo, versionMajor: 1, versionMinor: 0 });
  });
});
