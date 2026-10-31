import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// 2.121.0: delingslenka til et kurs. Navnet settes første gang kurset publiseres og står fast etterpå,
// og /kurs/<navn> sender videre til «Mine kurs», som avgjør tilgangen.

const ts = Date.now();
const prefix = `share-link-${ts}`;
const owner = {
  "x-user-id": `${prefix}-owner`,
  "x-user-email": `${prefix}-owner@example.com`,
  "x-user-name": "Eier",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};
const participant = {
  "x-user-id": `${prefix}-participant`,
  "x-user-email": `${prefix}-participant@example.com`,
  "x-user-name": "Deltaker",
  "x-user-roles": "PARTICIPANT",
};

const createdCourseIds: string[] = [];
let moduleId = "";

const titleFor = (nb: string) => ({ "en-GB": `${nb} (en)`, nb, nn: nb });

async function createPublishableCourse(nb: string) {
  const created = await request(app).post("/api/admin/content/courses").set(owner).send({ title: titleFor(nb) });
  expect(created.status).toBe(201);
  const id = created.body.course.id as string;
  createdCourseIds.push(id);
  const items = await request(app).put(`/api/admin/content/courses/${id}/items`).set(owner).send({ items: [{ type: "MODULE", moduleId }] });
  expect(items.status).toBeLessThan(300);
  return id;
}

const publish = (id: string) => request(app).post(`/api/admin/content/courses/${id}/publish`).set(owner);
const slugOf = async (id: string) => (await prisma.course.findUnique({ where: { id }, select: { slug: true } }))?.slug ?? null;

describe("2.121.0 delingslenke til kurs", () => {
  beforeAll(async () => {
    const module = await prisma.module.create({ data: { title: `${prefix} modul` }, select: { id: true } });
    moduleId = module.id;
    const version = await prisma.moduleVersion.create({
      data: { moduleId, versionNo: 1, taskText: JSON.stringify({ "en-GB": "Task text long enough to be a meaningful assessment." }), publishedAt: new Date() },
      select: { id: true },
    });
    await prisma.module.update({ where: { id: moduleId }, data: { activeVersionId: version.id } });
  });

  afterAll(async () => {
    await prisma.courseItem.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.contentOwner.deleteMany({ where: { contentId: { in: createdCourseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
    await prisma.module.update({ where: { id: moduleId }, data: { activeVersionId: null } });
    await prisma.moduleVersion.deleteMany({ where: { moduleId } });
    await prisma.module.deleteMany({ where: { id: moduleId } });
    await prisma.user.deleteMany({ where: { externalId: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  it("ingen lenke før publisering; tittelen kan byttes fritt til da", async () => {
    const id = await createPublishableCourse(`Utkast ${ts}`);
    expect(await slugOf(id)).toBeNull();
    await request(app).put(`/api/admin/content/courses/${id}`).set(owner).send({ title: titleFor(`Ferdig navn ${ts}`) });
    expect(await slugOf(id)).toBeNull();
    const detail = await request(app).get(`/api/admin/content/courses/${id}`).set(owner);
    expect(detail.body.course.slug).toBeNull();

    expect((await publish(id)).status).toBe(200);
    expect(await slugOf(id)).toBe(`ferdig-navn-${ts}`);
  });

  it("lenka står fast etter navnebytte, avpublisering og ny publisering", async () => {
    const id = await createPublishableCourse(`Fast lenke ${ts}`);
    await publish(id);
    expect(await slugOf(id)).toBe(`fast-lenke-${ts}`);

    await request(app).put(`/api/admin/content/courses/${id}`).set(owner).send({ title: titleFor(`Helt nytt navn ${ts}`) });
    await request(app).post(`/api/admin/content/courses/${id}/unpublish`).set(owner);
    await publish(id);
    expect(await slugOf(id)).toBe(`fast-lenke-${ts}`);
  });

  it("samme navn på to kurs: det andre får et nummer", async () => {
    const first = await createPublishableCourse(`Tvilling ${ts}`);
    const second = await createPublishableCourse(`Tvilling ${ts}`);
    await publish(first);
    await publish(second);
    expect(await slugOf(first)).toBe(`tvilling-${ts}`);
    expect(await slugOf(second)).toBe(`tvilling-${ts}-2`);
  });

  it("lenka følger med i «Mine kurs» og i kursskjemaet", async () => {
    const id = await createPublishableCourse(`Synlig ${ts}`);
    await publish(id);
    const mine = await request(app).get("/api/courses").set(participant);
    expect(mine.status).toBe(200);
    expect(mine.body.courses.find((c: { id: string }) => c.id === id)?.slug).toBe(`synlig-${ts}`);
    const one = await request(app).get(`/api/courses/${id}`).set(participant);
    expect(one.body.course?.slug ?? one.body.slug).toBe(`synlig-${ts}`);
    const detail = await request(app).get(`/api/admin/content/courses/${id}`).set(owner);
    expect(detail.body.course.slug).toBe(`synlig-${ts}`);
  });

  it("/kurs/<navn> sender videre til «Mine kurs» uten å sjekke om kurset finnes", async () => {
    const found = await request(app).get(`/kurs/synlig-${ts}`);
    expect(found.status).toBe(302);
    expect(found.headers.location).toBe(`/participant?kurs=synlig-${ts}`);
    const unknown = await request(app).get("/kurs/finnes-ikke");
    expect(unknown.status).toBe(302);
    expect(unknown.headers.location).toBe("/participant?kurs=finnes-ikke");
    const odd = await request(app).get("/kurs/a%26b%3Dc");
    expect(odd.headers.location).toBe("/participant?kurs=a%26b%3Dc");
  });
});
