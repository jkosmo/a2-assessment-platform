import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { runContentWrite, type ContentWriteTx } from "../src/db/contentLock.js";
import { createMcqOnlyDecision } from "../src/modules/assessment/decisionService.js";
import { backfillModuleCredit } from "../src/modules/course/moduleCreditBackfill.js";
import { MODULE_PASS_SWITCH_KEY } from "../src/modules/course/modulePassSwitch.js";
import { publishCoursePendingVersioned, publishModuleVersioned } from "../src/modules/course/versionedPublishService.js";
import { deliverOutboxEvent, OUTBOX_EVENT_TYPES } from "../src/modules/outbox/outboxService.js";
import { auditActions } from "../src/observability/auditEvents.js";
import { preBodyApiLimiter } from "../src/middleware/rateLimiting.js";
import { withRevision } from "./support/courseRevision.js";
import { readSection, seenModuleVersionId } from "./support/participantFlow.js";

// #934 skive 5a-3 (doc/DESIGN_934.md, «5a-3»): bryteren og regelen om beståtte per kurs.
//   - Med bryteren av er alt som i 2.134.0. Det er det viktigste kravet ved utrulling, så hver regel har en kontroll her.
//   - Med bryteren på teller en bestått i et kurs når hovedversjonen er minst kravet for (kurs, modul). Bevisene i planen står under.
// Testene går gjennom rutene (supertest). Gammel kode og sene vedtak lages direkte, slik jobben og sensoren ville gjort det.
//
// ⚠️ Bryteren er en rad i den delte testdatabasen. Hver test slår den på selv, og `afterEach` tar den bort igjen, så et brudd midt
// i en test ikke smitter over på neste fil. Filene kjører etter hverandre (`fileParallelism: false`).

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const T = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const L = (text: string) => JSON.stringify(T(text));
let adminCalls = 0;
function admin() {
  const n = Math.floor(adminCalls++ / 80);
  return { "x-user-id": `a3-admin-${RUN}-${n}`, "x-user-email": `a3.admin.${RUN}.${n}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
}
const HANDLER = { "x-user-id": `a3-handler-${RUN}`, "x-user-email": `a3.handler.${RUN}@x.test`, "x-user-name": "Behandler", "x-user-roles": "APPEAL_HANDLER", "x-locale": "nb" };
const READER = { "x-user-id": `a3-reader-${RUN}`, "x-user-email": `a3.reader.${RUN}@x.test`, "x-user-name": "Leser", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };

let seq = 0;
const tag = (name: string) => `5a3 ${name} ${RUN}-${seq++}`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const switchOn = () =>
  prisma.platformConfig.upsert({ where: { key: MODULE_PASS_SWITCH_KEY }, create: { key: MODULE_PASS_SWITCH_KEY, value: "on" }, update: { value: "on" } });
const switchOff = () => prisma.platformConfig.deleteMany({ where: { key: MODULE_PASS_SWITCH_KEY } });

// Grensen før innlogging er 600 kall i minuttet per IP, og fila bruker flere enn det gjennom rutene. Grensen er ikke det som måles her.
beforeEach(async () => {
  for (const ip of ["::ffff:127.0.0.1", "127.0.0.1", "::1"]) preBodyApiLimiter.resetKey(ip);
  await switchOff();
});
afterEach(switchOff);
afterAll(async () => {
  await switchOff();
  await prisma.$disconnect();
});

async function learner() {
  const suffix = `${RUN}-${seq++}`;
  const headers = { "x-user-id": `a3-p-${suffix}`, "x-user-email": `a3.p.${suffix}@x.test`, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT", "x-locale": "nb" };
  const user = await prisma.user.create({ data: { externalId: headers["x-user-id"], email: headers["x-user-email"], name: "Deltaker" }, select: { id: true } });
  return { headers, userId: user.id };
}

type Headers = Record<string, string>;

/** Et sett med ett spørsmål, så deltakeren kan ta modulen gjennom rutene. */
async function newVersion(moduleId: string) {
  const set = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`).set(admin()).send({
    title: T("Sett"),
    questions: [{ stem: T("Hva er riktig?"), options: [T("Riktig"), T("Galt")], correctAnswer: T("Riktig"), rationale: T("Fordi.") }],
  });
  expect(set.status, JSON.stringify(set.body).slice(0, 300)).toBe(201);
  const version = await request(app).post(`/api/admin/content/modules/${moduleId}/module-versions`).set(admin()).send({
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: set.body.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 }, mcq: { reviewAfterSubmit: true, shuffleQuestions: false } },
  });
  expect(version.status, JSON.stringify(version.body).slice(0, 300)).toBe(201);
  return version.body.moduleVersion.id as string;
}

