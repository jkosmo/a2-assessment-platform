// #1198 (produkteier 26.11.2026, doc/DECISIONS.md): alle produsenter kan LESE alle klasser — klassen, kursene med frister og
// deltakerne — og bare eierne (og administrator) kan endre. Samme regel som for innhold (#1165). Gjennom rutene:
//   - lesing: de tre GET-rutene gir 200 for en annen produsent, og detaljen sier `canManage: false` (eier og admin: true);
//   - skriving: HVER skrivevei gir 403 for den andre produsenten og skriver ingenting; eieren som kontroll;
//   - systemklassen «Alle deltakere»: produsenten leser den, bare administrator kan endre (`canManage`);
//   - en deltaker kommer ikke inn (admin-content-ruterens rollevakt).
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const C = "/api/admin/content";
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 300);
const person = (id: string, role: string, ip: string) => ({
  "x-user-id": `${id}-${RUN}`,
  "x-user-email": `${id}.${RUN}@x.test`,
  "x-user-name": id,
  "x-user-roles": role,
  "x-forwarded-for": ip,
});
const OWNER = person("1198-eier", "SUBJECT_MATTER_OWNER", "10.119.8.1");
const OTHER = person("1198-annen", "SUBJECT_MATTER_OWNER", "10.119.8.2");
const ADMIN = person("1198-admin", "ADMINISTRATOR", "10.119.8.3");
const LEARNER = person("1198-deltaker", "PARTICIPANT", "10.119.8.4");
const SYSTEM = "cls_all_participants";

let classId = "";
let courseId = "";
let otherCourseId = "";
let memberUserId = "";

