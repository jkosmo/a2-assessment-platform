import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { runCourseAssignmentEmailSchedule } from "../src/modules/course/courseAssignmentNotice.js";

// #1146 (doc/design/PLAN_1146.md, punkt 6 og 9): migreringen `…_course_assignment_notice_settled`. Testen LESER fila og kjører
// setningene én og én (kolonnen finnes alt i testdatabasen, så `ALTER TABLE` hoppes over), så den måler den ekte migreringen:
//   - `settledAt` fylles ut for rader i sluttstatus: et kurs lagt inn igjen etter `baseline` gir e-post (svar 3);
//   - `baseline` for par med kursbevis og uten rad, uten filter på person eller arkiverte klasser (planreview R2): den nye
//     regelen (kursbevis på eldre hovedversjon) gir dem ingen e-post om kurs de har hatt lenge;
//   - tidspunktene er UTC også mot en database som står på `Europe/Berlin` (planreview R3).
//
// ⚠️ Migreringen kjører over hele testdatabasen, som deles med andre testfiler (de kjører én om gangen). Setning 2 gir
// `settledAt` til andres rader i sluttstatus; setning 3 gir bare `baseline` for par uten rad.

const MIGRATION_DIR = path.join(process.cwd(), "prisma", "migrations");
function statements(): string[] {
  const dir = readdirSync(MIGRATION_DIR).filter((name) => name.endsWith("_course_assignment_notice_settled"));
  expect(dir, "migreringen finnes én gang").toHaveLength(1);
  const sql = readFileSync(path.join(MIGRATION_DIR, dir[0]!, "migration.sql"), "utf8");
  const parts = sql.split(/\r?\n;\s*(?:\r?\n|$)/).map((part) => part.split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join("\n").trim()).filter(Boolean);
  expect(parts.map((p) => p.split(/\s+/)[0])).toEqual(["ALTER", "UPDATE", "INSERT"]);
  return parts.slice(1);
}

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `settled1146 ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });
const admin = { "x-user-id": `settled1146-admin-${RUN}`, "x-user-email": `settled1146.admin.${RUN}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR" };

afterAll(async () => {
  await prisma.$disconnect();
});

async function person(extra: { activeStatus?: boolean } = {}) {
  const externalId = `settled1146-p-${RUN}-${seq++}`;
  return prisma.user.create({ data: { externalId, name: "Deltaker", email: `${externalId}@x.test`, ...extra }, select: { id: true } });
}

async function call(method: "post" | "delete", url: string, body: object = {}, expected = 200) {
  const response = await request(app)[method](url).set(admin).send(body);
  expect(response.status, `${url} ${JSON.stringify(response.body).slice(0, 300)}`).toBe(expected);
  return response;
}

const newClass = async () => (await call("post", "/api/admin/content/classes", { name: tag("klasse") }, 201)).body.class.id as string;
const addMember = (classId: string, userId: string) => call("post", `/api/admin/content/classes/${classId}/members`, { userId }, 201);
const assign = (classId: string, courseId: string) => call("post", `/api/admin/content/classes/${classId}/courses`, { courseId }, 201);
const unassign = (classId: string, courseId: string) => call("delete", `/api/admin/content/classes/${classId}/courses/${courseId}`, {}, 204);