const publishOld = (moduleId: string, versionId: string, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/admin/content/modules/${moduleId}/module-versions/${versionId}/publish`).set(admin()).send(body);
const publishVersioned = (moduleId: string, versionId: string, body: Record<string, unknown>, headers: Headers = admin()) =>
  request(app).post(`/api/admin/content/modules/${moduleId}/module-versions/${versionId}/publish-versioned`).set(headers).send(body);
const pendingVersioned = (courseId: string, body: Record<string, unknown>, headers: Headers = admin()) =>
  request(app).post(`/api/admin/content/courses/${courseId}/publish-pending-versioned`).set(headers).send(body);

async function publishedModule() {
  const created = await request(app).post("/api/admin/content/modules").set(admin()).send({ title: T(tag("modul")), certificationLevel: "basic" });
  expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
  const moduleId = created.body.module.id as string;
  const versionId = await newVersion(moduleId);
  const published = await publishOld(moduleId, versionId);
  expect(published.status, JSON.stringify(published.body).slice(0, 300)).toBe(200);
  return { moduleId, versionId };
}

async function setItems(courseId: string, moduleIds: string[]) {
  const response = await request(app).put(`/api/admin/content/courses/${courseId}/items`).set(admin())
    .send(await withRevision(courseId, { items: moduleIds.map((moduleId) => ({ type: "MODULE", moduleId })), version: "minor" }));
  expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(204);
}

async function newCourse(moduleIds: string[], options: { publish?: boolean } = {}) {
  const created = await request(app).post("/api/admin/content/courses").set(admin()).send({ title: T(tag("kurs")), certificationLevel: "basic", sortOrder: 2 });
  expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
  const courseId = created.body.course.id as string;
  await setItems(courseId, moduleIds);
  if (options.publish !== false) {
    const published = await request(app).post(`/api/admin/content/courses/${courseId}/publish`).set(admin());
    expect(published.status, JSON.stringify(published.body).slice(0, 300)).toBe(200);
  }
  return courseId;
}

/** Deltakeren tar modulen gjennom rutene, slik siden gjør det. `pass: false` velger feil svar. */
async function takeModule(headers: Headers, moduleId: string, options: { pass?: boolean } = {}) {
  const submitted = await request(app).post("/api/submissions").set(headers).send({
    moduleId,
    moduleVersionId: await seenModuleVersionId(app, headers, moduleId),
    deliveryType: "text",
    responseJson: {},
  });
  expect(submitted.status, JSON.stringify(submitted.body).slice(0, 300)).toBe(201);
  const submissionId = submitted.body.submission.id as string;
  const started = await request(app).get(`/api/modules/${moduleId}/mcq/start`).query({ submissionId, locale: "nb" }).set(headers);
  expect(started.status, JSON.stringify(started.body).slice(0, 300)).toBe(200);
  const wanted = options.pass === false ? "Galt" : "Riktig";
  const finished = await request(app).post(`/api/modules/${moduleId}/mcq/submit`).set(headers).send({
    submissionId,
    attemptId: started.body.attemptId,
    responses: (started.body.questions as Array<{ id: string; options: string[] }>).map((question) => ({ questionId: question.id, selectedAnswer: question.options.find((o) => o === wanted) ?? question.options[0] })),
  });
  expect(finished.status, JSON.stringify(finished.body).slice(0, 300)).toBeLessThan(300);
  const decision = await prisma.assessmentDecision.findFirst({ where: { submissionId }, orderBy: { createdAt: "desc" }, select: { id: true, passFailTotal: true } });
  expect(decision?.passFailTotal, "vedtaket ble fattet").toBe(options.pass !== false);
  return submissionId;
}

/** Kursbevissiden, der avstemmingen kjører. */
async function openCertificates(headers: Headers) {
  const response = await request(app).get("/api/courses/completions").set(headers);
  expect(response.status).toBe(200);
  return response.body.completions as Array<{ courseId: string; versionMajor: number; current: boolean }>;
}

async function courseDetail(headers: Headers, courseId: string) {
  const response = await request(app).get(`/api/courses/${courseId}`).set(headers);
  expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
  return response.body.course as {
    progress: { completed: number; total: number; courseStatus: string; moduleCompleted: number };
    items: Array<{ type: string; moduleId?: string; moduleStatus?: string; retakeRequired?: boolean }>;
    modules: Array<{ moduleId: string; moduleStatus: string }>;
  };
}

const moduleItem = (course: Awaited<ReturnType<typeof courseDetail>>, moduleId: string) => course.items.find((item) => item.moduleId === moduleId);

async function listProgress(headers: Headers, courseId: string) {
  const response = await request(app).get("/api/courses").set(headers);
  expect(response.status).toBe(200);
  return (response.body.courses as Array<{ id: string; progress: { moduleCompleted: number; courseStatus: string } }>).find((course) => course.id === courseId)?.progress;
}

const requirementOf = async (courseId: string, moduleId: string) =>
  (await prisma.courseModuleRequirement.findUnique({ where: { courseId_moduleId: { courseId, moduleId } } }))?.minModuleMajor ?? null;
const versionOf = async (courseId: string) => {
  const row = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { versionMajor: true, versionMinor: true } });
  return `${row.versionMajor}.${row.versionMinor}`;
};
const numberOf = async (moduleVersionId: string) => {
  const row = await prisma.moduleVersion.findUniqueOrThrow({ where: { id: moduleVersionId }, select: { versionMajor: true, versionMinor: true } });
  return row.versionMajor === null ? null : `${row.versionMajor}.${row.versionMinor}`;
};
const activeVersionOf = async (moduleId: string) => (await prisma.module.findUniqueOrThrow({ where: { id: moduleId }, select: { activeVersionId: true } })).activeVersionId;
const statusOf = async (userId: string, moduleId: string) => (await prisma.certificationStatus.findUnique({ where: { userId_moduleId: { userId, moduleId } } }))?.status ?? null;
const certificates = (userId: string, courseId: string) => prisma.courseCompletion.findMany({ where: { userId, courseId }, orderBy: { versionMajor: "asc" } });
const revisedMails = (moduleId: string) =>
  prisma.outboxEvent.count({ where: { type: OUTBOX_EVENT_TYPES.moduleRevisedNotification, payloadJson: { contains: moduleId } } });

/** En innlevering på en gitt versjon og et vedtak, slik vurderingsjobben fatter det: sent, etter en publisering. */
async function decideOn(userId: string, moduleId: string, moduleVersionId: string, percent: number) {
  const submission = await prisma.submission.create({ data: { userId, moduleId, moduleVersionId, deliveryType: "text", responseJson: "{}", submissionStatus: "PROCESSING" }, select: { id: true } });
  const lockedAt = new Date();
  const job = await prisma.assessmentJob.create({ data: { submissionId: submission.id, status: "RUNNING", lockedBy: "test-worker", lockedAt, maxAttempts: 3 }, select: { id: true } });
  await createMcqOnlyDecision({
    jobId: job.id,
    fence: { lockedBy: "test-worker", lockedAt },
    submissionId: submission.id,
    userId,
    moduleVersionId,
    mcqScaledScore: percent,
    mcqPercentScore: percent,
    assessmentPolicy: null,
  } as never);
  return submission.id;
}

/** Modulen M i to publiserte kurs. Deltakeren har bestått og har kursbevis i begge. */
async function twoCoursesWithCertificates() {
  const { moduleId, versionId } = await publishedModule();
  const a = await newCourse([moduleId]);
  const b = await newCourse([moduleId]);
  const u = await learner();
  await takeModule(u.headers, moduleId);
  const issued = await openCertificates(u.headers);
  expect(issued.filter((row) => row.courseId === a || row.courseId === b)).toHaveLength(2);
  return { moduleId, versionId, a, b, u };
}

/** Hever kravet i kurset gjennom ruta. Forutsetter at bryteren er på, og at noen har kursbevis i kurset. */
async function majorIn(moduleId: string, answers: Record<string, "major" | "minor">, expected: string[]) {
  const versionId = await newVersion(moduleId);
  const response = await publishVersioned(moduleId, versionId, { moduleVersion: "major", courseVersions: answers, expectedCourseIds: expected });
  expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
  return versionId;
}

function hold<TX>(open: (callback: (tx: TX) => Promise<void>) => Promise<void>) {
  let markHeld!: () => void;
  const held = new Promise<void>((resolve) => { markHeld = resolve; });
  let release!: (fn?: (tx: TX) => Promise<unknown>) => void;
  const released = new Promise<((tx: TX) => Promise<unknown>) | undefined>((resolve) => { release = resolve; });
  const done = open(async (tx) => {
    markHeld();
    const fn = await released;
    if (fn) await fn(tx);
  });
  return { held, release, done };
}
const holdContent = () => hold<ContentWriteTx>((cb) => runContentWrite(cb, { timeout: 15_000 }));
async function stillWaiting(promise: Promise<unknown>, ms = 400) {
  let settled = false;
  const tracked = promise.then(() => { settled = true; }, () => { settled = true; });
  await Promise.race([tracked, pause(ms)]);
  return !settled;
}

describe("#934 5a-3: bryteren", () => {
  it("leses for hvert kall, uten mellomlagring: samme deltaker får ny regel fra neste kall, og gammel regel når raden er borte", async () => {
    const { moduleId, a, b, u } = await twoCoursesWithCertificates();
    await switchOn();
    await majorIn(moduleId, { [a]: "major", [b]: "minor" }, [a, b]);
    expect(moduleItem(await courseDetail(u.headers, a), moduleId)?.moduleStatus).toBe("REVISED_RETAKE_REQUIRED");
    await switchOff();
    // Bare for å måle at raden leses. I drift slås den aldri av etter at et krav er hevet.
    expect(moduleItem(await courseDetail(u.headers, a), moduleId)?.moduleStatus).toBe("PASSED");
    await prisma.platformConfig.create({ data: { key: MODULE_PASS_SWITCH_KEY, value: "off" } });
    expect(moduleItem(await courseDetail(u.headers, a), moduleId)?.moduleStatus).toBe("PASSED");
    await switchOff();
    await switchOn();
    expect(moduleItem(await courseDetail(u.headers, a), moduleId)?.moduleStatus).toBe("REVISED_RETAKE_REQUIRED");
  });

  it("tilbakefyllingen nekter å kjøre, også når bryteren slås på etter at den startet", async () => {
    const { moduleId } = await publishedModule();
    await switchOn();
    await expect(backfillModuleCredit({ moduleIds: [moduleId], userIds: [] })).rejects.toMatchObject({ code: "module_credit_backfill_refused" });
    await switchOff();
    expect((await backfillModuleCredit({ moduleIds: [moduleId], userIds: [] })).modules).toBe(1);
  });
});

describe("#934 5a-3 bevis: modul i to kurs, hoved i A og mindre i B", () => {
  it("B beholder beståtten og fullført. A må ta ny versjon, består på nytt og får kursbevis for den nye hovedversjonen", async () => {
    const { moduleId, versionId, a, b, u } = await twoCoursesWithCertificates();
    await switchOn();
    const v2 = await newVersion(moduleId);

    const response = await publishVersioned(moduleId, v2, { moduleVersion: "major", courseVersions: { [a]: "major", [b]: "minor" }, expectedCourseIds: [a, b] });
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
    expect(response.body.moduleVersion).toMatchObject({ versionMajor: 2, versionMinor: 0 });
    const outcome = Object.fromEntries((response.body.courses as Array<{ courseId: string; version: { kind: string; raisedModuleIds?: string[] } }>).map((row) => [row.courseId, row.version]));
    expect(outcome[a]).toMatchObject({ kind: "major", raisedModuleIds: [moduleId] });
    expect(outcome[b]).toMatchObject({ kind: "minor" });

    // Kravet og versjonen, per kurs, i samme transaksjon.
    expect([await requirementOf(a, moduleId), await requirementOf(b, moduleId)]).toEqual([2, 1]);
    expect(await versionOf(a)).toBe("2.0");
    expect(await versionOf(b)).toMatch(/^1\.[1-9]/);
    expect(await activeVersionOf(moduleId)).toBe(v2);

    // A: «må ta ny versjon», og teller og modulstatus sier det samme, i detaljen og i lista.
    const inA = await courseDetail(u.headers, a);
    expect(moduleItem(inA, moduleId)).toMatchObject({ moduleStatus: "REVISED_RETAKE_REQUIRED", retakeRequired: true });
    expect(inA.modules.find((row) => row.moduleId === moduleId)?.moduleStatus).toBe("REVISED_RETAKE_REQUIRED");
    expect(inA.progress.moduleCompleted).toBe(0);
    expect((await listProgress(u.headers, a))?.moduleCompleted).toBe(0);

    // B: urørt.
    const inB = await courseDetail(u.headers, b);
    expect(moduleItem(inB, moduleId)?.moduleStatus).toBe("PASSED");
    expect(moduleItem(inB, moduleId)?.retakeRequired).toBeUndefined();
    expect(inB.progress).toMatchObject({ moduleCompleted: 1, courseStatus: "COMPLETED" });
    expect((await listProgress(u.headers, b))?.moduleCompleted).toBe(1);
    expect((await openCertificates(u.headers)).filter((row) => row.courseId === b && row.current)).toHaveLength(1);

    // Ingen nytt bevis i A før kravet er oppfylt. Det gamle står.
    expect((await certificates(u.userId, a)).map((row) => row.versionMajor)).toEqual([1]);

    // Ingen #997: `SUPERSEDED` skrives ikke, og den gamle e-posten går ikke. E-posten fra 4b gjelder, i kurset som fikk hovedversjon.
    expect(await statusOf(u.userId, moduleId)).toBe("ACTIVE");
    expect(await revisedMails(moduleId)).toBe(0);
    expect(await prisma.auditEvent.count({ where: { entityId: moduleId, action: auditActions.adminContent.modulePassesSuperseded } })).toBe(0);
    expect(await prisma.courseVersionNotice.count({ where: { courseId: a, versionMajor: 2, userId: u.userId } })).toBe(1);
    expect(await prisma.courseVersionNotice.count({ where: { courseId: b, userId: u.userId } })).toBe(0);
    expect((await prisma.courseVersion.findUniqueOrThrow({ where: { courseId_versionMajor: { courseId: a, versionMajor: 2 } } })).changedItemCount).toBe(1);

    // Deltakeren tar den på nytt fra kurset, gjennom rutene.
    await takeModule(u.headers, moduleId);
    const passes = await prisma.modulePass.findMany({ where: { userId: u.userId, moduleId } });
    expect(passes.map((row) => row.moduleVersionId).sort()).toEqual([versionId, v2].sort());
    const after = await courseDetail(u.headers, a);
    expect(moduleItem(after, moduleId)?.moduleStatus).toBe("PASSED");
    expect(moduleItem(after, moduleId)?.retakeRequired).toBeUndefined();
    const list = await openCertificates(u.headers);
    expect((await certificates(u.userId, a)).map((row) => row.versionMajor)).toEqual([1, 2]);
    expect(list.filter((row) => row.courseId === a).map((row) => [row.versionMajor, row.current]).sort()).toEqual([[1, false], [2, true]]);
    // Et kursbevis er permanent, og B fikk ikke noe nytt.
    expect((await certificates(u.userId, b)).map((row) => row.versionMajor)).toEqual([1]);
  });

  it("KONTROLL, bryteren av: de nye endepunktene svarer 409, og avkrysningen tar beståtten fra alle kurs, slik 2.134.0 gjør", async () => {
    const { moduleId, a, b, u } = await twoCoursesWithCertificates();
    const v2 = await newVersion(moduleId);
    const refused = await publishVersioned(moduleId, v2, { moduleVersion: "major", courseVersions: { [a]: "major", [b]: "minor" }, expectedCourseIds: [a, b] });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("module_versioning_not_active");
    expect(await activeVersionOf(moduleId)).not.toBe(v2);

    const old = await publishOld(moduleId, v2, { supersedesEarlierPasses: true });
    expect(old.status, JSON.stringify(old.body).slice(0, 300)).toBe(200);
    expect(await statusOf(u.userId, moduleId)).toBe("SUPERSEDED");
    expect([await requirementOf(a, moduleId), await requirementOf(b, moduleId)]).toEqual([2, 2]);
    expect(await revisedMails(moduleId)).toBe(1);
    expect(await versionOf(a)).toMatch(/^1\./);
    for (const courseId of [a, b]) {
      const detail = await courseDetail(u.headers, courseId);
      expect(moduleItem(detail, moduleId)?.moduleStatus).toBe("REVISED_RETAKE_REQUIRED");
      // Feltet til modulsiden finnes bare med den nye regelen.
      expect(moduleItem(detail, moduleId)).not.toHaveProperty("retakeRequired");
      expect(detail.progress.moduleCompleted).toBe(0);
    }
  });
});

describe("#934 5a-3 bevis: et nytt forsøk stryker (svar f)", () => {
  it("B beholder beståtten, i detaljen, i lista og i rapporten", async () => {
    const { moduleId, a, b, u } = await twoCoursesWithCertificates();
    await switchOn();
    await majorIn(moduleId, { [a]: "major", [b]: "minor" }, [a, b]);
    await takeModule(u.headers, moduleId, { pass: false });
    expect(await statusOf(u.userId, moduleId)).toBe("NOT_CERTIFIED"); // Skrives som før; ingen fremdrift leser det.
    const inB = await courseDetail(u.headers, b);
    expect(moduleItem(inB, moduleId)?.moduleStatus).toBe("PASSED");
    expect(inB.progress.moduleCompleted).toBe(1);
    expect((await listProgress(u.headers, b))?.moduleCompleted).toBe(1);
    // A: fortsatt «må ta ny versjon», ikke «stryk». Et nytt bevis kommer ikke.
    expect(moduleItem(await courseDetail(u.headers, a), moduleId)?.moduleStatus).toBe("REVISED_RETAKE_REQUIRED");
    await openCertificates(u.headers);
    expect((await certificates(u.userId, a)).map((row) => row.versionMajor)).toEqual([1]);
  });

  it("KONTROLL, bryteren av: strykket tar beståtten, slik 2.134.0 gjør", async () => {
    const { moduleId, b, u } = await twoCoursesWithCertificates();
    await takeModule(u.headers, moduleId, { pass: false });
    const inB = await courseDetail(u.headers, b);
    expect(moduleItem(inB, moduleId)?.moduleStatus).toBe("IN_PROGRESS");
    expect(inB.progress.moduleCompleted).toBe(0);
  });
});

describe("#934 5a-3 bevis: sannhetstabellen", () => {
  /** Modulen er i kurset, og noen andre enn deltakeren har kursbevis, så kurset kan få hovedversjon. */
  async function courseWithHolder() {
    const { moduleId, versionId } = await publishedModule();
    const courseId = await newCourse([moduleId]);
    const holder = await learner();
    await takeModule(holder.headers, moduleId);
    await openCertificates(holder.headers);
    return { moduleId, versionId, courseId, holder };
  }

  it("mindre versjon og kalibrering: kravet står, og beståtten teller", async () => {
    const { moduleId, courseId, holder } = await courseWithHolder();
    await switchOn();
    const v2 = await newVersion(moduleId);
    const minor = await publishVersioned(moduleId, v2, { moduleVersion: "minor" });
    expect(minor.status, JSON.stringify(minor.body).slice(0, 300)).toBe(200);
    expect(minor.body.moduleVersion).toMatchObject({ versionMajor: 1, versionMinor: 1 });
    const calibrated = await request(app).post("/api/calibration/workspace/publish-thresholds").set(admin()).send({ moduleId, totalMin: 70 });
    expect(calibrated.status, JSON.stringify(calibrated.body).slice(0, 300)).toBe(200);
    expect(await requirementOf(courseId, moduleId)).toBe(1);
    expect(moduleItem(await courseDetail(holder.headers, courseId), moduleId)?.moduleStatus).toBe("PASSED");
  });

  it("hovedversjon, kurset svarer hoved, men ingen har kursbevis: kurset blir mindre, kravet står, og beståtten teller (svar d)", async () => {
    const { moduleId } = await publishedModule();
    const courseId = await newCourse([moduleId]);
    const u = await learner();
    // Deltakeren har bestått, men ikke åpnet kursbevissiden. Vedtaket er nok: workeren er ikke med her.
    await takeModule(u.headers, moduleId);
    await prisma.courseCompletion.deleteMany({ where: { courseId } });
    await switchOn();
    const v2 = await newVersion(moduleId);
    const response = await publishVersioned(moduleId, v2, { moduleVersion: "major", courseVersions: { [courseId]: "major" }, expectedCourseIds: [courseId] });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(response.body.courses[0].version.kind).toBe("minor");
    expect(await requirementOf(courseId, moduleId)).toBe(1);
    expect(moduleItem(await courseDetail(u.headers, courseId), moduleId)?.moduleStatus).toBe("PASSED");
    expect(await numberOf(v2)).toBe("2.0");
  });

  it("hoppet over en hovedversjon: C 2.0 hevet kravet til 2, C 3.0 rører ikke M. 1.x teller ikke, 2.0 og 2.1 gjør", async () => {
    const { moduleId, versionId, courseId } = await courseWithHolder();
    await switchOn();
    const v2 = await majorIn(moduleId, { [courseId]: "major" }, [courseId]);
    expect(await requirementOf(courseId, moduleId)).toBe(2);
    const v21 = await newVersion(moduleId);
    expect((await publishVersioned(moduleId, v21, { moduleVersion: "minor" })).status).toBe(200);
    expect(await numberOf(v21)).toBe("2.1");
    // Hovedversjon 3 av modulen, men kurset svarer mindre: kravet står på 2, og senkes ikke.
    const v3 = await newVersion(moduleId);
    const third = await publishVersioned(moduleId, v3, { moduleVersion: "major", courseVersions: { [courseId]: "minor" }, expectedCourseIds: [courseId] });
    expect(third.status, JSON.stringify(third.body).slice(0, 300)).toBe(200);
    expect(await numberOf(v3)).toBe("3.0");
    expect(await requirementOf(courseId, moduleId)).toBe(2);

    const skipped = await learner();
    await decideOn(skipped.userId, moduleId, versionId, 90);
    const on20 = await learner();
    await decideOn(on20.userId, moduleId, v2, 90);
    const on21 = await learner();
    await decideOn(on21.userId, moduleId, v21, 90);
    expect(moduleItem(await courseDetail(skipped.headers, courseId), moduleId)?.moduleStatus).toBe("REVISED_RETAKE_REQUIRED");
    expect(moduleItem(await courseDetail(on20.headers, courseId), moduleId)?.moduleStatus).toBe("PASSED");
    expect(moduleItem(await courseDetail(on21.headers, courseId), moduleId)?.moduleStatus).toBe("PASSED");
  });

  it("innlevering på 1.x vurdert etter at 2.0 kom: nei i kurset med krav 2, ja i kurset med krav 1, og ingen kursbevis uten at kravet er oppfylt (mangel 30)", async () => {
    const { moduleId, versionId, courseId } = await courseWithHolder();
    const other = await newCourse([moduleId]);
    const otherHolder = await learner();
    await takeModule(otherHolder.headers, moduleId);
    await openCertificates(otherHolder.headers);
    await switchOn();
    await majorIn(moduleId, { [courseId]: "major", [other]: "minor" }, [courseId, other].sort());

    const u = await learner();
    await decideOn(u.userId, moduleId, versionId, 90);
    expect(moduleItem(await courseDetail(u.headers, courseId), moduleId)?.moduleStatus).toBe("REVISED_RETAKE_REQUIRED");
    expect(moduleItem(await courseDetail(u.headers, other), moduleId)?.moduleStatus).toBe("PASSED");
    await openCertificates(u.headers);
    expect(await certificates(u.userId, courseId)).toEqual([]);
    expect(await certificates(u.userId, other)).toHaveLength(1);
  });

  it("KONTROLL, bryteren av: samme innlevering gir kursbevis, slik 2.134.0 gjør (mangel 30)", async () => {
    const { moduleId, versionId, courseId } = await courseWithHolder();
    const v2 = await newVersion(moduleId);
    expect((await publishOld(moduleId, v2, { supersedesEarlierPasses: true })).status).toBe(200);
    const u = await learner();
    await decideOn(u.userId, moduleId, versionId, 90);
    await openCertificates(u.headers);
    expect(await certificates(u.userId, courseId)).toHaveLength(1);
  });

  async function appealOverturned(userId: string, submissionId: string) {
    const appeal = await prisma.appeal.create({ data: { submissionId, appealedById: userId, appealReason: "Jeg ber om en ny vurdering.", appealStatus: "OPEN" }, select: { id: true } });
    expect((await request(app).post(`/api/appeals/${appeal.id}/claim`).set(HANDLER)).status).toBe(200);
    const response = await request(app).post(`/api/appeals/${appeal.id}/resolve`).set(HANDLER).send({ passFailTotal: false, decisionReason: "Stryk etter anke.", resolutionNote: "Ny vurdering er gjort." });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
  }

  it("en anke snur en bestått: den innleveringen teller ikke, og kursbevis utstedes ikke (mangel 41)", async () => {
    const { moduleId } = await publishedModule();
    const courseId = await newCourse([moduleId]);
    const u = await learner();
    const submissionId = await takeModule(u.headers, moduleId);
    await prisma.courseCompletion.deleteMany({ where: { courseId, userId: u.userId } });
    await switchOn();
    await appealOverturned(u.userId, submissionId);
    expect(await statusOf(u.userId, moduleId)).toBe("ACTIVE"); // Vakta mot nedgradering står som før; regelen leser den ikke.
    expect(moduleItem(await courseDetail(u.headers, courseId), moduleId)?.moduleStatus).toBe("IN_PROGRESS");
    await openCertificates(u.headers);
    expect(await certificates(u.userId, courseId)).toEqual([]);
  });

  it("KONTROLL, bryteren av: statusen står, og kursbevis utstedes, slik 2.134.0 gjør (mangel 41)", async () => {
    const { moduleId } = await publishedModule();
    const courseId = await newCourse([moduleId]);
    const u = await learner();
    const submissionId = await takeModule(u.headers, moduleId);
    await prisma.courseCompletion.deleteMany({ where: { courseId, userId: u.userId } });
    await appealOverturned(u.userId, submissionId);
    expect(moduleItem(await courseDetail(u.headers, courseId), moduleId)?.moduleStatus).toBe("PASSED");
    await openCertificates(u.headers);
    expect(await certificates(u.userId, courseId)).toHaveLength(1);
  });

  it("M legges inn i et kurs senere: kravet er Ms nåværende hovedversjon, og en eldre bestått teller ikke der", async () => {
    const { moduleId, versionId, courseId } = await courseWithHolder();
    const u = await learner();
    await decideOn(u.userId, moduleId, versionId, 90);
    await switchOn();
    await majorIn(moduleId, { [courseId]: "minor" }, [courseId]);
    expect(await requirementOf(courseId, moduleId)).toBe(1);
    const later = await newCourse([moduleId]);
    expect(await requirementOf(later, moduleId)).toBe(2);
    expect(moduleItem(await courseDetail(u.headers, later), moduleId)?.moduleStatus).toBe("REVISED_RETAKE_REQUIRED");
    expect(moduleItem(await courseDetail(u.headers, courseId), moduleId)?.moduleStatus).toBe("PASSED");
  });

  it("gammel SUPERSEDED-rad fra #997: ugyldiggjort av tilbakefyllingen, og teller ikke når regelen er på (svar c)", async () => {
    const { moduleId, courseId } = await courseWithHolder();
    const u = await learner();
    await takeModule(u.headers, moduleId);
    const v2 = await newVersion(moduleId);
    expect((await publishOld(moduleId, v2, { supersedesEarlierPasses: true })).status).toBe(200);
    expect(await statusOf(u.userId, moduleId)).toBe("SUPERSEDED");
    await backfillModuleCredit({ moduleIds: [moduleId], userIds: [u.userId] });
    expect((await prisma.modulePass.findMany({ where: { userId: u.userId, moduleId } })).every((row) => row.invalidatedAt !== null)).toBe(true);
    await switchOn();
    expect(moduleItem(await courseDetail(u.headers, courseId), moduleId)?.moduleStatus).toBe("REVISED_RETAKE_REQUIRED");
  });

  it("et kurs som aldri har vært publisert: ikke berørt, og kravet står", async () => {
    const { moduleId, courseId } = await courseWithHolder();
    const draftCourse = await newCourse([moduleId], { publish: false });
    await switchOn();
    const v2 = await newVersion(moduleId);
    // Bare kurset som har vært ute, er med i settet. Et svar for utkastet avvises, så det ikke forsvinner.
    const wrong = await publishVersioned(moduleId, v2, { moduleVersion: "major", courseVersions: { [courseId]: "minor", [draftCourse]: "major" }, expectedCourseIds: [courseId] });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error).toBe("affected_courses_changed");
    await majorIn(moduleId, { [courseId]: "major" }, [courseId]);
    expect(await requirementOf(draftCourse, moduleId)).toBe(1);
    expect(await requirementOf(courseId, moduleId)).toBe(2);
  });

  it("en versjon som har nummer, får ikke ny hovedversjon, og en eldre hovedversjon publiseres ikke: 409 og ingenting skrevet", async () => {
    const { moduleId, versionId, courseId } = await courseWithHolder();
    await switchOn();
    const fixed = await publishVersioned(moduleId, versionId, { moduleVersion: "major", courseVersions: { [courseId]: "major" }, expectedCourseIds: [courseId] });
    expect(fixed.status).toBe(409);
    expect(fixed.body.error).toBe("module_version_number_fixed");
    expect(await versionOf(courseId)).toMatch(/^1\./);
    expect(await requirementOf(courseId, moduleId)).toBe(1);
    const v2 = await majorIn(moduleId, { [courseId]: "major" }, [courseId]);
    const outdated = await publishVersioned(moduleId, versionId, { moduleVersion: "minor" });
    expect(outdated.status).toBe(409);
    expect(outdated.body.error).toBe("module_version_outdated");
    expect(await activeVersionOf(moduleId)).toBe(v2);
  });

  it("samme versjon publisert på nytt som mindre: setter ingenting live, og ingen kursversjon endres", async () => {
    const { moduleId, versionId, courseId } = await courseWithHolder();
    await switchOn();
    const before = await versionOf(courseId);
    const response = await publishVersioned(moduleId, versionId, { moduleVersion: "minor" });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(response.body.courses).toEqual([]);
    expect(await versionOf(courseId)).toBe(before);
  });
});

describe("#934 5a-3: alle tre veiene til et kursbevis bruker regelen", () => {
  /** En som besto på 1.x, i et kurs der kravet nå er 2. En seksjon gjenstår, så lesingen kan bli siste vei inn. */
  async function pendingOnSection() {
    const { moduleId, versionId } = await publishedModule();
    const section = await prisma.courseSection.create({ data: { title: L(tag("seksjon")) }, select: { id: true } });
    const sectionVersion = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 1, bodyMarkdown: L("Tekst."), publishedAt: new Date() }, select: { id: true } });
    await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: sectionVersion.id } });
    const course = await prisma.course.create({
      data: {
        title: L(tag("kurs")), certificationLevel: "basic", publishedAt: new Date(), slug: `a3-${RUN}-${seq++}`,
        items: { create: [{ itemType: "MODULE", moduleId, sortOrder: 0 }, { itemType: "SECTION", sectionId: section.id, sortOrder: 1 }] },
        moduleRequirements: { create: [{ moduleId, minModuleMajor: 2 }] },
      },
      select: { id: true },
    });
    const u = await learner();
    await decideOn(u.userId, moduleId, versionId, 90);
    return { moduleId, versionId, courseId: course.id, sectionId: section.id, u };
  }
  const fromWorker = (userId: string, moduleId: string) =>
    deliverOutboxEvent({ type: OUTBOX_EVENT_TYPES.courseCompletionCheck, payloadJson: JSON.stringify({ userId, moduleId }) });

  it("krav 2 og bestått på 1.x: lesingen, workeren og kursbevissiden utsteder ingenting. Etter bestått på 2.x gjør de det", async () => {
    const { moduleId, courseId, sectionId, u } = await pendingOnSection();
    await switchOn();
    expect((await readSection(app, u.headers, courseId, sectionId)).status).toBe(204);
    expect(await certificates(u.userId, courseId)).toEqual([]);
    await fromWorker(u.userId, moduleId);
    expect(await certificates(u.userId, courseId)).toEqual([]);
    await openCertificates(u.headers);
    expect(await certificates(u.userId, courseId)).toEqual([]);

    const version = await prisma.moduleVersion.create({ data: { moduleId, versionNo: 9, assessmentMode: "MCQ_ONLY", taskText: L("Ny"), publishedAt: new Date(), versionMajor: 2, versionMinor: 0 }, select: { id: true } });
    await decideOn(u.userId, moduleId, version.id, 90);
    await fromWorker(u.userId, moduleId);
    expect(await certificates(u.userId, courseId)).toHaveLength(1);
  });

  it("KONTROLL, bryteren av: lesingen gir beviset, slik 2.134.0 gjør", async () => {
    const { courseId, sectionId, u } = await pendingOnSection();
    expect((await readSection(app, u.headers, courseId, sectionId)).status).toBe(204);
    expect(await certificates(u.userId, courseId)).toHaveLength(1);
  });

  it("KONTROLL, bryteren av: workeren gir beviset, slik 2.134.0 gjør", async () => {
    const { moduleId, courseId, sectionId, u } = await pendingOnSection();
    await prisma.courseSectionRead.create({ data: { userId: u.userId, courseId, sectionId } });
    await fromWorker(u.userId, moduleId);
    expect(await certificates(u.userId, courseId)).toHaveLength(1);
  });
});

describe("#934 5a-3 bevis: «Publiser nye versjoner» med svar per kurs", () => {
  /**
   * To moduler i tre kurs. A har M1 og M2, B har M1, C har M2. Noen har kursbevis i alle tre. Begge modulene har en ny versjon klar.
   */
  async function threeCourses() {
    const m1 = await publishedModule();
    const m2 = await publishedModule();
    const a = await newCourse([m1.moduleId, m2.moduleId]);
    const b = await newCourse([m1.moduleId]);
    const c = await newCourse([m2.moduleId]);
    const holder = await learner();
    await takeModule(holder.headers, m1.moduleId);
    await takeModule(holder.headers, m2.moduleId);
    await openCertificates(holder.headers);
    for (const courseId of [a, b, c]) expect(await certificates(holder.userId, courseId)).toHaveLength(1);
    const v1 = await newVersion(m1.moduleId);
    const v2 = await newVersion(m2.moduleId);
    return { m1, m2, a, b, c, holder, versionIds: [v1, v2], v1, v2 };
  }

  it("to moduler og tre kurs: hvert kurs økes én gang, ett øyeblikksbilde per kurs, og kravet heves bare der kurset fikk hovedversjon", async () => {
    const { m1, m2, a, b, c, holder, versionIds, v1, v2 } = await threeCourses();
    await switchOn();
    const before = { a: await versionOf(a), b: await versionOf(b), c: await versionOf(c) };

    const preview = await request(app).get(`/api/admin/content/courses/${a}/pending-versions`).set(admin());
    expect(preview.status).toBe(200);
    const shown = preview.body.affectedCourses as Array<{ courseId: string; certificateHolders: number; majorEmailRecipients: number; published: boolean; title: string }>;
    expect(shown.map((row) => row.courseId).sort()).toEqual([a, b, c].sort());
    for (const row of shown) expect(row).toMatchObject({ certificateHolders: 1, majorEmailRecipients: 1, published: true });
    expect(shown[0].title).not.toContain("{");

    const response = await pendingVersioned(a, {
      versionIds,
      courseVersions: { [a]: "major", [b]: "minor", [c]: "minor" },
      expectedCourseIds: [a, b, c],
    });
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
    expect(response.body.publishedItems).toHaveLength(2);

    // Begge modulene fikk hovedversjon, for A fikk hovedversjon på grunn av dem.
    expect([await numberOf(v1), await numberOf(v2)]).toEqual(["2.0", "2.0"]);
    expect([await requirementOf(a, m1.moduleId), await requirementOf(a, m2.moduleId), await requirementOf(b, m1.moduleId), await requirementOf(c, m2.moduleId)]).toEqual([2, 2, 1, 1]);

    // Hvert kurs økt NØYAKTIG én gang.
    const minorPlusOne = (from: string) => `${from.split(".")[0]}.${Number(from.split(".")[1]) + 1}`;
    expect(await versionOf(a)).toBe("2.0");
    expect(await versionOf(b)).toBe(minorPlusOne(before.b));
    expect(await versionOf(c)).toBe(minorPlusOne(before.c));
    expect(await prisma.courseVersion.count({ where: { courseId: a } })).toBe(2);
    expect(await prisma.courseVersion.count({ where: { courseId: b } })).toBe(0);
    expect(await prisma.courseVersion.count({ where: { courseId: c } })).toBe(0);
    expect(await prisma.courseVersion.count({ where: { courseId: a, versionMajor: 2, changedItemCount: 2 } })).toBe(1);
    const raised = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: a, action: auditActions.course.versionChanged }, orderBy: { timestamp: "desc" } });
    expect(JSON.parse(raised.metadataJson).raisedModuleIds.sort()).toEqual([m1.moduleId, m2.moduleId].sort());

    // E-post bare i kurset som fikk hovedversjon. Og deltakeren beholder beståtten i B og C.
    expect(await prisma.courseVersionNotice.count({ where: { courseId: a, versionMajor: 2 } })).toBe(1);
    expect(await prisma.courseVersionNotice.count({ where: { courseId: { in: [b, c] } } })).toBe(0);
    expect(moduleItem(await courseDetail(holder.headers, b), m1.moduleId)?.moduleStatus).toBe("PASSED");
    expect(moduleItem(await courseDetail(holder.headers, c), m2.moduleId)?.moduleStatus).toBe("PASSED");
    expect(moduleItem(await courseDetail(holder.headers, a), m1.moduleId)?.moduleStatus).toBe("REVISED_RETAKE_REQUIRED");
    expect(await statusOf(holder.userId, m1.moduleId)).toBe("ACTIVE");
    expect(await revisedMails(m1.moduleId)).toBe(0);
  });

  it("alle kursene svarer mindre: modulene får mindre versjon, og ingen krav heves", async () => {
    const { m1, m2, a, b, c, versionIds, v1, v2 } = await threeCourses();
    await switchOn();
    const response = await pendingVersioned(a, { versionIds, courseVersions: { [a]: "minor", [b]: "minor", [c]: "minor" }, expectedCourseIds: [a, b, c] });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect([await numberOf(v1), await numberOf(v2)]).toEqual(["1.1", "1.1"]);
    expect([await requirementOf(a, m1.moduleId), await requirementOf(c, m2.moduleId)]).toEqual([1, 1]);
  });

  it("modulen får hovedversjon bare når et kurs SOM HAR DEN får hovedversjon: B hoved gir M1 2.0, men M2 står som mindre", async () => {
    const { m1, m2, a, b, c, versionIds, v1, v2 } = await threeCourses();
    await switchOn();
    const response = await pendingVersioned(a, { versionIds, courseVersions: { [a]: "minor", [b]: "major", [c]: "minor" }, expectedCourseIds: [a, b, c] });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect([await numberOf(v1), await numberOf(v2)]).toEqual(["2.0", "1.1"]);
    expect([await requirementOf(a, m1.moduleId), await requirementOf(b, m1.moduleId), await requirementOf(a, m2.moduleId), await requirementOf(c, m2.moduleId)]).toEqual([1, 2, 1, 1]);
    expect(await versionOf(b)).toBe("2.0");
  });

  it("mangler et svar for et kurs med kursbevis: 400 med kursene, og ingenting er skrevet", async () => {
    const { m1, a, b, c, versionIds, v1 } = await threeCourses();
    await switchOn();
    const before = await versionOf(a);
    const response = await pendingVersioned(a, { versionIds, courseVersions: { [a]: "major" }, expectedCourseIds: [a, b, c] });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("course_version_required");
    expect(response.body.details.courses.map((row: { courseId: string }) => row.courseId).sort()).toEqual([b, c].sort());
    expect(await numberOf(v1)).toBeNull();
    expect(await activeVersionOf(m1.moduleId)).toBe(m1.versionId);
    expect(await versionOf(a)).toBe(before);
    expect(await requirementOf(a, m1.moduleId)).toBe(1);
  });

  it("andre versjoner enn dialogen viste, eller feil sett av kurs: 409 og ingenting er skrevet", async () => {
    const { m1, a, b, c, versionIds, v1 } = await threeCourses();
    await switchOn();
    const answers = { [a]: "minor", [b]: "minor", [c]: "minor" };
    const stale = await pendingVersioned(a, { versionIds: [v1], courseVersions: answers, expectedCourseIds: [a, b, c] });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("pending_versions_changed");
    const wrongSet = await pendingVersioned(a, { versionIds, courseVersions: answers, expectedCourseIds: [a, b] });
    expect(wrongSet.status).toBe(409);
    expect(wrongSet.body.error).toBe("affected_courses_changed");
    expect(await activeVersionOf(m1.moduleId)).toBe(m1.versionId);
  });

  it("modulen lagt inn i et fjerde kurs mens publiseringen venter på låsen: den venter, ser det, og svarer 409. Ingenting er publisert", async () => {
    const { m1, a, b, c, versionIds } = await threeCourses();
    const d = await newCourse([], { publish: false });
    await prisma.course.update({ where: { id: d }, data: { publishedAt: new Date() } });
    const dHolder = await learner();
    await prisma.courseCompletion.create({ data: { userId: dHolder.userId, courseId: d, versionMajor: 1, versionMinor: 0, moduleSnapshotJson: "[]" } });
    await switchOn();
    const lock = holdContent();
    await lock.held;
    const publishing = pendingVersioned(a, { versionIds, courseVersions: { [a]: "minor", [b]: "minor", [c]: "minor" }, expectedCourseIds: [a, b, c] }).then((r) => r);
    expect(await stillWaiting(publishing)).toBe(true);
    lock.release(async (tx) => {
      await tx.courseItem.create({ data: { courseId: d, itemType: "MODULE", moduleId: m1.moduleId, sortOrder: 0 } });
    });
    await lock.done;
    const response = await publishing;
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("affected_courses_changed");
    expect(await activeVersionOf(m1.moduleId)).toBe(m1.versionId);
  });

  it("modulen lagt inn i et fjerde kurs etter publiseringen: kravet er den nye hovedversjonen, og kurset kommer med i neste runde", async () => {
    const { m1, a, b, c, versionIds } = await threeCourses();
    await switchOn();
    const response = await pendingVersioned(a, { versionIds, courseVersions: { [a]: "major", [b]: "minor", [c]: "minor" }, expectedCourseIds: [a, b, c] });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    const d = await newCourse([m1.moduleId]);
    expect(await requirementOf(d, m1.moduleId)).toBe(2);
    const preview = await request(app).get(`/api/admin/content/modules/${m1.moduleId}/module-versions/${m1.versionId}/publish-preview-versioned`).set(admin());
    expect((preview.body.courses as Array<{ courseId: string }>).map((row) => row.courseId)).toContain(d);
  });

  it("en seksjon delt med et annet kurs: det kurset er berørt og må svares for. Modulene heves ikke av en seksjon", async () => {
    const m = await publishedModule();
    const section = await prisma.courseSection.create({ data: { title: L(tag("seksjon")) }, select: { id: true } });
    const sv1 = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 1, bodyMarkdown: L("Tekst."), publishedAt: new Date() }, select: { id: true } });
    await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: sv1.id } });
    const makeCourse = async (withModule: boolean) => {
      const course = await prisma.course.create({
        data: {
          title: L(tag("kurs")), certificationLevel: "basic", publishedAt: new Date(), slug: `a3-${RUN}-${seq++}`,
          items: { create: [...(withModule ? [{ itemType: "MODULE" as const, moduleId: m.moduleId, sortOrder: 1 }] : []), { itemType: "SECTION" as const, sectionId: section.id, sortOrder: 0 }] },
          ...(withModule ? { moduleRequirements: { create: [{ moduleId: m.moduleId, minModuleMajor: 1 }] } } : {}),
        },
        select: { id: true },
      });
      const holder = await learner();
      await prisma.courseCompletion.create({ data: { userId: holder.userId, courseId: course.id, versionMajor: 1, versionMinor: 0, moduleSnapshotJson: "[]" } });
      return course.id;
    };
    const a = await makeCourse(true);
    const b = await makeCourse(false);
    const sv2 = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 2, bodyMarkdown: L("Ny tekst.") }, select: { id: true } });
    await switchOn();
    const missing = await pendingVersioned(a, { versionIds: [sv2.id], courseVersions: { [a]: "major" }, expectedCourseIds: [a] });
    expect(missing.status).toBe(409);
    const response = await pendingVersioned(a, { versionIds: [sv2.id], courseVersions: { [a]: "major", [b]: "minor" }, expectedCourseIds: [a, b] });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(await versionOf(a)).toBe("2.0");
    expect(await versionOf(b)).toBe("1.1");
    expect(await requirementOf(a, m.moduleId)).toBe(1);
  });

  it("over 200 mottakere i ett kurs: bekreftelsen gjelder per kurs, uten den 409, og ingenting er publisert", async () => {
    const { m1, a, b, c, versionIds } = await threeCourses();
    const stamp = `${RUN}-${seq++}`;
    const data = Array.from({ length: 201 }, (_, i) => ({ externalId: `a3-many-${stamp}-${i}`, email: `a3.many.${stamp}.${i}@x.test`, name: "Mange" }));
    await prisma.user.createMany({ data });
    const users = await prisma.user.findMany({ where: { externalId: { startsWith: `a3-many-${stamp}-` } }, select: { id: true } });
    await prisma.courseCompletion.createMany({ data: users.map((user) => ({ userId: user.id, courseId: a, versionMajor: 1, versionMinor: 0, moduleSnapshotJson: "[]" })) });
    await switchOn();
    const answers = { [a]: "major", [b]: "minor", [c]: "minor" };
    const refused = await pendingVersioned(a, { versionIds, courseVersions: answers, expectedCourseIds: [a, b, c], confirmEmailRecipients: { [b]: 500 } });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("major_email_confirm_required");
    expect(await activeVersionOf(m1.moduleId)).toBe(m1.versionId);
    expect(await requirementOf(a, m1.moduleId)).toBe(1);
    const accepted = await pendingVersioned(a, { versionIds, courseVersions: answers, expectedCourseIds: [a, b, c], confirmEmailRecipients: { [a]: 202 } });
    expect(accepted.status, JSON.stringify(accepted.body).slice(0, 300)).toBe(200);
    expect(await prisma.courseVersionNotice.count({ where: { courseId: a, versionMajor: 2 } })).toBe(202);
  });
});

describe("#934 5a-3: modulens egen dialog", () => {
  it("mindre for modulen: mindre i alle kurs, uten spørsmål, også med kursbevis", async () => {
    const { moduleId, a, b } = await twoCoursesWithCertificates();
    await switchOn();
    const [fromA, fromB] = [await versionOf(a), await versionOf(b)];
    const v2 = await newVersion(moduleId);
    const response = await publishVersioned(moduleId, v2, { moduleVersion: "minor" });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(await versionOf(a)).not.toBe(fromA);
    expect(await versionOf(a)).toMatch(/^1\./);
    expect(await versionOf(b)).not.toBe(fromB);
    expect([await requirementOf(a, moduleId), await requirementOf(b, moduleId)]).toEqual([1, 1]);
  });

  it("mindre for modulen med «hoved» for et kurs: 400, så valget ikke forsvinner", async () => {
    const { moduleId, a } = await twoCoursesWithCertificates();
    await switchOn();
    const v2 = await newVersion(moduleId);
    const response = await publishVersioned(moduleId, v2, { moduleVersion: "minor", courseVersions: { [a]: "major" } });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("validation_error");
    expect(await activeVersionOf(moduleId)).not.toBe(v2);
  });

  it("hoved for modulen uten svar for et kurs med kursbevis: 400 med kursene, og ingenting er skrevet", async () => {
    const { moduleId, a, b } = await twoCoursesWithCertificates();
    await switchOn();
    const v2 = await newVersion(moduleId);
    const response = await publishVersioned(moduleId, v2, { moduleVersion: "major", courseVersions: { [a]: "major" }, expectedCourseIds: [a, b] });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("course_version_required");
    expect(await activeVersionOf(moduleId)).not.toBe(v2);
    expect(await numberOf(v2)).toBeNull();
    expect(await requirementOf(a, moduleId)).toBe(1);
  });

  it("feil sett av kurs, et svar for et kurs som ikke er berørt, og et felt serveren ikke kjenner: avvist, og ingenting er skrevet", async () => {
    const { moduleId, a, b } = await twoCoursesWithCertificates();
    const stranger = await newCourse([(await publishedModule()).moduleId]);
    await switchOn();
    const v2 = await newVersion(moduleId);
    const answers = { [a]: "minor", [b]: "minor" };
    const noList = await publishVersioned(moduleId, v2, { moduleVersion: "major", courseVersions: answers });
    expect(noList.status).toBe(400);
    const wrongSet = await publishVersioned(moduleId, v2, { moduleVersion: "major", courseVersions: answers, expectedCourseIds: [a] });
    expect(wrongSet.status).toBe(409);
    expect(wrongSet.body.error).toBe("affected_courses_changed");
    const unknown = await publishVersioned(moduleId, v2, { moduleVersion: "major", courseVersions: { ...answers, [stranger]: "major" }, expectedCourseIds: [a, b] });
    expect(unknown.status).toBe(409);
    expect(unknown.body.error).toBe("affected_courses_changed");
    const extraField = await publishVersioned(moduleId, v2, { moduleVersion: "minor", supersedesEarlierPasses: true });
    expect(extraField.status).toBe(400);
    expect(await activeVersionOf(moduleId)).not.toBe(v2);
  });

  it("forhåndsvisningen lister kursene med tallene publiseringen bruker, også et avpublisert kurs, men ikke et utkast", async () => {
    const { moduleId, versionId, a, b } = await twoCoursesWithCertificates();
    const draftCourse = await newCourse([moduleId], { publish: false });
    expect((await request(app).post(`/api/admin/content/courses/${b}/unpublish`).set(admin())).status).toBe(200);
    await switchOn();
    const response = await request(app).get(`/api/admin/content/modules/${moduleId}/module-versions/${versionId}/publish-preview-versioned`).set(admin());
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(response.body.currentMajor).toBe(1);
    expect(response.body.anyonePassed).toBe(true);
    const nobody = await publishedModule();
    const none = await request(app).get(`/api/admin/content/modules/${nobody.moduleId}/module-versions/${nobody.versionId}/publish-preview-versioned`).set(admin());
    expect(none.body.anyonePassed).toBe(false);
    const rows = response.body.courses as Array<{ courseId: string; certificateHolders: number; majorEmailRecipients: number; published: boolean; title: string }>;
    expect(rows.map((row) => row.courseId).sort()).toEqual([a, b].sort());
    expect(rows.map((row) => row.courseId)).not.toContain(draftCourse);
    expect(rows.find((row) => row.courseId === a)).toMatchObject({ certificateHolders: 1, majorEmailRecipients: 1, published: true });
    expect(rows.find((row) => row.courseId === b)).toMatchObject({ certificateHolders: 1, majorEmailRecipients: 1, published: false });
    expect(rows[0].title).not.toContain("{");
    const missing = await request(app).get(`/api/admin/content/modules/${moduleId}/module-versions/finnes-ikke/publish-preview-versioned`).set(admin());
    expect(missing.status).toBe(404);
  });

  it("rolle og eierskap: en deltaker og en fagansvarlig som ikke eier modulen eller kurset, får ikke se eller publisere", async () => {
    const { moduleId, versionId, a, u } = await twoCoursesWithCertificates();
    await switchOn();
    const smo = { "x-user-id": `a3-smo-${RUN}`, "x-user-email": `a3.smo.${RUN}@x.test`, "x-user-name": "Fagansvarlig", "x-user-roles": "SUBJECT_MATTER_OWNER", "x-locale": "nb" };
    const v2 = await newVersion(moduleId);
    for (const [headers, status] of [[u.headers, 403], [smo, 403]] as const) {
      expect((await request(app).get(`/api/admin/content/modules/${moduleId}/module-versions/${versionId}/publish-preview-versioned`).set(headers)).status).toBe(status);
      expect((await publishVersioned(moduleId, v2, { moduleVersion: "minor" }, headers)).status).toBe(status);
      expect((await pendingVersioned(a, { versionIds: [v2], expectedCourseIds: [a] }, headers)).status).toBe(status);
    }
    expect(await activeVersionOf(moduleId)).not.toBe(v2);
  });
});

describe("#934 5a-3 bevis: de nye endepunktene før bryteren", () => {
  it("alle fire svarer 409 module_versioning_not_active, og ingenting er skrevet", async () => {
    const { moduleId, a, b } = await twoCoursesWithCertificates();
    const v2 = await newVersion(moduleId);
    const before = await versionOf(a);
    const body = { moduleVersion: "major", courseVersions: { [a]: "major", [b]: "minor" }, expectedCourseIds: [a, b] };
    for (const response of [
      await publishVersioned(moduleId, v2, body),
      await publishVersioned(moduleId, v2, { moduleVersion: "minor" }),
      await request(app).get(`/api/admin/content/modules/${moduleId}/module-versions/${v2}/publish-preview-versioned`).set(admin()),
      await pendingVersioned(a, { versionIds: [v2], courseVersions: { [a]: "major", [b]: "minor" }, expectedCourseIds: [a, b] }),
    ]) {
      expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(409);
      expect(response.body.error).toBe("module_versioning_not_active");
    }
    expect(await numberOf(v2)).toBeNull();
    expect(await activeVersionOf(moduleId)).not.toBe(v2);
    expect(await versionOf(a)).toBe(before);
    expect(await requirementOf(a, moduleId)).toBe(1);
  });

  it("sjekken etter låsen avgjør: tjenestene nekter selv, uten ruta foran", async () => {
    const { moduleId, a, b } = await twoCoursesWithCertificates();
    const v2 = await newVersion(moduleId);
    await expect(publishModuleVersioned(moduleId, v2, "actor", { moduleVersion: "minor" })).rejects.toMatchObject({ code: "module_versioning_not_active" });
    await expect(
      publishCoursePendingVersioned(a, { userId: "actor", roles: ["ADMINISTRATOR"] }, { versionIds: [v2], expectedCourseIds: [a, b] }),
    ).rejects.toMatchObject({ code: "module_versioning_not_active" });
    expect(await activeVersionOf(moduleId)).not.toBe(v2);
  });
});

describe("#934 5a-3 bevis: «Publiser kurs» med en modul som har vært publisert før", () => {
  async function unpublishedWithNewDraft() {
    const { moduleId, versionId } = await publishedModule();
    expect((await request(app).post(`/api/admin/content/modules/${moduleId}/unpublish`).set(admin())).status).toBe(200);
    const v2 = await newVersion(moduleId);
    const courseId = await newCourse([moduleId], { publish: false });
    return { moduleId, versionId, v2, courseId };
  }
  const publishCourse = (courseId: string) => request(app).post(`/api/admin/content/courses/${courseId}/publish`).set(admin()).send({ publishItems: true });

  it("en modul som har vært ute uten nummer (gammel kode): også 409", async () => {
    const { moduleId, courseId } = await unpublishedWithNewDraft();
    await prisma.moduleVersion.updateMany({ where: { moduleId }, data: { versionMajor: null, versionMinor: null } });
    await switchOn();
    const response = await publishCourse(courseId);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("course_publish_has_republished_modules");
  });

  it("avpublisert modul, nytt utkast, «Publiser kurs»: 409 med modulene, og ingenting er publisert", async () => {
    const { moduleId, v2, courseId } = await unpublishedWithNewDraft();
    await switchOn();
    const response = await publishCourse(courseId);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("course_publish_has_republished_modules");
    const modules = response.body.details.modules;
    expect(modules.map((row: { moduleId: string }) => row.moduleId)).toEqual([moduleId]);
    expect(await activeVersionOf(moduleId)).toBeNull();
    expect(await numberOf(v2)).toBeNull();
    expect((await prisma.course.findUniqueOrThrow({ where: { id: courseId } })).publishedAt).toBeNull();
  });

  it("KONTROLL, bryteren av: kurset og modulen publiseres, slik 2.134.0 gjør", async () => {
    const { moduleId, v2, courseId } = await unpublishedWithNewDraft();
    const response = await publishCourse(courseId);
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(await activeVersionOf(moduleId)).toBe(v2);
    expect((await prisma.course.findUniqueOrThrow({ where: { id: courseId } })).publishedAt).not.toBeNull();
  });

  it("en modul som aldri har vært publisert, og en seksjon, går som før med bryteren på", async () => {
    const created = await request(app).post("/api/admin/content/modules").set(admin()).send({ title: T(tag("ny modul")), certificationLevel: "basic" });
    const moduleId = created.body.module.id as string;
    const v1 = await newVersion(moduleId);
    const courseId = await newCourse([moduleId], { publish: false });
    await switchOn();
    const response = await publishCourse(courseId);
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(await activeVersionOf(moduleId)).toBe(v1);
    expect(await numberOf(v1)).toBe("1.0");
  });
});

describe("#934 5a-3 bevis: de gamle kontraktene etter bryteren", () => {
  it("modulpublisering med avkrysning: 409 client_outdated, og ingenting er skrevet", async () => {
    const { moduleId, a, b, u } = await twoCoursesWithCertificates();
    await switchOn();
    const [fromA, fromB] = [await versionOf(a), await versionOf(b)];
    const v2 = await newVersion(moduleId);
    const response = await publishOld(moduleId, v2, { supersedesEarlierPasses: true });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("client_outdated");
    expect(await activeVersionOf(moduleId)).not.toBe(v2);
    expect(await numberOf(v2)).toBeNull();
    expect(await statusOf(u.userId, moduleId)).toBe("ACTIVE");
    expect(await revisedMails(moduleId)).toBe(0);
    expect(await prisma.auditEvent.count({ where: { entityId: moduleId, action: auditActions.adminContent.modulePassesSuperseded } })).toBe(0);
    expect([await versionOf(a), await versionOf(b)]).toEqual([fromA, fromB]);
    expect([await requirementOf(a, moduleId), await requirementOf(b, moduleId)]).toEqual([1, 1]);
  });

  for (const body of [{}, { supersedesEarlierPasses: false }]) {
    it(`modulpublisering med ${JSON.stringify(body)}: mindre i alle kurs, som i dag, og beståtten står`, async () => {
      const { moduleId, a, b, u } = await twoCoursesWithCertificates();
      await switchOn();
      const fromA = await versionOf(a);
      const v2 = await newVersion(moduleId);
      const response = await publishOld(moduleId, v2, body);
      expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
      expect(await numberOf(v2)).toBe("1.1");
      expect(await versionOf(a)).not.toBe(fromA);
      expect(await versionOf(a)).toMatch(/^1\./);
      expect(moduleItem(await courseDetail(u.headers, b), moduleId)?.moduleStatus).toBe("PASSED");
    });
  }

  /** Ett kurs med kursbevis og en modul med ny versjon klar. Et annet kurs har modulen, uten kursbevis. */
  async function pendingOldContract() {
    const { moduleId, versionId } = await publishedModule();
    const a = await newCourse([moduleId]);
    const u = await learner();
    await takeModule(u.headers, moduleId);
    await openCertificates(u.headers);
    const b = await newCourse([moduleId]);
    const v2 = await newVersion(moduleId);
    return { moduleId, versionId, a, b, u, v2 };
  }
  const pendingOld = (courseId: string, body: Record<string, unknown>) =>
    request(app).post(`/api/admin/content/courses/${courseId}/publish-pending`).set(admin()).send(body);

  it("«Publiser nye versjoner» på det gamle endepunktet med avkrysning: 409 client_outdated, og ingenting er skrevet", async () => {
    const { moduleId, a, u, v2 } = await pendingOldContract();
    await switchOn();
    const response = await pendingOld(a, { versionIds: [v2], supersedesEarlierPasses: true, courseVersion: "minor" });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("client_outdated");
    expect(await activeVersionOf(moduleId)).not.toBe(v2);
    expect(await statusOf(u.userId, moduleId)).toBe("ACTIVE");
  });

  it("det gamle endepunktet, og et annet kurs med kursbevis er berørt: 409 client_outdated, og ingenting er skrevet", async () => {
    const { moduleId, a, b, v2 } = await pendingOldContract();
    const other = await learner();
    await prisma.courseCompletion.create({ data: { userId: other.userId, courseId: b, versionMajor: 1, versionMinor: 0, moduleSnapshotJson: "[]" } });
    await switchOn();
    const response = await pendingOld(a, { versionIds: [v2], courseVersion: "minor" });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("client_outdated");
    expect(await activeVersionOf(moduleId)).not.toBe(v2);
    expect(await versionOf(a)).toMatch(/^1\./);
  });

  it("det gamle endepunktet, hovedversjon av kurset med en ny modul: 409 client_outdated, for valget kan ikke heve kravet per kurs", async () => {
    const { moduleId, a, u, v2 } = await pendingOldContract();
    await switchOn();
    const response = await pendingOld(a, { versionIds: [v2], courseVersion: "major" });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("client_outdated");
    expect(await activeVersionOf(moduleId)).not.toBe(v2);
    expect(await versionOf(a)).toMatch(/^1\./);
    expect(await statusOf(u.userId, moduleId)).toBe("ACTIVE");
  });

  it("det gamle endepunktet, hovedversjon med bare en seksjon i settet: går som før", async () => {
    const section = await prisma.courseSection.create({ data: { title: L(tag("seksjon")) }, select: { id: true } });
    const active = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 1, bodyMarkdown: L("Tekst."), publishedAt: new Date() }, select: { id: true } });
    await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: active.id } });
    const next = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 2, bodyMarkdown: L("Ny tekst.") }, select: { id: true } });
    const course = await prisma.course.create({
      data: { title: L(tag("kurs")), certificationLevel: "basic", publishedAt: new Date(), slug: `a3-${RUN}-${seq++}`, items: { create: [{ itemType: "SECTION", sectionId: section.id, sortOrder: 0 }] } },
      select: { id: true },
    });
    const holder = await learner();
    await prisma.courseCompletion.create({ data: { userId: holder.userId, courseId: course.id, versionMajor: 1, versionMinor: 0, moduleSnapshotJson: "[]" } });
    await switchOn();
    const response = await pendingOld(course.id, { versionIds: [next.id], courseVersion: "major", confirmEmailRecipients: 1 });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(await versionOf(course.id)).toBe("2.0");
  });

  it("det gamle endepunktet ellers: publisert med `courseVersion` for dette kurset, modulen blir mindre, og ingen mister en bestått", async () => {
    const { moduleId, a, b, u, v2 } = await pendingOldContract();
    await switchOn();
    const before = await versionOf(b);
    const response = await pendingOld(a, { versionIds: [v2], courseVersion: "minor" });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(await activeVersionOf(moduleId)).toBe(v2);
    expect(await numberOf(v2)).toBe("1.1");
    expect(await versionOf(a)).toMatch(/^1\./);
    expect(await versionOf(b)).not.toBe(before);
    expect(await versionOf(b)).toMatch(/^1\./);
    expect(await requirementOf(a, moduleId)).toBe(1);
    expect(moduleItem(await courseDetail(u.headers, a), moduleId)?.moduleStatus).toBe("PASSED");
    expect(await statusOf(u.userId, moduleId)).toBe("ACTIVE");
  });

  it("KONTROLL, bryteren av: uten svar 400 revision_answer_required, og med avkrysning går det, slik 2.134.0 gjør", async () => {
    const { moduleId, a, u, v2 } = await pendingOldContract();
    const missing = await pendingOld(a, { versionIds: [v2], courseVersion: "minor" });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("revision_answer_required");
    const response = await pendingOld(a, { versionIds: [v2], courseVersion: "minor", supersedesEarlierPasses: true });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(await numberOf(v2)).toBe("2.0");
    expect(await statusOf(u.userId, moduleId)).toBe("SUPERSEDED");
  });
});

describe("#934 5a-3: hull mutasjonene viste", () => {
  it("et kurs uten kursbevis trenger ikke svar: dialogen fra 5b sender ingen, og publiseringen går", async () => {
    const { moduleId, a, b, u } = await twoCoursesWithCertificates();
    expect(u.userId).toBeTruthy();
    const withoutCertificates = await newCourse([moduleId]);
    await switchOn();
    await majorIn(moduleId, { [a]: "major", [b]: "minor" }, [a, b, withoutCertificates]);
    expect(await requirementOf(a, moduleId)).toBe(2);
    expect(await requirementOf(withoutCertificates, moduleId)).toBe(1);
  });

  it("kravet senkes aldri: en hovedversjon under et krav som står høyere, rører det ikke", async () => {
    const { moduleId, a, b } = await twoCoursesWithCertificates();
    await prisma.courseModuleRequirement.update({ where: { courseId_moduleId: { courseId: a, moduleId } }, data: { minModuleMajor: 7 } });
    await switchOn();
    await majorIn(moduleId, { [a]: "major", [b]: "minor" }, [a, b]);
    expect(await requirementOf(a, moduleId)).toBe(7);
  });

  it("et kurs uten krav får det når det får hovedversjon", async () => {
    const { moduleId, a, b } = await twoCoursesWithCertificates();
    await prisma.courseModuleRequirement.delete({ where: { courseId_moduleId: { courseId: a, moduleId } } });
    await switchOn();
    await majorIn(moduleId, { [a]: "major", [b]: "minor" }, [a, b]);
    expect(await requirementOf(a, moduleId)).toBe(2);
  });

  it("publiseringsporten gjelder også det nye endepunktet: 422, og ingenting er publisert", async () => {
    const { moduleId } = await publishedModule();
    const active = await activeVersionOf(moduleId);
    const set = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`).set(admin()).send({
      title: T("Sett"),
      questions: [{ stem: { nb: "Bare på bokmål?" }, options: [T("Riktig"), T("Galt")], correctAnswer: T("Riktig"), rationale: T("Fordi.") }],
    });
    expect(set.status, JSON.stringify(set.body).slice(0, 300)).toBe(201);
    const version = await request(app).post(`/api/admin/content/modules/${moduleId}/module-versions`).set(admin()).send({
      assessmentMode: "MCQ_ONLY",
      mcqSetVersionId: set.body.mcqSetVersion.id,
    });
    expect(version.status, JSON.stringify(version.body).slice(0, 300)).toBe(201);
    await switchOn();
    const response = await publishVersioned(moduleId, version.body.moduleVersion.id, { moduleVersion: "minor" });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(422);
    expect(response.body.error).toBe("publish_blocked_by_validation");
    expect(await activeVersionOf(moduleId)).toBe(active);
  });
});