beforeAll(async () => {
  const created = await request(app).post(`${C}/classes`).set(OWNER).send({ name: `1198 klasse ${RUN}` });
  expect(created.status, show(created)).toBe(201);
  classId = created.body.class.id;
  const title = (text: string) => JSON.stringify({ nb: text, nn: text, "en-GB": text });
  courseId = (await prisma.course.create({ data: { title: title(`1198 kurs ${RUN}`), enrollmentPolicy: "RESTRICTED", publishedAt: new Date() }, select: { id: true } })).id;
  otherCourseId = (await prisma.course.create({ data: { title: title(`1198 kurs 2 ${RUN}`), enrollmentPolicy: "RESTRICTED", publishedAt: new Date() }, select: { id: true } })).id;
  // Deltakeren finnes som bruker når hen har vært innom en gang.
  await request(app).get("/api/courses").set(LEARNER);
  memberUserId = (await prisma.user.findUniqueOrThrow({ where: { externalId: `1198-deltaker-${RUN}` }, select: { id: true } })).id;
  expect((await request(app).post(`${C}/classes/${classId}/members`).set(OWNER).send({ userId: memberUserId })).status).toBe(201);
  const assigned = await request(app).post(`${C}/classes/${classId}/courses`).set(OWNER).send({ courseId, dueAt: "2027-01-15T00:00:00.000Z" });
  expect(assigned.status, show(assigned)).toBe(201);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("#1198 — produsenter leser alle klasser, bare eierne endrer", () => {
  it("en annen produsent leser klassen, kursene med frister og deltakerne; detaljen sier canManage: false", async () => {
    const detail = await request(app).get(`${C}/classes/${classId}`).set(OTHER);
    expect(detail.status, show(detail)).toBe(200);
    expect(detail.body.class).toMatchObject({ id: classId, canManage: false });

    const courses = await request(app).get(`${C}/classes/${classId}/courses`).set(OTHER);
    expect(courses.status, show(courses)).toBe(200);
    expect(courses.body.courses).toEqual([expect.objectContaining({ courseId, dueAt: "2027-01-15T00:00:00.000Z" })]);

    const members = await request(app).get(`${C}/classes/${classId}/members`).set(OTHER);
    expect(members.status, show(members)).toBe(200);
    expect(members.body.members).toEqual([expect.objectContaining({ userId: memberUserId, email: `1198-deltaker.${RUN}@x.test` })]);
  });

  it("kontroll: eieren og administrator får canManage: true", async () => {
    expect((await request(app).get(`${C}/classes/${classId}`).set(OWNER)).body.class.canManage).toBe(true);
    expect((await request(app).get(`${C}/classes/${classId}`).set(ADMIN)).body.class.canManage).toBe(true);
  });

  it("hver skrivevei gir 403 for en annen produsent, og ingenting endres", async () => {
    const before = await prisma.class.findUniqueOrThrow({ where: { id: classId }, select: { name: true, archivedAt: true } });
    const writes: Array<[string, () => request.Test]> = [
      ["PATCH klassen", () => request(app).patch(`${C}/classes/${classId}`).set(OTHER).send({ name: "Kapret" })],
      ["arkiver", () => request(app).post(`${C}/classes/${classId}/archive`).set(OTHER)],
      ["gjenopprett", () => request(app).post(`${C}/classes/${classId}/restore`).set(OTHER)],
      ["slett", () => request(app).delete(`${C}/classes/${classId}`).set(OTHER)],
      ["legg til deltaker", () => request(app).post(`${C}/classes/${classId}/members`).set(OTHER).send({ userId: memberUserId })],
      ["ta bort deltaker", () => request(app).delete(`${C}/classes/${classId}/members/${memberUserId}`).set(OTHER)],
      ["tildel kurs", () => request(app).post(`${C}/classes/${classId}/courses`).set(OTHER).send({ courseId: otherCourseId })],
      ["endre frist", () => request(app).post(`${C}/classes/${classId}/courses`).set(OTHER).send({ courseId, dueAt: "2027-06-01T00:00:00.000Z" })],
      ["ta bort kurs", () => request(app).delete(`${C}/classes/${classId}/courses/${courseId}`).set(OTHER)],
    ];
    for (const [name, send] of writes) {
      const res = await send();
      expect(res.status, `${name}: ${show(res)}`).toBe(403);
    }
    expect(await prisma.class.findUniqueOrThrow({ where: { id: classId }, select: { name: true, archivedAt: true } })).toEqual(before);
    expect(await prisma.classMember.count({ where: { classId } })).toBe(1);
    const assignments = await prisma.courseGroupAssignment.findMany({ where: { classId }, select: { courseId: true, dueAt: true } });
    expect(assignments).toEqual([{ courseId, dueAt: new Date("2027-01-15T00:00:00.000Z") }]);
  });

  it("kontroll: eieren kan endre klassen", async () => {
    const res = await request(app).patch(`${C}/classes/${classId}`).set(OWNER).send({ description: "Endret av eieren" });
    expect(res.status, show(res)).toBe(200);
  });

  it("systemklassen «Alle deltakere»: produsenten leser den, bare administrator kan endre", async () => {
    const asProducer = await request(app).get(`${C}/classes/${SYSTEM}`).set(OTHER);
    expect(asProducer.status, show(asProducer)).toBe(200);
    expect(asProducer.body.class).toMatchObject({ id: SYSTEM, isSystem: true, canManage: false });
    expect((await request(app).get(`${C}/classes/${SYSTEM}/courses`).set(OTHER)).status).toBe(200);
    expect((await request(app).get(`${C}/classes/${SYSTEM}`).set(ADMIN)).body.class.canManage).toBe(true);
    expect((await request(app).post(`${C}/classes/${SYSTEM}/courses`).set(OTHER).send({ courseId: otherCourseId })).status).toBe(403);
  });

  it("en deltaker kommer ikke inn i klassene", async () => {
    for (const path of [`${C}/classes/${classId}`, `${C}/classes/${classId}/members`, `${C}/classes/${classId}/courses`]) {
      expect((await request(app).get(path).set(LEARNER)).status, path).toBe(403);
    }
  });

  it("en klasse som ikke finnes, gir 404 (som før vakta ble tatt bort)", async () => {
    expect((await request(app).get(`${C}/classes/finnes-ikke-${RUN}`).set(OTHER)).status).toBe(404);
  });
});
