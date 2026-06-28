import request from "supertest";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { env } from "../src/config/env.js";

// #495-follow-up (PARTICIPANT_COURSE_ONLY): deltakere kan kun levere på moduler som ligger i et
// publisert kurs de har tilgang til. Modul via course player passerer; frittstående blokkeres.
// SMO/ADMIN er unntatt. Gaten kjører FØR module-validering, så de fleste casene trenger ikke en
// fullt publisert modul.

const ts = Date.now();
const idPrefix = `courseonly-${ts}`;
const originalFlag = env.PARTICIPANT_COURSE_ONLY;

function headers(suffix: string, roles: string) {
  return {
    "x-user-id": `${idPrefix}-${suffix}`,
    "x-user-email": `${idPrefix}-${suffix}@example.com`,
    "x-user-name": `User ${suffix}`,
    "x-user-roles": roles,
  };
}
const participant = headers("p", "PARTICIPANT");
const smo = headers("smo", "SUBJECT_MATTER_OWNER");

const createdCourseIds: string[] = [];
const createdModuleIds: string[] = [];

describe("Participant course-only gate (#495-follow-up)", () => {
  afterEach(() => {
    env.PARTICIPANT_COURSE_ONLY = originalFlag;
  });
  afterAll(async () => {
    await prisma.courseItem.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
    await prisma.module.deleteMany({ where: { id: { in: createdModuleIds } } });
    await prisma.user.deleteMany({ where: { externalId: { startsWith: idPrefix } } });
    await prisma.$disconnect();
  });

  it("flagg på: deltaker blokkeres fra frittstående modul (403 course_required)", async () => {
    env.PARTICIPANT_COURSE_ONLY = true;
    const res = await request(app)
      .post("/api/submissions")
      .set(participant)
      .send({ moduleId: `${idPrefix}-orphan-module`, deliveryType: "text", responseJson: {} });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("course_required");
  });

  it("flagg på: deltaker slipper gaten når modulen ligger i et tilgjengelig kurs", async () => {
    env.PARTICIPANT_COURSE_ONLY = true;
    const module = await prisma.module.create({ data: { title: "Gate-modul" }, select: { id: true } });
    createdModuleIds.push(module.id);
    const course = await prisma.course.create({
      data: { title: JSON.stringify({ "en-GB": "C", nb: "C", nn: "C" }), publishedAt: new Date() },
      select: { id: true },
    });
    createdCourseIds.push(course.id);
    await prisma.courseItem.create({ data: { courseId: course.id, moduleId: module.id, itemType: "MODULE", sortOrder: 0 } });

    const res = await request(app)
      .post("/api/submissions")
      .set(participant)
      .send({ moduleId: module.id, deliveryType: "text", responseJson: {} });
    // Gaten passerer; createSubmission feiler senere (ingen aktiv versjon) — men IKKE med 403/course_required.
    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe("course_required");
  });

  it("flagg på: SMO er unntatt gaten (frittstående modul gir ikke course_required)", async () => {
    env.PARTICIPANT_COURSE_ONLY = true;
    const res = await request(app)
      .post("/api/submissions")
      .set(smo)
      .send({ moduleId: `${idPrefix}-orphan-2`, deliveryType: "text", responseJson: {} });
    expect(res.body.error).not.toBe("course_required");
  });

  it("flagg av: deltaker blokkeres ikke (frittstående tillatt igjen)", async () => {
    env.PARTICIPANT_COURSE_ONLY = false;
    const res = await request(app)
      .post("/api/submissions")
      .set(participant)
      .send({ moduleId: `${idPrefix}-orphan-3`, deliveryType: "text", responseJson: {} });
    expect(res.body.error).not.toBe("course_required");
  });
});