describe("#1146 — migreringen `settledAt`", () => {
  it("fyller ut `settledAt`, gir kursbevisholdere `baseline` (UTC, også med Europe/Berlin), og et kurs lagt inn igjen etter `baseline` gir e-post", async () => {
    // Et kurs på hovedversjon 2 (ny for en time siden), og en klasse (og en arkivert klasse) som har det.
    const course = await prisma.course.create({ data: { title: L(tag("kurs")), publishedAt: new Date(), versionMajor: 2 }, select: { id: true } });
    await prisma.courseVersion.create({ data: { courseId: course.id, versionMajor: 2, publishedAt: new Date(Date.now() - 60 * 60_000), sectionVersionsJson: "{}" } });
    const [oldCertificate, oldCertificateArchived, oldCertificateLeft, noCertificate, readded, sentOne, failedOne] = [
      await person(), await person(), await person({ activeStatus: false }), await person(), await person(), await person(), await person(),
    ];
    const classId = await newClass();
    const archivedClassId = await newClass();
    for (const u of [oldCertificate, oldCertificateLeft, noCertificate, readded, sentOne, failedOne]) await addMember(classId, u.id);
    await addMember(archivedClassId, oldCertificateArchived.id);
    await assign(classId, course.id);
    await assign(archivedClassId, course.id);
    await call("post", `/api/admin/content/classes/${archivedClassId}/archive`);
    for (const u of [oldCertificate, oldCertificateArchived, oldCertificateLeft]) {
      await prisma.courseCompletion.create({ data: { userId: u.id, courseId: course.id, versionMajor: 1, moduleSnapshotJson: "[]" } });
    }
    // Veiene er eldre enn radene, slik i prod: medlemskap og tildelinger fra to dager siden.
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
    await prisma.$executeRaw`UPDATE "ClassMember" SET "addedAt" = ${twoDaysAgo}::timestamp WHERE "classId" IN (${classId}, ${archivedClassId})`;
    await prisma.$executeRaw`UPDATE "CourseGroupAssignment" SET "createdAt" = ${twoDaysAgo}::timestamp WHERE "classId" IN (${classId}, ${archivedClassId})`;
    // Rader fra før, slik prod har dem: `baseline` fra 2026-11-09 (ingen `sendingAt`), `sent` og `failed`.
    const yesterday = new Date(Date.now() - 24 * 60 * 60_000);
    const sendingAt = new Date(Date.now() - 2 * 60 * 60_000);
    await prisma.courseAssignmentNotice.createMany({
      data: [
        { userId: readded.id, courseId: course.id, status: "baseline", reason: "before_1142", createdAt: yesterday, updatedAt: yesterday },
        { userId: sentOne.id, courseId: course.id, status: "sent", sendingAt, sentAt: sendingAt, createdAt: yesterday, updatedAt: sendingAt },
        { userId: failedOne.id, courseId: course.id, status: "failed", reason: "contains_link", createdAt: yesterday, updatedAt: yesterday },
      ],
    });
    // Rader opprettet over går via Prisma; `updatedAt` settes til nå av `@updatedAt`. Sett tidspunktene slik prod har dem.
    await prisma.$executeRaw`UPDATE "CourseAssignmentNotice" SET "updatedAt" = ${yesterday.toISOString()}::timestamp WHERE "userId" IN (${readded.id}, ${failedOne.id}) AND "courseId" = ${course.id}`;
    await prisma.$executeRaw`UPDATE "CourseAssignmentNotice" SET "updatedAt" = ${sendingAt.toISOString()}::timestamp WHERE "userId" = ${sentOne.id} AND "courseId" = ${course.id}`;

    // Migreringen, slik den står i fila, mot en økt på `Europe/Berlin`.
    const [fill, baseline] = statements();
    const before = Date.now();
    await prisma.$transaction([
      prisma.$executeRawUnsafe("SET LOCAL TIME ZONE 'Europe/Berlin'"),
      prisma.$executeRawUnsafe(fill!),
      prisma.$executeRawUnsafe(baseline!),
    ]);
    const after = Date.now();

    const rows = await prisma.courseAssignmentNotice.findMany({ where: { courseId: course.id } });
    const row = (userId: string) => rows.find((r) => r.userId === userId);
    // 2: `sendingAt` for det som ble sendt, ellers `updatedAt`.
    expect(row(readded.id)?.settledAt?.toISOString()).toBe(yesterday.toISOString());
    expect(row(sentOne.id)?.settledAt?.toISOString()).toBe(sendingAt.toISOString());
    expect(row(failedOne.id)?.settledAt?.toISOString()).toBe(yesterday.toISOString());
    // 3: `baseline` for alle med kursbevis, også i arkivert klasse og som har sluttet; ikke for den uten kursbevis.
    for (const u of [oldCertificate, oldCertificateArchived, oldCertificateLeft]) {
      expect(row(u.id), "kursbevisholder").toMatchObject({ status: "baseline", reason: "before_1146" });
      const settled = row(u.id)!.settledAt!.getTime();
      expect(settled, "UTC, ikke en time feil med Europe/Berlin").toBeGreaterThanOrEqual(before - 5_000);
      expect(settled).toBeLessThanOrEqual(after + 5_000);
    }
    expect(row(noCertificate.id), "uten kursbevis: ingen rad fra migreringen").toBeUndefined();

    // Kjørt igjen: ingenting nytt.
    await prisma.$executeRawUnsafe(baseline!);
    expect(await prisma.courseAssignmentNotice.count({ where: { courseId: course.id } })).toBe(rows.length);

    // Jobben etterpå: bare den uten kursbevis får en ny rad. Så legges kurset inn igjen. Da settes disse tilbake:
    //   - `baseline` fra i går, `sent` og `failed`: veien er nyere enn `settledAt` (svar 3);
    //   - den aktive kursbevisholderen i klassen: kurset er lagt til etter v2, så hen er med etter regelen (B1).
    // Ikke den som har sluttet, og ikke den i den arkiverte klassen: regelen sier nei.
    const t0 = new Date(Date.now() - 2 * 60 * 60_000);
    expect(await runCourseAssignmentEmailSchedule({ now: t0, onlyCourseIds: [course.id] })).toMatchObject({ created: 1, reset: 0 });
    await unassign(classId, course.id);
    await assign(classId, course.id);
    const summary = await runCourseAssignmentEmailSchedule({ now: new Date(t0.getTime() + 60_000), onlyCourseIds: [course.id] });
    const reset = (await prisma.courseAssignmentNotice.findMany({ where: { courseId: course.id, reason: "re_added" }, select: { userId: true } })).map((r) => r.userId).sort();
    // Kursbeviset på v1 + kurset lagt til klassen etter v2: med, som `m2-course-assignment-email-1142` («lagt til klassen etter v2»).
    expect(reset).toEqual([readded.id, sentOne.id, failedOne.id, oldCertificate.id].sort());
    expect(summary.reset).toBe(4);
  });
});
