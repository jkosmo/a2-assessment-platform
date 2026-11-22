import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1145 (doc/design/PLAN_1145.md): kursbevis for kurs tatt utenfor plattformen, registrert av administrator.
//
// Det testen måler, gjennom rutene:
//   - bare administrator kan registrere (fagansvarlig og deltaker får 403); prøvekjøring er standard; referansen valideres;
//   - utfallene: would_create, created, exists, exists_older_version, exists_related_course, not_reachable, unknown_user;
//     et upublisert kurs gir 409; andre kjøring gir bare `exists` (ingen dubletter);
//   - beviset vises uten dato («tatt utenfor») på profilen og kursbeviset, i rapporten uten dato og uten aktivitet, i innsynet;
//   - «Min statistikk»: totalen teller det, ukene og siste aktivitet gjør ikke;
//   - fullfører deltakeren senere på plattformen, blir det samme beviset et vanlig bevis med dato.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `ekstern ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });

const adminHeaders = { "x-user-id": `ekstern-admin-${RUN}`, "x-user-email": `ekstern.admin.${RUN}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR" };
const smoHeaders = { "x-user-id": `ekstern-smo-${RUN}`, "x-user-email": `ekstern.smo.${RUN}@x.test`, "x-user-name": "Fag", "x-user-roles": "SUBJECT_MATTER_OWNER" };
const REF = "Kurs og sertifisering.xlsx, Modul 2";

afterAll(async () => {
  await prisma.$disconnect();
});

async function learner(options: { active?: boolean } = {}) {
  const externalId = `ekstern-p-${RUN}-${seq++}`;
  const user = await prisma.user.create({
    data: { externalId, name: "Deltaker", email: `${externalId}@x.test`, activeStatus: options.active ?? true },
    select: { id: true },
  });
  const headers = { "x-user-id": externalId, "x-user-email": `${externalId}@x.test`, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT", "x-locale": "nb" };
  return { userId: user.id, headers };
}

/** Et publisert, åpent lesekurs med én seksjon: deltakeren kan fullføre det på plattformen ved å lese seksjonen. */
async function course(options: { published?: boolean } = {}) {
  const section = await prisma.courseSection.create({ data: { title: L(tag("seksjon")) }, select: { id: true } });
  const sectionVersion = await prisma.courseSectionVersion.create({
    data: { sectionId: section.id, versionNo: 1, bodyMarkdown: L("Tekst."), publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: sectionVersion.id } });
  const created = await prisma.course.create({
    data: {
      title: L(tag("kurs")),
      enrollmentPolicy: "OPEN",
      publishedAt: options.published === false ? null : new Date(),
      items: { create: [{ itemType: "SECTION", sectionId: section.id, sortOrder: 0 }] },
    },
    select: { id: true },
  });
  return { courseId: created.id, sectionId: section.id, sectionVersionId: sectionVersion.id };
}

const register = (body: Record<string, unknown>, headers: Record<string, string> = adminHeaders) =>
  request(app).post("/api/admin/platform/course-completions/external").set(headers).send(body);

const outcomes = (body: { results: Array<{ userId: string; outcome: string }> }) =>
  Object.fromEntries(body.results.map((r) => [r.userId, r.outcome]));

describe("#1145: registrering av kursbevis for kurs tatt utenfor plattformen", () => {
  it("bare administrator: fagansvarlig og deltaker får 403, og ingenting skrives", async () => {
    const c = await course();
    const u = await learner();
    for (const headers of [smoHeaders, u.headers]) {
      const response = await register({ courseId: c.courseId, userIds: [u.userId], reference: REF, dryRun: false }, headers);
      expect(response.status).toBe(403);
    }
    expect(await prisma.courseCompletion.count({ where: { courseId: c.courseId } })).toBe(0);
  });

  it("prøvekjøring er standard; referansen med tegn utenfor mønsteret avvises", async () => {
    const c = await course();
    const u = await learner();
    const dry = await register({ courseId: c.courseId, userIds: [u.userId], reference: REF });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.dryRun).toBe(true);
    expect(outcomes(dry.body)).toEqual({ [u.userId]: "would_create" });
    expect(await prisma.courseCompletion.count({ where: { courseId: c.courseId } })).toBe(0);

    const bad = await register({ courseId: c.courseId, userIds: [u.userId], reference: "kari@a-2.no <script>", dryRun: false });
    expect(bad.status).toBe(400);
    expect(await prisma.courseCompletion.count({ where: { courseId: c.courseId } })).toBe(0);
  });

  it("skriver ett bevis per person, med revisjon; andre kjøring gir bare `exists`", async () => {
    const c = await course();
    const a = await learner();
    const b = await learner();
    const first = await register({ courseId: c.courseId, userIds: [a.userId, b.userId, a.userId], reference: REF, dryRun: false });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(outcomes(first.body)).toEqual({ [a.userId]: "created", [b.userId]: "created" });

    const rows = await prisma.courseCompletion.findMany({ where: { courseId: c.courseId }, orderBy: { userId: "asc" } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ source: "external", externalReference: REF, moduleSnapshotJson: "[]", sectionSnapshotJson: "[]", versionMajor: 1 });
      expect(row.registeredById).toBeTruthy();
    }
    const audits = await prisma.auditEvent.findMany({ where: { entityId: c.courseId, action: "course_completion_registered_external" } });
    expect(audits).toHaveLength(2);
    expect(audits[0]!.actorId).toBe(rows[0]!.registeredById);

    const again = await register({ courseId: c.courseId, userIds: [a.userId, b.userId], reference: REF, dryRun: false });
    expect(outcomes(again.body)).toEqual({ [a.userId]: "exists", [b.userId]: "exists" });
    expect(await prisma.courseCompletion.count({ where: { courseId: c.courseId } })).toBe(2);
  });

  it("inaktiv person, ukjent id, eldre hovedversjon og bevis på et beslektet kurs skrives ikke", async () => {
    const c = await course();
    const related = await course();
    const inactive = await learner({ active: false });
    const older = await learner();
    const onRelated = await learner();
    await prisma.courseCompletion.create({ data: { userId: older.userId, courseId: c.courseId, versionMajor: 1, moduleSnapshotJson: "[]" } });
    await prisma.course.update({ where: { id: c.courseId }, data: { versionMajor: 2 } });
    await prisma.courseCompletion.create({ data: { userId: onRelated.userId, courseId: related.courseId, moduleSnapshotJson: "[]" } });

    const response = await register({
      courseId: c.courseId,
      userIds: [inactive.userId, "finnes-ikke-" + RUN, older.userId, onRelated.userId],
      relatedCourseIds: [related.courseId],
      reference: REF,
      dryRun: false,
    });
    expect(outcomes(response.body)).toEqual({
      [inactive.userId]: "not_reachable",
      ["finnes-ikke-" + RUN]: "unknown_user",
      [older.userId]: "exists_older_version",
      [onRelated.userId]: "exists_related_course",
    });
    expect(await prisma.courseCompletion.count({ where: { courseId: c.courseId, source: "external" } })).toBe(0);
  });

  it("et upublisert kurs gir 409, og ingenting skrives", async () => {
    const c = await course({ published: false });
    const u = await learner();
    const response = await register({ courseId: c.courseId, userIds: [u.userId], reference: REF, dryRun: false });
    expect(response.status).toBe(409);
    expect(await prisma.courseCompletion.count({ where: { courseId: c.courseId } })).toBe(0);
  });
});

describe("#1145: hvor et registrert bevis vises", () => {
  it("profilen og kursbeviset: ingen dato, `source` = external; innsynet tar det med", async () => {
    const c = await course();
    const u = await learner();
    await register({ courseId: c.courseId, userIds: [u.userId], reference: REF, dryRun: false });

    const list = await request(app).get("/api/courses/completions").set(u.headers);
    expect(list.status).toBe(200);
    const mine = list.body.completions.find((x: { courseId: string }) => x.courseId === c.courseId);
    expect(mine).toMatchObject({ source: "external", completedAt: null, current: true });

    const certificate = await request(app).get(`/api/courses/completions/${mine.certificateId}`).set(u.headers);
    expect(certificate.status).toBe(200);
    expect(certificate.body).toMatchObject({ source: "external", completedAt: null, moduleCount: 0 });

    const data = await request(app).get("/api/me/data").set(u.headers);
    expect(data.status).toBe(200);
    expect(data.body.profile.courseCompletions).toEqual([
      expect.objectContaining({ courseId: c.courseId, source: "external", externalReference: REF, completedAt: null, registeredAt: expect.any(String) }),
    ]);
  });

  it("«Min statistikk»: totalen teller beviset, ukene og siste aktivitet gjør ikke", async () => {
    const c = await course();
    const u = await learner();
    await register({ courseId: c.courseId, userIds: [u.userId], reference: REF, dryRun: false });
    const stats = await request(app).get("/api/me/stats").set(u.headers);
    expect(stats.status).toBe(200);
    expect(stats.body.totals.coursesCompleted).toBe(1);
    expect(stats.body.lastActivityAt).toBeNull();
    expect(stats.body.weeks.every((week: { coursesCompleted: number }) => week.coursesCompleted === 0)).toBe(true);
  });

  it("kursrapporten: fullført, uten dato, uten aktivitet, og moduler/seksjoner som faktisk er målt", async () => {
    const c = await course();
    const u = await learner();
    await register({ courseId: c.courseId, userIds: [u.userId], reference: REF, dryRun: false });
    const report = await request(app).get(`/api/reports/courses/details?selectedCourseId=${c.courseId}`).set(adminHeaders);
    expect(report.status, JSON.stringify(report.body).slice(0, 300)).toBe(200);
    const row = report.body.rows.find((r: { participantId: string }) => r.participantId === u.userId);
    expect(row).toMatchObject({ status: "COMPLETED", completionSource: "external", completedAt: null, latestActivityAt: null, readSections: 0, totalSections: 1 });

    // Med et datovindu som ikke dekker registreringen, telles beviset likevel (ingen kjent dato).
    const windowed = await request(app)
      .get(`/api/reports/courses/details?selectedCourseId=${c.courseId}&dateFrom=2020-01-01&dateTo=2020-12-31`)
      .set(adminHeaders);
    expect(windowed.status).toBe(200);
    expect(windowed.body.rows.find((r: { participantId: string }) => r.participantId === u.userId)).toMatchObject({ status: "COMPLETED", completionSource: "external" });
  });
});

describe("#1145: senere fullført på plattformen", () => {
  it("det registrerte beviset blir et vanlig bevis med dato; samme certificateId", async () => {
    const c = await course();
    const u = await learner();
    await register({ courseId: c.courseId, userIds: [u.userId], reference: REF, dryRun: false });
    const before = await prisma.courseCompletion.findFirstOrThrow({ where: { userId: u.userId, courseId: c.courseId } });
    expect(before.source).toBe("external");

    const read = await request(app)
      .post(`/api/courses/${c.courseId}/sections/${c.sectionId}/read`)
      .set(u.headers)
      .send({ sectionVersionId: c.sectionVersionId });
    expect(read.status, JSON.stringify(read.body)).toBeLessThan(300);

    const after = await prisma.courseCompletion.findMany({ where: { userId: u.userId, courseId: c.courseId } });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ source: "platform", certificateId: before.certificateId, registeredById: before.registeredById });
    expect(after[0]!.sectionSnapshotJson).toBe(JSON.stringify([c.sectionId]));
    expect(after[0]!.completedAt.getTime()).toBeGreaterThanOrEqual(before.completedAt.getTime());

    const audit = await prisma.auditEvent.findFirst({ where: { entityId: c.courseId, action: "course_completion_issued" } });
    expect(JSON.parse(audit!.metadataJson)).toMatchObject({ upgradedFrom: "external", certificateId: before.certificateId });

    const list = await request(app).get("/api/courses/completions").set(u.headers);
    const mine = list.body.completions.find((x: { courseId: string }) => x.courseId === c.courseId);
    expect(mine.source).toBe("platform");
    expect(typeof mine.completedAt).toBe("string");
  });
});
