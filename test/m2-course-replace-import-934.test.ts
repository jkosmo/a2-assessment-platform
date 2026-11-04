// #934 skive 3 (produkteier 2026-11-02): import med `replaceExisting` bytter ut alt innholdet i et kurs. Har
// noen kursbevis for kursets nåværende hovedversjon, kreves et svar — mindre eller hovedversjon, som i
// dialogen — og uten svar avvises importen før noe skrives. Uten kursbevis: som før. Gjennom ruta.
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { readSection } from "./support/participantFlow.js";

const admin = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin" };
const tre = (nb: string) => ({ nb, nn: nb, "en-GB": nb });

async function seksjon(tittel: string) {
  const r = await request(app).post("/api/admin/content/sections").set(admin).send({ title: tre(tittel), bodyMarkdown: tre(`Tekst ${tittel}.`) });
  expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
  const id = r.body.section.id as string;
  expect((await request(app).post(`/api/admin/content/sections/${id}/publish`).set(admin)).status).toBe(200);
  return id;
}

/** Et publisert lesekurs med én seksjon, og (valgfritt) en deltaker som har lest den og fått kursbevis. */
async function kurs(tag: string, medBevis: boolean) {
  const stempel = `${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const s = await seksjon(`934 erstatt ${stempel}`);
  const opprettet = await request(app).post("/api/admin/content/courses").set(admin).send({ title: tre(`934 erstatt ${stempel}`) });
  expect(opprettet.status).toBe(201);
  const courseId = opprettet.body.course.id as string;
  expect((await request(app).put(`/api/admin/content/courses/${courseId}/items`).set(admin).send({ items: [{ type: "SECTION", sectionId: s }] })).status).toBe(204);
  expect((await request(app).post(`/api/admin/content/courses/${courseId}/publish`).set(admin)).status).toBe(200);
  if (medBevis) {
    const deltaker = { "x-user-id": `v934-erstatt-${stempel}`, "x-user-email": `v934.erstatt.${stempel}@company.com`, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT" };
    expect((await readSection(app, deltaker, courseId, s)).status).toBe(204);
    await request(app).get("/api/courses/completions").set(deltaker);
    expect(await prisma.courseCompletion.count({ where: { courseId } })).toBe(1);
  }
  const ut = await request(app).get(`/api/admin/content/courses/${courseId}/export-package`).set(admin);
  expect(ut.status, JSON.stringify(ut.body).slice(0, 300)).toBe(200);
  const fil = JSON.parse(JSON.stringify(ut.body.envelope ?? ut.body));
  return { courseId, fil };
}

const versjon = (courseId: string) =>
  prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { versionMajor: true, versionMinor: true } });

describe("#934 skive 3 — replaceExisting på et kurs med kursbevis krever et versjonssvar", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uten svar avvises importen, og ingenting skrives", async () => {
    const { courseId, fil } = await kurs("uten", true);
    const før = await prisma.courseItem.findMany({ where: { courseId }, select: { sectionId: true } });
    const svar = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fil, mode: "replaceExisting", targetId: courseId });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 300)).toBe(400);
    expect(svar.body.error).toBe("course_version_required");
    expect(await prisma.courseItem.findMany({ where: { courseId }, select: { sectionId: true } })).toEqual(før);
    expect(await versjon(courseId)).toEqual({ versionMajor: 1, versionMinor: 0 });
  });

  it("med svaret «major» blir kurset 2.0; med «minor» 1.1", async () => {
    const hoved = await kurs("hoved", true);
    const a = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: hoved.fil, mode: "replaceExisting", targetId: hoved.courseId, version: "major" });
    expect(a.status, JSON.stringify(a.body).slice(0, 300)).toBe(201);
    expect(await versjon(hoved.courseId)).toEqual({ versionMajor: 2, versionMinor: 0 });

    const mindre = await kurs("mindre", true);
    const b = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: mindre.fil, mode: "replaceExisting", targetId: mindre.courseId, version: "minor" });
    expect(b.status, JSON.stringify(b.body).slice(0, 300)).toBe(201);
    expect(await versjon(mindre.courseId)).toEqual({ versionMajor: 1, versionMinor: 1 });
  });

  it("uten kursbevis: som før — ingen svar kreves", async () => {
    const { courseId, fil } = await kurs("ingen", false);
    const svar = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fil, mode: "replaceExisting", targetId: courseId });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 300)).toBe(201);
    expect(await versjon(courseId)).toEqual({ versionMajor: 1, versionMinor: 1 });
  });
});
