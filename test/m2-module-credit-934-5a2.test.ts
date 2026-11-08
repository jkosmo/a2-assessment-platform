import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { runContentWrite } from "../src/db/contentLock.js";
import { publishModuleVersion } from "../src/modules/adminContent/adminContentCommands.js";
import { createAssessmentDecision, createMcqOnlyDecision } from "../src/modules/assessment/decisionService.js";
import { findCreditedModuleIds } from "../src/modules/course/moduleCredit.js";
import { recordAuditEvent } from "../src/services/auditService.js";
import { auditActions, auditEntityTypes } from "../src/observability/auditEvents.js";
import { withRevision } from "./support/courseRevision.js";
import { recordFixturePass } from "./support/modulePassFixture.js";

// #934 skive 5a-2 (doc/DESIGN_934.md, «5a-2»): grunnmuren under regelen om beståtte per kurs.
//   - Hver vei som setter en modul live, gir nummer. Hovedversjon kommer bare fra `publish-versioned` (5a-3).
//   - Hver vei som endrer et kurs' elementer, holder kravene i takt.
//   - Hvert vedtaksspor skriver ModulePass, og et stryk på en annen innlevering rører den ikke.
// Tilbakefyllingen, sammenligningsrapporten og #997-avkrysningen er fjernet 2026-11-08, med testene sine: de gjaldt bare med
// bryteren av, og den har vært på i prod siden 2026-11-06.
// Rutene brukes der forfatteren og sensoren bruker dem. Gammel kode og gamle rader lages direkte i databasen.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const T = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const L = (text: string) => JSON.stringify(T(text));
// Grensen er 120 kall i minuttet per person. Testene lager mye via rutene, så en ny administrator tar over hvert 80. kall.
let adminCalls = 0;
function admin() {
  const n = Math.floor(adminCalls++ / 80);
  return { "x-user-id": `credit-admin-${RUN}-${n}`, "x-user-email": `credit.admin.${RUN}.${n}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
}
const REVIEWER = { "x-user-id": `credit-reviewer-${RUN}`, "x-user-email": `credit.reviewer.${RUN}@x.test`, "x-user-name": "Sensor", "x-user-roles": "REVIEWER", "x-locale": "nb" };
const HANDLER = { "x-user-id": `credit-handler-${RUN}`, "x-user-email": `credit.handler.${RUN}@x.test`, "x-user-name": "Behandler", "x-user-roles": "APPEAL_HANDLER", "x-locale": "nb" };

let seq = 0;
const tag = (name: string) => `5a2 ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

async function learner() {
  const suffix = `${RUN}-${seq++}`;
  const headers = { "x-user-id": `credit-p-${suffix}`, "x-user-email": `credit.p.${suffix}@x.test`, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT", "x-locale": "nb" };
  const user = await prisma.user.create({ data: { externalId: headers["x-user-id"], email: headers["x-user-email"], name: "Deltaker" }, select: { id: true } });
  return { headers, userId: user.id };
}

async function newModule() {
  const module = await prisma.module.create({ data: { title: L(tag("modul")) }, select: { id: true } });
  return module.id;
}

async function draft(moduleId: string, versionNo: number) {
  const version = await prisma.moduleVersion.create({
    data: { moduleId, versionNo, assessmentMode: "MCQ_ONLY", taskText: L(`Oppgave ${versionNo}`) },
    select: { id: true },
  });
  return version.id;
}

function publish(moduleId: string, moduleVersionId: string, body: Record<string, unknown> = {}) {
  return request(app).post(`/api/admin/content/modules/${moduleId}/module-versions/${moduleVersionId}/publish`).set(admin()).send(body);
}

async function publishOk(moduleId: string, moduleVersionId: string, body: Record<string, unknown> = {}) {
  const response = await publish(moduleId, moduleVersionId, body);
  expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
  return response.body.moduleVersion as { versionMajor: number; versionMinor: number; versionNo: number };
}

/**
 * Ny hovedversjon gjennom ruta forfatteren bruker (`publish-versioned`, #934 5a-3). Kursene modulen ligger i og som har vært ute,
 * står i forhåndsvisningen. Ingen av dem har kursbevis her, så ingen svar trengs, og kravet heves ikke (svar d).
 * #997-avkrysningen gir 409 siden regelen om beståtte per kurs ble slått på (2026-11-06).
 */
async function publishMajor(moduleId: string, moduleVersionId: string) {
  const preview = await request(app).get(`/api/admin/content/modules/${moduleId}/module-versions/${moduleVersionId}/publish-preview-versioned`).set(admin());
  expect(preview.status, JSON.stringify(preview.body).slice(0, 300)).toBe(200);
  const expectedCourseIds = (preview.body.courses as Array<{ courseId: string }>).map((course) => course.courseId);
  return request(app).post(`/api/admin/content/modules/${moduleId}/module-versions/${moduleVersionId}/publish-versioned`).set(admin()).send({ moduleVersion: "major", expectedCourseIds });
}

async function publishMajorOk(moduleId: string, moduleVersionId: string) {
  const response = await publishMajor(moduleId, moduleVersionId);
  expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
  return response.body.moduleVersion as { versionMajor: number; versionMinor: number; versionNo: number };
}

/**
 * En #997-revisjon slik gammel kode skrev den (før 2026-11-06): versjonen publisert, hendelsen i revisjonssporet, og statusen til
 * dem som hadde bestått satt til `SUPERSEDED`. Ingen kode skriver dette lenger, men radene står i prod, og nummereringen av
 * historikk uten nummer leser dem.
 */
async function legacyRevision(moduleId: string, moduleVersionId: string, supersededUserIds: string[] = []) {
  await publishOk(moduleId, moduleVersionId);
  await runContentWrite(async (tx) => {
    await tx.certificationStatus.updateMany({ where: { moduleId, userId: { in: supersededUserIds } }, data: { status: "SUPERSEDED", supersededByVersionId: moduleVersionId } });
    await recordAuditEvent({ entityType: auditEntityTypes.module, entityId: moduleId, action: auditActions.adminContent.modulePassesSuperseded, actorId: undefined, metadata: { moduleId, moduleVersionId, supersededCount: supersededUserIds.length, notifiedCount: supersededUserIds.length } }, tx);
  });
}

const numberOf = async (moduleVersionId: string) => {
  const row = await prisma.moduleVersion.findUniqueOrThrow({ where: { id: moduleVersionId }, select: { versionMajor: true, versionMinor: true } });
  return row.versionMajor === null ? null : `${row.versionMajor}.${row.versionMinor}`;
};

async function publishedModule() {
  const moduleId = await newModule();
  const versionId = await draft(moduleId, 1);
  await publishOk(moduleId, versionId);
  return { moduleId, versionId };
}

async function newCourse() {
  const response = await request(app).post("/api/admin/content/courses").set(admin()).send({ title: T(tag("kurs")), sortOrder: 2 });
  expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(201);
  return response.body.course.id as string;
}

async function setItems(courseId: string, moduleIds: string[]) {
  const response = await request(app).put(`/api/admin/content/courses/${courseId}/items`).set(admin()).send(await withRevision(courseId, { items: moduleIds.map((moduleId) => ({ type: "MODULE", moduleId })) }));
  expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(204);
}

async function courseWith(moduleIds: string[]) {
  const courseId = await newCourse();
  await setItems(courseId, moduleIds);
  return courseId;
}

const requirementOf = async (courseId: string, moduleId: string) =>
  (await prisma.courseModuleRequirement.findUnique({ where: { courseId_moduleId: { courseId, moduleId } } }))?.minModuleMajor ?? null;

/** En innlevering og et vedtak, skrevet direkte: slik gammel kode, eller radene fra før 5a-2, ser ut. */
async function legacyDecision(userId: string, moduleId: string, moduleVersionId: string, options: { pass?: boolean; at?: Date; status?: "COMPLETED" | "UNDER_REVIEW" | "SUPERSEDED" } = {}) {
  const submission = await prisma.submission.create({
    data: { userId, moduleId, moduleVersionId, deliveryType: "text", responseJson: "{}", submissionStatus: options.status ?? "COMPLETED", submittedAt: options.at ?? new Date() },
    select: { id: true },
  });
  const decision = await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id, moduleVersionId, mcqScaledScore: 80, practicalScaledScore: 10, totalScore: 90, redFlagsJson: "[]",
      passFailTotal: options.pass ?? true, decisionType: "AUTOMATIC", decisionReason: "Vurdert.", finalisedById: userId,
      ...(options.at ? { finalisedAt: options.at } : {}),
    },
    select: { id: true, finalisedAt: true },
  });
  return { submissionId: submission.id, decisionId: decision.id, finalisedAt: decision.finalisedAt };
}