describe("#934 5a-3: kursrapporten", () => {
  const summary = async (courseId: string) => {
    const response = await request(app).get("/api/reports/courses").query({ courseId }).set(READER);
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    return response.body.rows.find((row: { courseId: string }) => row.courseId === courseId) as { moduleBreakdown: Array<{ moduleId: string; passedUsers: number }> };
  };
  const learners = async (courseId: string) => {
    const response = await request(app).get("/api/reports/courses/details").query({ selectedCourseId: courseId }).set(READER);
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    return response.body.rows as Array<{ participantId: string; status: string; passedModules: number }>;
  };

  it("datovinduet gjelder også med den nye regelen: en bestått utenfor vinduet telles ikke", async () => {
    const { moduleId, a, u } = await twoCoursesWithCertificates();
    // Tildelt, så deltakeren er med i rapporten uansett vinduet. Da er det vinduet på beståtten som avgjør tallet.
    await prisma.courseEnrollment.create({ data: { userId: u.userId, courseId: a, source: "SELF" } });
    await switchOn();
    const within = async (dateFrom: string) => {
      const response = await request(app).get("/api/reports/courses").query({ courseId: a, dateFrom }).set(READER);
      expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
      const row = response.body.rows.find((one: { courseId: string }) => one.courseId === a) as { moduleBreakdown: Array<{ moduleId: string; passedUsers: number }> };
      return row.moduleBreakdown.find((one) => one.moduleId === moduleId)?.passedUsers;
    };
    expect(await within("2000-01-01T00:00:00.000Z")).toBe(1);
    expect(await within("2999-01-01T00:00:00.000Z")).toBe(0);
  });

  it("per kurs: i A står deltakeren som «må ta ny versjon» og uten bestått modul, i B er hen fullført", async () => {
    const { moduleId, a, b, u } = await twoCoursesWithCertificates();
    await switchOn();
    await majorIn(moduleId, { [a]: "major", [b]: "minor" }, [a, b]);
    expect((await summary(a)).moduleBreakdown.find((row) => row.moduleId === moduleId)?.passedUsers).toBe(0);
    expect((await summary(b)).moduleBreakdown.find((row) => row.moduleId === moduleId)?.passedUsers).toBe(1);
    expect((await learners(a)).find((row) => row.participantId === u.userId)).toMatchObject({ status: "NEEDS_NEW_VERSION", passedModules: 0 });
    expect((await learners(b)).find((row) => row.participantId === u.userId)).toMatchObject({ status: "COMPLETED", passedModules: 1 });
  });

  it("KONTROLL, bryteren av: rapporten leser modulstatusen, slik 2.134.0 gjør. Et stryk etter bestått tar den bort fra begge kurs", async () => {
    const { moduleId, a, b, u } = await twoCoursesWithCertificates();
    expect((await summary(a)).moduleBreakdown.find((row) => row.moduleId === moduleId)?.passedUsers).toBe(1);
    await takeModule(u.headers, moduleId, { pass: false });
    for (const courseId of [a, b]) {
      expect((await summary(courseId)).moduleBreakdown.find((row) => row.moduleId === moduleId)?.passedUsers).toBe(0);
      expect((await learners(courseId)).find((row) => row.participantId === u.userId)?.passedModules).toBe(0);
    }
  });

  it("vinduet gjelder vedtaket som teller: en bestått utenfor perioden telles ikke med bryteren på", async () => {
    const { moduleId, b } = await twoCoursesWithCertificates();
    await switchOn();
    const inside = await request(app).get("/api/reports/courses").query({ courseId: b, dateFrom: new Date(Date.now() - 3_600_000).toISOString() }).set(READER);
    const outside = await request(app).get("/api/reports/courses").query({ courseId: b, dateTo: new Date(Date.now() - 3_600_000).toISOString() }).set(READER);
    const passed = (body: { rows: Array<{ courseId: string; moduleBreakdown: Array<{ moduleId: string; passedUsers: number }> }> }) =>
      body.rows.find((row) => row.courseId === b)?.moduleBreakdown.find((row) => row.moduleId === moduleId)?.passedUsers;
    expect(passed(inside.body)).toBe(1);
    expect(passed(outside.body)).toBe(0);
  });
});

