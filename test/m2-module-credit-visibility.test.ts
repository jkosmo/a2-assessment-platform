// Produkteier 28.11.2026 (doc/DECISIONS.md, #1169 punkt 9; doc/design/PLAN_MODULER_TELLER_DER_DELTAKEREN_SER.md): et bestått i en
// modul teller bare i kurs deltakeren ser. Gjennom rutene der det finnes en rute:
//   - avstemmingen («Mine kurs», `GET /api/courses`) utsteder ikke kursbevis i en begrenset kopi med bare moduler til den som har
//     bestått modulene uten å være tildelt; KONTROLL: tildelt → bevis, og et åpent kurs → bevis som før;
//   - workeren etter et bestått (`checkAndIssueCourseCompletions`) det samme;
//   - kursdetaljen og «Mine kurs» viser bestått for den som ser kurset;
//   - slettevakta: et arkivert kurs teller et bestått levert før arkiveringen (saken ventet, bestått etterpå), ikke et levert etter;
//     og en begrenset kopi uten tildelte holdes ikke igjen av dem som har bestått modulene et annet sted.
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { checkAndIssueCourseCompletions } from "../src/modules/course/courseCompletionService.js";
import { checkCourseDelete } from "../src/modules/course/courseDeleteGuard.js";

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `modvis ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });

afterAll(async () => {
  await prisma.$disconnect();
});

type Learner = { userId: string; headers: Record<string, string> };

async function learner(): Promise<Learner> {
  const externalId = `modvis-p-${RUN}-${seq++}`;
  const email = `${externalId}@x.test`;
  const user = await prisma.user.create({ data: { externalId, name: "Deltaker", email }, select: { id: true } });
  return { userId: user.id, headers: { "x-user-id": externalId, "x-user-email": email, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT", "x-locale": "nb" } };
}

async function publishedModule(): Promise<{ id: string; versionId: string }> {
  const created = await prisma.module.create({ data: { title: L(tag("modul")) }, select: { id: true } });
  const version = await prisma.moduleVersion.create({
    data: { moduleId: created.id, versionNo: 1, versionMajor: 1, versionMinor: 0, assessmentMode: "MCQ_ONLY", publishedAt: new Date(), taskText: L("Oppgave") },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: created.id }, data: { activeVersionId: version.id } });
  return { id: created.id, versionId: version.id };
}

/** Et kurs med bare modulen, kravet fylt ut (som `setCourseItems` gjør). Publisert (med lenke) med mindre noe annet er sagt. */
async function moduleCourse(moduleId: string, options: { policy?: "OPEN" | "RESTRICTED"; archivedAt?: Date; published?: boolean } = {}): Promise<string> {
  const published = options.published ?? true;
  const created = await prisma.course.create({
    data: {
      title: L(tag("kurs")),
      enrollmentPolicy: options.policy ?? "RESTRICTED",
      publishedAt: published && !options.archivedAt ? new Date() : null,
      slug: published ? `modvis-${RUN}-${seq++}` : null,
      archivedAt: options.archivedAt ?? null,
      items: { create: [{ itemType: "MODULE", moduleId, sortOrder: 0 }] },
    },
    select: { id: true },
  });
  await prisma.courseModuleRequirement.create({ data: { courseId: created.id, moduleId, minModuleMajor: 1 } });
  return created.id;
}

/** En innlevering, et vedtak og et bestått, skrevet direkte (som `recordModulePassFromDecision`). */
async function pass(userId: string, module: { id: string; versionId: string }, at: { submittedAt?: Date; passedAt?: Date } = {}) {
  const submittedAt = at.submittedAt ?? new Date();
  const submission = await prisma.submission.create({
    data: { userId, moduleId: module.id, moduleVersionId: module.versionId, deliveryType: "text", responseJson: "{}", submissionStatus: "COMPLETED", submittedAt },
    select: { id: true },
  });
  const decision = await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id, moduleVersionId: module.versionId, mcqScaledScore: 80, practicalScaledScore: 10, totalScore: 90, redFlagsJson: "[]",
      passFailTotal: true, decisionType: "AUTOMATIC", decisionReason: "Vurdert.", finalisedById: userId, finalisedAt: at.passedAt ?? submittedAt,
    },
    select: { id: true },
  });
  await prisma.modulePass.create({
    data: { userId, moduleId: module.id, submissionId: submission.id, decisionId: decision.id, moduleVersionId: module.versionId, passedAt: at.passedAt ?? submittedAt },
  });
}

const certificates = (userId: string, courseId: string) => prisma.courseCompletion.count({ where: { userId, courseId } });
const enroll = (userId: string, courseId: string) => prisma.courseEnrollment.create({ data: { userId, courseId, source: "INDIVIDUAL" } });

async function myCourses(who: Learner) {
  // Avstemmingen kjører når kursbevisene åpnes (`GET /api/courses/completions`); «Mine kurs» viser fremdriften.
  const reconciled = await request(app).get("/api/courses/completions").set(who.headers);
  expect(reconciled.status, JSON.stringify(reconciled.body).slice(0, 300)).toBe(200);
  const response = await request(app).get("/api/courses").set(who.headers);
  expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
  return response.body.courses as Array<{ id: string; progress: { moduleCompleted?: number; courseStatus: string } }>;
}

describe("bestått modul teller bare i kurs deltakeren ser (28.11.2026)", () => {
  it("avstemmingen: ingen kursbevis i en begrenset kopi hen ikke er tildelt; KONTROLL: tildelt → bevis", async () => {
    const m = await publishedModule();
    const copy = await moduleCourse(m.id);
    const who = await learner();
    await pass(who.userId, m);

    await myCourses(who);
    expect(await certificates(who.userId, copy)).toBe(0);

    await enroll(who.userId, copy);
    const courses = await myCourses(who);
    expect(await certificates(who.userId, copy)).toBe(1);
    expect(courses.find((c) => c.id === copy)?.progress.courseStatus).toBe("COMPLETED");
  });

  it("KONTROLL: et åpent kurs med modulen gir kursbevis som før", async () => {
    const m = await publishedModule();
    const open = await moduleCourse(m.id, { policy: "OPEN" });
    const who = await learner();
    await pass(who.userId, m);
    await myCourses(who);
    expect(await certificates(who.userId, open)).toBe(1);
  });

  it("workeren etter et bestått: ikke i et begrenset kurs hen ikke er tildelt; KONTROLL: i det hen er tildelt", async () => {
    const m = await publishedModule();
    const notMine = await moduleCourse(m.id);
    const mine = await moduleCourse(m.id);
    const who = await learner();
    await enroll(who.userId, mine);
    await pass(who.userId, m);
    await checkAndIssueCourseCompletions({ userId: who.userId, moduleId: m.id });
    expect(await certificates(who.userId, notMine)).toBe(0);
    expect(await certificates(who.userId, mine)).toBe(1);
  });

  it("kursdetaljen viser modulen bestått for den som ser kurset", async () => {
    const m = await publishedModule();
    const open = await moduleCourse(m.id, { policy: "OPEN" });
    const who = await learner();
    await pass(who.userId, m);
    const response = await request(app).get(`/api/courses/${open}`).set(who.headers);
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(response.body.course.progress).toMatchObject({ moduleCompleted: 1, moduleTotal: 1 });
  });

  it("slettevakta: levert før arkiveringen og bestått etter holder kurset igjen; KONTROLL: levert etter arkiveringen gjør det ikke", async () => {
    const m = await publishedModule();
    const archivedAt = new Date(Date.now() - 86_400_000);
    const C = await moduleCourse(m.id, { policy: "OPEN", archivedAt });

    const late = await learner();
    await pass(late.userId, m, { submittedAt: new Date(archivedAt.getTime() + 60_000) });
    expect(await checkCourseDelete(C)).toMatchObject({ status: "deletable" });

    const waited = await learner();
    await pass(waited.userId, m, { submittedAt: new Date(archivedAt.getTime() - 60_000), passedAt: new Date(archivedAt.getTime() + 120_000) });
    const blocked = await checkCourseDelete(C);
    expect(blocked.status).toBe("blocked");
    expect(blocked.status === "blocked" ? blocked.error.code : null).toBe("course_has_completed_without_certificate");
  });

  it("slettevakta: en begrenset kopi uten tildelte holdes ikke igjen av dem som har bestått modulene et annet sted", async () => {
    const m = await publishedModule();
    const who = await learner();
    await pass(who.userId, m, { submittedAt: new Date(Date.now() - 3 * 86_400_000) });
    const copy = await moduleCourse(m.id, { archivedAt: new Date() });
    expect(await checkCourseDelete(copy)).toMatchObject({ status: "deletable" });
  });
});