/** Gammel kode: bestått og status, uten ModulePass. */
async function legacyPass(userId: string, moduleId: string, moduleVersionId: string, options: { status?: "ACTIVE" | "DUE" | "EXPIRED"; at?: Date } = {}) {
  const decided = await legacyDecision(userId, moduleId, moduleVersionId, { at: options.at });
  await prisma.certificationStatus.upsert({
    where: { userId_moduleId: { userId, moduleId } },
    update: { latestDecisionId: decided.decisionId, status: options.status ?? "ACTIVE", passedAt: decided.finalisedAt },
    create: { userId, moduleId, latestDecisionId: decided.decisionId, status: options.status ?? "ACTIVE", passedAt: decided.finalisedAt },
  });
  return decided;
}

const passesOf = (userId: string, moduleId: string) => prisma.modulePass.findMany({ where: { userId, moduleId }, orderBy: { passedAt: "asc" } });
const statusOf = (userId: string, moduleId: string) => prisma.certificationStatus.findUniqueOrThrow({ where: { userId_moduleId: { userId, moduleId } } });

/** Tar numrene bort, slik de var før 5a-2: gammel kode publiserte uten nummer. */
const forgetNumbers = (moduleId: string) => prisma.moduleVersion.updateMany({ where: { moduleId }, data: { versionMajor: null, versionMinor: null } });