describe("#934 5a-3: bryteren av, ingenting er endret", () => {
  it("kursdetaljen og lista har samme felt som i 2.134.0", async () => {
    const { moduleId, a, u } = await twoCoursesWithCertificates();
    const detail = await courseDetail(u.headers, a);
    expect(Object.keys(moduleItem(detail, moduleId) ?? {}).sort()).toEqual(["available", "courseItemId", "discussionsEnabled", "moduleId", "moduleStatus", "required", "sortOrder", "title", "type"].sort());
    expect(detail.progress).toMatchObject({ completed: 1, total: 1, courseStatus: "COMPLETED", moduleCompleted: 1 });
  });

  it("`pending-versions` har samme felt som i 2.134.0: ingen liste over berørte kurs", async () => {
    const { moduleId, a } = await twoCoursesWithCertificates();
    await newVersion(moduleId);
    const response = await request(app).get(`/api/admin/content/courses/${a}/pending-versions`).set(admin());
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(["course", "courseId", "items", "modulesWithPasses", "notOwnedItems", "passedTotal", "publishable"].sort());
  });

  it("en publisering med avkrysning skriver det samme som i 2.134.0: `SUPERSEDED`, e-post, spor og krav i alle kurs", async () => {
    const { moduleId, a, b, u } = await twoCoursesWithCertificates();
    const v2 = await newVersion(moduleId);
    const response = await publishOld(moduleId, v2, { supersedesEarlierPasses: true });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(response.body.moduleVersion).toMatchObject({ versionMajor: 2, versionMinor: 0 });
    expect(await statusOf(u.userId, moduleId)).toBe("SUPERSEDED");
    expect(await revisedMails(moduleId)).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: moduleId, action: auditActions.adminContent.modulePassesSuperseded } })).toBe(1);
    expect([await requirementOf(a, moduleId), await requirementOf(b, moduleId)]).toEqual([2, 2]);
  });
});