describe("#934 5a-2: versjonsnummeret settes der modulen settes live", () => {
  it("første publisering er 1.0, uten avkrysning er mindre, hovedversjon gir ny hovedversjon", async () => {
    const moduleId = await newModule();
    const v1 = await draft(moduleId, 1);
    expect(await numberOf(v1)).toBeNull(); // Et utkast har ikke nummer.
    expect(await publishOk(moduleId, v1)).toMatchObject({ versionMajor: 1, versionMinor: 0 });
    expect(await publishOk(moduleId, await draft(moduleId, 2), { supersedesEarlierPasses: false })).toMatchObject({ versionMajor: 1, versionMinor: 1 });
    expect(await publishMajorOk(moduleId, await draft(moduleId, 3))).toMatchObject({ versionMajor: 2, versionMinor: 0 });
    expect(await publishOk(moduleId, await draft(moduleId, 4))).toMatchObject({ versionMajor: 2, versionMinor: 1 });
    const trail = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: auditEntityTypes.moduleVersion, entityId: v1, action: auditActions.adminContent.moduleVersionPublished } });
    expect(JSON.parse(trail.metadataJson)).toMatchObject({ versionMajor: 1, versionMinor: 0 });
  });

  it("den første publiseringen som hovedversjon er også 1.0", async () => {
    const moduleId = await newModule();
    expect(await publishMajorOk(moduleId, await draft(moduleId, 1))).toMatchObject({ versionMajor: 1, versionMinor: 0 });
  });

  it("en eldre versjon i samme hovedversjon som hoved: 409, og et nytt forsøk som mindre går", async () => {
    const { moduleId, versionId } = await publishedModule();
    const v2 = await draft(moduleId, 2);
    await publishOk(moduleId, v2);
    expect((await publishMajor(moduleId, versionId)).body.error).toBe("module_version_number_fixed");
    // Samme versjon på nytt uten avkrysning er ufarlig, og nummeret står.
    expect(await publishOk(moduleId, v2)).toMatchObject({ versionMajor: 1, versionMinor: 1 });
    // Tilbake til en eldre versjon i samme hovedversjon går også; nummeret står, og ingen nye rader er laget.
    expect(await publishOk(moduleId, versionId)).toMatchObject({ versionMajor: 1, versionMinor: 0 });
    expect((await prisma.module.findUniqueOrThrow({ where: { id: moduleId } })).activeVersionId).toBe(versionId);
    expect(await numberOf(v2)).toBe("1.1");
  });

  it("en avvist publisering av en versjon uten nummer ruller også tilbake nummereringen av historikken", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    await legacyPass(u.userId, moduleId, versionId);
    const v2 = await draft(moduleId, 2);
    await legacyRevision(moduleId, v2, [u.userId]);
    await forgetNumbers(moduleId);
    expect((await publish(moduleId, versionId)).body.error).toBe("module_version_outdated");
    expect([await numberOf(versionId), await numberOf(v2)]).toEqual([null, null]);
  });

  it("historikk uten nummer (fra før 5a-2): den får nummer først, så den nye versjonen teller videre riktig", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    await legacyPass(u.userId, moduleId, versionId);
    const v2 = await draft(moduleId, 2);
    await legacyRevision(moduleId, v2, [u.userId]);
    await forgetNumbers(moduleId);
    const v3 = await draft(moduleId, 3);
    expect(await publishOk(moduleId, v3)).toMatchObject({ versionMajor: 2, versionMinor: 1 });
    expect([await numberOf(versionId), await numberOf(v2)]).toEqual(["1.0", "2.0"]);
  });

  it("historikk uten nummer (fra før 5a-2): en revisjon som ikke rørte noen, ble mindre", async () => {
    const { moduleId, versionId } = await publishedModule();
    const v2 = await draft(moduleId, 2);
    await legacyRevision(moduleId, v2);
    await forgetNumbers(moduleId);
    const v3 = await draft(moduleId, 3);
    expect(await publishOk(moduleId, v3)).toMatchObject({ versionMajor: 1, versionMinor: 2 });
    expect([await numberOf(versionId), await numberOf(v2)]).toEqual(["1.0", "1.1"]);
  });

  it("to samtidige publiseringer får hvert sitt nummer", async () => {
    const { moduleId } = await publishedModule();
    const [a, b] = await Promise.all([draft(moduleId, 2), draft(moduleId, 3)]);
    const responses = await Promise.all([publish(moduleId, a), publish(moduleId, b)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect([await numberOf(a), await numberOf(b)].sort()).toEqual(["1.1", "1.2"]);
  });

  it("«Publiser kurs» gir en modul som aldri har vært ute, 1.0", async () => {
    const moduleId = await newModule();
    const v1 = await draft(moduleId, 1);
    const courseId = await courseWith([moduleId]);
    const response = await request(app).post(`/api/admin/content/courses/${courseId}/publish`).set(admin()).send({ publishItems: true });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(await numberOf(v1)).toBe("1.0");
    expect(await requirementOf(courseId, moduleId)).toBe(1);
  });

  it("kalibreringen er mindre, og tersklene får nummer", async () => {
    const { moduleId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    const response = await request(app).post("/api/calibration/workspace/publish-thresholds").set(admin()).send({ moduleId, totalMin: 70 });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(response.body.moduleVersion).toMatchObject({ versionMajor: 1, versionMinor: 1 });
    expect(await requirementOf(courseId, moduleId)).toBe(1);
  });
});

describe("#934 5a-2: modulimporten", () => {
  const rubric = { criteria: { clarity: { label: "Clarity", maxScore: 5, weight: 1, candidateVisible: true } }, scalingRule: { max_total: 5 } };
  const promptTemplate = { systemPrompt: "You assess.", userPromptTemplate: "Assess: {{answer}}" };
  const mcqSet = { title: T("Set"), questions: [{ stem: T("Q?"), options: [T("A"), T("B")], correctAnswer: T("A"), rationale: T("Because.") }] };

  async function fullModule() {
    const created = await request(app).post("/api/admin/content/modules").set(admin()).send({ title: T(tag("import")), certificationLevel: "foundation" });
    expect(created.status).toBe(201);
    const moduleId = created.body.module.id as string;
    const version = await request(app).post(`/api/admin/content/modules/${moduleId}/versions`).set(admin()).send({ taskText: T("Oppgave"), assessorExpectedContent: T("Fasit"), rubric, promptTemplate, mcqSet });
    expect(version.status, JSON.stringify(version.body).slice(0, 300)).toBe(201);
    await publishOk(moduleId, version.body.moduleVersion.id);
    const exported = await request(app).get(`/api/admin/content/modules/${moduleId}/export-package`).set(admin());
    expect(exported.status).toBe(200);
    return { moduleId, envelope: exported.body.envelope };
  }

  it("inn i en modul som har versjoner: mindre", async () => {
    const { moduleId, envelope } = await fullModule();
    const courseId = await courseWith([moduleId]);
    await publishMajorOk(moduleId, await draft(moduleId, 2));
    const response = await request(app).post("/api/admin/content/modules/import").set(admin()).send({ payload: envelope, mode: "replaceExisting", targetId: moduleId });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(201);
    expect(await numberOf(response.body.moduleVersionId)).toBe("2.1");
    // Kurset har aldri vært ute, så hovedversjonen berørte det ikke (5a-3), og importen er mindre: kravet står.
    expect(await requirementOf(courseId, moduleId)).toBe(1);
  });

  it("en kopi er en ny modul: 1.0, krav 1, og ingen beståtte følger med", async () => {
    const { moduleId, envelope } = await fullModule();
    const version = await prisma.moduleVersion.findFirstOrThrow({ where: { moduleId }, select: { id: true } });
    const u = await learner();
    const passed = await legacyPass(u.userId, moduleId, version.id);
    await recordFixturePass({ userId: u.userId, moduleId, moduleVersionId: version.id, ...passed });
    await publishMajorOk(moduleId, await draft(moduleId, 2));

    const response = await request(app).post("/api/admin/content/modules/import").set(admin()).send({ payload: envelope, mode: "createNew" });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(201);
    const copyId = response.body.moduleId as string;
    expect(copyId).not.toBe(moduleId);
    expect(await numberOf(response.body.moduleVersionId)).toBe("1.0");
    const courseId = await courseWith([copyId]);
    expect(await requirementOf(courseId, copyId)).toBe(1);
    expect(await passesOf(u.userId, copyId)).toEqual([]);
    expect(await findCreditedModuleIds(prisma, u.userId, courseId)).toEqual([]);
  });
});

describe("#934 5a-2: kravet følger kursets elementer", () => {
  it("PUT /items: en ny modul får sin nåværende hovedversjon, og en som tas ut, mister raden", async () => {
    const a = await publishedModule();
    const b = await publishedModule();
    await publishMajorOk(b.moduleId, await draft(b.moduleId, 2));
    const courseId = await courseWith([a.moduleId]);
    expect(await requirementOf(courseId, a.moduleId)).toBe(1);
    await setItems(courseId, [a.moduleId, b.moduleId]);
    expect(await requirementOf(courseId, b.moduleId)).toBe(2);
    await setItems(courseId, [b.moduleId]);
    expect(await requirementOf(courseId, a.moduleId)).toBeNull();
    expect(await requirementOf(courseId, b.moduleId)).toBe(2);
  });

  it("en modul som står, får ikke kravet endret av en lagring", async () => {
    const a = await publishedModule();
    const courseId = await courseWith([a.moduleId]);
    await prisma.courseModuleRequirement.update({ where: { courseId_moduleId: { courseId, moduleId: a.moduleId } }, data: { minModuleMajor: 7 } });
    await setItems(courseId, [a.moduleId]);
    expect(await requirementOf(courseId, a.moduleId)).toBe(7);
  });

  it("tatt ut og lagt inn igjen etter en hovedversjon: den nåværende hovedversjonen", async () => {
    const a = await publishedModule();
    const courseId = await courseWith([a.moduleId]);
    await setItems(courseId, []);
    await publishMajorOk(a.moduleId, await draft(a.moduleId, 2));
    await setItems(courseId, [a.moduleId]);
    expect(await requirementOf(courseId, a.moduleId)).toBe(2);
  });

  it("PUT /modules (den gamle ruta): samme regel", async () => {
    const a = await publishedModule();
    const b = await publishedModule();
    const courseId = await courseWith([a.moduleId]);
    const response = await request(app).put(`/api/admin/content/courses/${courseId}/modules`).set(admin()).send(await withRevision(courseId, { modules: [{ moduleId: b.moduleId, sortOrder: 0 }] }));
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(204);
    expect(await requirementOf(courseId, b.moduleId)).toBe(1);
    expect(await requirementOf(courseId, a.moduleId)).toBeNull();
  });

  it("PUT /content (kursskjemaet): samme regel", async () => {
    const a = await publishedModule();
    const courseId = await newCourse();
    const response = await request(app).put(`/api/admin/content/courses/${courseId}/content`).set(admin()).send(await withRevision(courseId, { title: T(tag("kurs")), items: [{ type: "MODULE", moduleId: a.moduleId }] }));
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBeLessThan(300);
    expect(await requirementOf(courseId, a.moduleId)).toBe(1);
  });

  it("et kurs med en modul som har historikk uten nummer: nummeret kommer først, så kravet", async () => {
    const a = await publishedModule();
    const v2 = await draft(a.moduleId, 2);
    await publishOk(a.moduleId, v2);
    await forgetNumbers(a.moduleId);
    const courseId = await courseWith([a.moduleId]);
    expect(await numberOf(v2)).toBe("1.1");
    expect(await requirementOf(courseId, a.moduleId)).toBe(1);
  });

  it("sletting av kurset og modulen tar radene med seg", async () => {
    const a = await publishedModule();
    const courseId = await courseWith([a.moduleId]);
    expect((await request(app).delete(`/api/admin/content/courses/${courseId}`).set(admin())).status).toBeLessThan(300);
    expect(await prisma.courseModuleRequirement.count({ where: { courseId } })).toBe(0);
    // Modulen tas i bruk i et nytt kurs, og slettes så slik rydd-veiene gjør det (versjonene først). Rutene for å slette en
    // modul nekter så lenge den har versjoner; poenget her er at en sletting ikke stoppes av de nye radene.
    const other = await courseWith([a.moduleId]);
    await runContentWrite(async (tx) => {
      await tx.courseItem.deleteMany({ where: { courseId: other } });
      await tx.moduleVersion.updateMany({ where: { moduleId: a.moduleId }, data: {} });
      await tx.module.update({ where: { id: a.moduleId }, data: { activeVersionId: null } });
      await tx.moduleVersion.deleteMany({ where: { moduleId: a.moduleId } });
      await tx.module.delete({ where: { id: a.moduleId } });
    });
    expect(await prisma.courseModuleRequirement.count({ where: { moduleId: a.moduleId } })).toBe(0);
  });
});

describe("#934 5a-2: hvert vedtaksspor skriver ModulePass", () => {
  async function runningJob(submissionId: string) {
    const lockedAt = new Date();
    const job = await prisma.assessmentJob.create({ data: { submissionId, status: "RUNNING", lockedBy: "test-worker", lockedAt, maxAttempts: 3 }, select: { id: true } });
    return { jobId: job.id, fence: { lockedBy: "test-worker", lockedAt } };
  }
  async function openSubmission(userId: string, moduleId: string, moduleVersionId: string) {
    const submission = await prisma.submission.create({ data: { userId, moduleId, moduleVersionId, deliveryType: "text", responseJson: "{}", submissionStatus: "PROCESSING" }, select: { id: true } });
    return submission.id;
  }
  const mcq = async (userId: string, moduleVersionId: string, submissionId: string, percent: number) =>
    createMcqOnlyDecision({ ...(await runningJob(submissionId)), submissionId, userId, moduleVersionId, mcqScaledScore: percent, mcqPercentScore: percent, assessmentPolicy: null });

  /** Automatisk vurdering, slik jobben kaller den. `manual` sender saken til sensor. */
  async function automatic(userId: string, moduleId: string, moduleVersionId: string, submissionId: string, manual = false) {
    const version = await prisma.moduleVersion.findUniqueOrThrow({ where: { id: moduleVersionId }, select: { rubricVersionId: true, promptTemplateVersionId: true } });
    return createAssessmentDecision({
      ...(await runningJob(submissionId)),
      submissionId,
      userId,
      moduleVersionId,
      rubricVersionId: version.rubricVersionId!,
      promptTemplateVersionId: version.promptTemplateVersionId!,
      mcqScaledScore: 30,
      mcqPercentScore: 75,
      llmResult: {
        module_id: moduleId,
        rubric_scores: { a: 4 },
        rubric_total: 4,
        practical_score_scaled: 70,
        pass_fail_practical: true,
        criterion_rationales: { a: "Bra" },
        improvement_advice: [],
        red_flags: [],
        manual_review_recommended: manual,
        confidence_note: "Sikker",
        evidence_sufficiency: "sufficient",
        recommended_outcome: "pass",
        manual_review_reason_code: manual ? "low_confidence" : "none",
      },
      assessmentPolicy: null,
      rubricMaxTotal: 4,
      rubricCriteriaIds: ["a"],
      ...(manual ? { forceManualReviewReason: { text: "Sjekk.", code: null, params: null } } : {}),
    } as never);
  }
  async function freeTextModule() {
    const source = await prisma.moduleVersion.findFirstOrThrow({
      where: { module: { activeVersionId: { not: null } }, rubricVersionId: { not: null }, promptTemplateVersionId: { not: null } },
      select: { rubricVersionId: true, promptTemplateVersionId: true, mcqSetVersionId: true },
      orderBy: { createdAt: "asc" },
    });
    const moduleId = await newModule();
    const version = await prisma.moduleVersion.create({
      data: { moduleId, versionNo: 1, taskText: L("Oppgave"), assessorExpectedContent: L("Fasit"), rubricVersionId: source.rubricVersionId, promptTemplateVersionId: source.promptTemplateVersionId, mcqSetVersionId: source.mcqSetVersionId, publishedAt: new Date() },
      select: { id: true },
    });
    await prisma.module.update({ where: { id: moduleId }, data: { activeVersionId: version.id } });
    return { moduleId, versionId: version.id };
  }

  it("bare flervalg: bestått gir raden med vedtakets versjon, og status skrives som før", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    const submissionId = await openSubmission(u.userId, moduleId, versionId);
    const { decision } = await mcq(u.userId, versionId, submissionId, 90);
    expect(decision.passFailTotal).toBe(true);
    const passes = await passesOf(u.userId, moduleId);
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ submissionId, decisionId: decision.id, moduleVersionId: versionId, passedAt: decision.finalisedAt, invalidatedAt: null });
    expect((await statusOf(u.userId, moduleId)).status).toBe("ACTIVE");
  });

  it("bare flervalg: stryk gir ingen rad", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    const { decision } = await mcq(u.userId, versionId, await openSubmission(u.userId, moduleId, versionId), 10);
    expect(decision.passFailTotal).toBe(false);
    expect(await passesOf(u.userId, moduleId)).toEqual([]);
  });

  it("automatisk vurdering: bestått gir raden", async () => {
    const { moduleId, versionId } = await freeTextModule();
    const u = await learner();
    const submissionId = await openSubmission(u.userId, moduleId, versionId);
    const { decision, needsManualReview } = await automatic(u.userId, moduleId, versionId, submissionId);
    expect(needsManualReview).toBe(false);
    expect(decision.passFailTotal).toBe(true);
    expect((await passesOf(u.userId, moduleId)).map((p) => p.submissionId)).toEqual([submissionId]);
  });

  it("automatisk vurdering sendt til sensor: ingen rad og ingen status, før sensoren har sagt noe", async () => {
    const { moduleId, versionId } = await freeTextModule();
    const u = await learner();
    const submissionId = await openSubmission(u.userId, moduleId, versionId);
    const { needsManualReview } = await automatic(u.userId, moduleId, versionId, submissionId, true);
    expect(needsManualReview).toBe(true);
    expect(await passesOf(u.userId, moduleId)).toEqual([]);
    expect(await prisma.certificationStatus.count({ where: { userId: u.userId, moduleId } })).toBe(0);
  });

  it("manuell vurdering gjennom ruta: bestått gir raden, med sensorens vedtak", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    const { submissionId } = await legacyDecision(u.userId, moduleId, versionId, { status: "UNDER_REVIEW" });
    const review = await prisma.manualReview.create({ data: { submissionId, triggerReason: "Test", reviewStatus: "OPEN" }, select: { id: true } });
    expect((await request(app).post(`/api/reviews/${review.id}/claim`).set(REVIEWER)).status).toBe(200);
    const response = await request(app).post(`/api/reviews/${review.id}/override`).set(REVIEWER).send({ passFailTotal: true, decisionReason: "Bestått etter vurdering.", overrideReason: "Holder." });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    const decisions = await prisma.assessmentDecision.findMany({ where: { submissionId, decisionType: "MANUAL_OVERRIDE" } });
    expect((await passesOf(u.userId, moduleId)).map((p) => p.decisionId)).toEqual([decisions[0]!.id]);
  });

  it("manuell vurdering som stryker: ingen rad", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    const { submissionId } = await legacyDecision(u.userId, moduleId, versionId, { status: "UNDER_REVIEW" });
    const review = await prisma.manualReview.create({ data: { submissionId, triggerReason: "Test", reviewStatus: "OPEN" }, select: { id: true } });
    expect((await request(app).post(`/api/reviews/${review.id}/claim`).set(REVIEWER)).status).toBe(200);
    const response = await request(app).post(`/api/reviews/${review.id}/override`).set(REVIEWER).send({ passFailTotal: false, decisionReason: "Stryk.", overrideReason: "For tynt." });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(await passesOf(u.userId, moduleId)).toEqual([]);
    expect((await statusOf(u.userId, moduleId)).status).toBe("NOT_CERTIFIED");
  });

  async function appealed(userId: string, submissionId: string) {
    const appeal = await prisma.appeal.create({ data: { submissionId, appealedById: userId, appealReason: "Jeg ber om en ny vurdering.", appealStatus: "OPEN" }, select: { id: true } });
    expect((await request(app).post(`/api/appeals/${appeal.id}/claim`).set(HANDLER)).status).toBe(200);
    return appeal.id;
  }

  it("en anke som holder fast: raden peker på ankevedtaket", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    const { submissionId } = await legacyPass(u.userId, moduleId, versionId);
    const appealId = await appealed(u.userId, submissionId);
    const response = await request(app).post(`/api/appeals/${appealId}/resolve`).set(HANDLER).send({ passFailTotal: true, decisionReason: "Står.", resolutionNote: "Ny vurdering er gjort." });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    const decision = await prisma.assessmentDecision.findFirstOrThrow({ where: { submissionId, decisionType: "APPEAL_RESOLUTION" } });
    expect((await passesOf(u.userId, moduleId)).map((p) => p.decisionId)).toEqual([decision.id]);
  });

  it("en anke som snur en bestått: raden på den innleveringen er borte, selv om gammel regel lar statusen stå", async () => {
    const { moduleId, versionId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    const u = await learner();
    const { submissionId, decisionId } = await legacyPass(u.userId, moduleId, versionId);
    await recordFixturePass({ userId: u.userId, moduleId, moduleVersionId: versionId, submissionId, decisionId });
    expect(await passesOf(u.userId, moduleId)).toHaveLength(1);
    const appealId = await appealed(u.userId, submissionId);
    const response = await request(app).post(`/api/appeals/${appealId}/resolve`).set(HANDLER).send({ passFailTotal: false, decisionReason: "Stryk etter anke.", resolutionNote: "Ny vurdering er gjort." });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(await passesOf(u.userId, moduleId)).toEqual([]);
    expect(await findCreditedModuleIds(prisma, u.userId, courseId)).toEqual([]);

    // Vakta mot nedgradering lar statusen stå som bestått («Kjente mangler» nr. 41). Ingen fremdrift leser den lenger.
    expect((await statusOf(u.userId, moduleId)).status).toBe("ACTIVE");
  });

  it("en anke som står fast ved bestått: raden følger det nye vedtaket", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    const { submissionId, decisionId } = await legacyPass(u.userId, moduleId, versionId);
    await recordFixturePass({ userId: u.userId, moduleId, moduleVersionId: versionId, submissionId, decisionId });
    const appealId = await appealed(u.userId, submissionId);
    const response = await request(app).post(`/api/appeals/${appealId}/resolve`).set(HANDLER).send({ passFailTotal: true, decisionReason: "Bestått etter anke.", resolutionNote: "Ny vurdering er gjort." });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    const rows = await passesOf(u.userId, moduleId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decisionId).not.toBe(decisionId);
    expect(rows[0]!.invalidatedAt).toBeNull();
  });

  it("et stryk på en ANNEN innlevering rører ikke beståtten (svar f), og status skrives som før", async () => {
    const { moduleId, versionId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    const u = await learner();
    const passed = await openSubmission(u.userId, moduleId, versionId);
    await mcq(u.userId, versionId, passed, 90);
    const failed = await openSubmission(u.userId, moduleId, versionId);
    await mcq(u.userId, versionId, failed, 10);
    expect((await passesOf(u.userId, moduleId)).map((p) => p.submissionId)).toEqual([passed]);
    expect((await statusOf(u.userId, moduleId)).status).toBe("NOT_CERTIFIED");
    expect(await findCreditedModuleIds(prisma, u.userId, courseId)).toEqual([moduleId]);
  });

  it("et nytt vedtak som består på en rad tilbakefyllingen hadde ugyldiggjort: gjelder igjen", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    const { submissionId, decisionId } = await legacyPass(u.userId, moduleId, versionId);
    await prisma.modulePass.create({ data: { userId: u.userId, moduleId, submissionId, decisionId, moduleVersionId: versionId, passedAt: new Date(), invalidatedAt: new Date() } });
    const appealId = await appealed(u.userId, submissionId);
    const response = await request(app).post(`/api/appeals/${appealId}/resolve`).set(HANDLER).send({ passFailTotal: true, decisionReason: "Står.", resolutionNote: "Ny vurdering er gjort." });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect((await passesOf(u.userId, moduleId))[0]?.invalidatedAt).toBeNull();
  });

  it("innsynseksporten (GET /api/me/data) viser radene", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    const submissionId = await openSubmission(u.userId, moduleId, versionId);
    await mcq(u.userId, versionId, submissionId, 90);
    const response = await request(app).get("/api/me/data").set(u.headers);
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(response.body.profile.modulePasses).toEqual([expect.objectContaining({ moduleId, moduleVersionId: versionId, submissionId, invalidatedAt: null })]);
  });
});

describe("#934 5a-2: flere kall rundt publiseringen", () => {
  it("modulens kall fra kaskaden sender ingen hovedversjon uten avkrysning", async () => {
    const { moduleId } = await publishedModule();
    const v2 = await draft(moduleId, 2);
    const actor = await learner();
    await runContentWrite((tx) => publishModuleVersion(moduleId, v2, actor.userId, tx, { courseVersionHandledByCaller: true }));
    expect(await numberOf(v2)).toBe("1.1");
  });
});
