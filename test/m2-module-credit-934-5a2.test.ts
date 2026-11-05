import { readFileSync } from "node:fs";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { runContentWrite, runLearnerWrite, type LearnerTx } from "../src/db/contentLock.js";
import { publishModuleVersion } from "../src/modules/adminContent/adminContentCommands.js";
import { createAssessmentDecision, createMcqOnlyDecision } from "../src/modules/assessment/decisionService.js";
import { recordModulePassFromDecision } from "../src/modules/certification/modulePass.js";
import { reconcileCourseCompletionsForUser } from "../src/modules/course/index.js";
import { findCreditedModuleIds } from "../src/modules/course/moduleCredit.js";
import { backfillModuleCredit, MODULE_PASS_SWITCH_KEY } from "../src/modules/course/moduleCreditBackfill.js";
import { compareModuleCredit } from "../src/modules/course/moduleCreditComparison.js";
import { recordAuditEvent } from "../src/services/auditService.js";
import { auditActions, auditEntityTypes } from "../src/observability/auditEvents.js";
import { withRevision } from "./support/courseRevision.js";

// #934 skive 5a-2 (doc/DESIGN_934.md, «5a-2»): grunnmuren ved siden av dagens regel.
//   - Hver vei som setter en modul live, gir nummer. Avkrysningen gir ny hovedversjon og hever kravet i alle kurs.
//   - Hver vei som endrer et kurs' elementer, holder kravene i takt.
//   - Hvert vedtaksspor skriver ModulePass, og et stryk på en annen innlevering rører den ikke.
//   - Tilbakefyllingen regner alt ut på nytt, kan kjøres flere ganger, og gir ikke #997-beståtte tilbake.
//   - Rapporten sier fra om en ekte forskjell (kontrollcasene).
//   - Ingen leser har byttet regel: `CertificationStatus` og kursbeviset er som før.
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
const forgetRequirements = (moduleId: string) => prisma.courseModuleRequirement.deleteMany({ where: { moduleId } });

describe("#934 5a-2: versjonsnummeret settes der modulen settes live", () => {
  it("første publisering er 1.0, uten avkrysning er mindre, med avkrysning er ny hovedversjon", async () => {
    const moduleId = await newModule();
    const v1 = await draft(moduleId, 1);
    expect(await numberOf(v1)).toBeNull(); // Et utkast har ikke nummer.
    expect(await publishOk(moduleId, v1)).toMatchObject({ versionMajor: 1, versionMinor: 0 });
    expect(await publishOk(moduleId, await draft(moduleId, 2), { supersedesEarlierPasses: false })).toMatchObject({ versionMajor: 1, versionMinor: 1 });
    expect(await publishOk(moduleId, await draft(moduleId, 3), { supersedesEarlierPasses: true })).toMatchObject({ versionMajor: 2, versionMinor: 0 });
    expect(await publishOk(moduleId, await draft(moduleId, 4))).toMatchObject({ versionMajor: 2, versionMinor: 1 });
    const trail = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: auditEntityTypes.moduleVersion, entityId: v1, action: auditActions.adminContent.moduleVersionPublished } });
    expect(JSON.parse(trail.metadataJson)).toMatchObject({ versionMajor: 1, versionMinor: 0 });
  });

  it("den første publiseringen med avkrysning er også 1.0", async () => {
    const moduleId = await newModule();
    expect(await publishOk(moduleId, await draft(moduleId, 1), { supersedesEarlierPasses: true })).toMatchObject({ versionMajor: 1, versionMinor: 0 });
  });

  it("hovedversjon hever kravet i ALLE kurs modulen ligger i, også et som aldri har vært ute, og mindre rører det ikke", async () => {
    const { moduleId } = await publishedModule();
    const published = await courseWith([moduleId]);
    expect((await request(app).post(`/api/admin/content/courses/${published}/publish`).set(admin())).status).toBe(200);
    const unpublished = await courseWith([moduleId]);
    await publishOk(moduleId, await draft(moduleId, 2));
    expect([await requirementOf(published, moduleId), await requirementOf(unpublished, moduleId)]).toEqual([1, 1]);
    await publishOk(moduleId, await draft(moduleId, 3), { supersedesEarlierPasses: true });
    expect([await requirementOf(published, moduleId), await requirementOf(unpublished, moduleId)]).toEqual([2, 2]);
    await publishOk(moduleId, await draft(moduleId, 4));
    expect([await requirementOf(published, moduleId), await requirementOf(unpublished, moduleId)]).toEqual([2, 2]);
  });

  it("kravet senkes aldri: en hovedversjon under et krav som står høyere, rører det ikke", async () => {
    const { moduleId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    await prisma.courseModuleRequirement.update({ where: { courseId_moduleId: { courseId, moduleId } }, data: { minModuleMajor: 7 } });
    await publishOk(moduleId, await draft(moduleId, 2), { supersedesEarlierPasses: true });
    expect(await requirementOf(courseId, moduleId)).toBe(7);
  });

  it("et kurs uten rad (tilbakefyllingen er ikke kjørt) får raden når modulen får hovedversjon", async () => {
    const { moduleId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    await forgetRequirements(moduleId);
    await publishOk(moduleId, await draft(moduleId, 2), { supersedesEarlierPasses: true });
    expect(await requirementOf(courseId, moduleId)).toBe(2);
  });

  it("den aktive versjonen publisert på nytt som hoved: 409, og ingenting er endret, heller ikke statusen", async () => {
    const { moduleId, versionId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    const u = await learner();
    await legacyPass(u.userId, moduleId, versionId);
    const response = await publish(moduleId, versionId, { supersedesEarlierPasses: true });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("module_version_number_fixed");
    expect(await numberOf(versionId)).toBe("1.0");
    expect(await requirementOf(courseId, moduleId)).toBe(1);
    expect((await statusOf(u.userId, moduleId)).status).toBe("ACTIVE");
    expect(await prisma.auditEvent.count({ where: { entityId: moduleId, action: auditActions.adminContent.modulePassesSuperseded } })).toBe(0);
  });

  it("en eldre versjon i samme hovedversjon som hoved: også 409, og et nytt forsøk uten avkrysning går", async () => {
    const { moduleId, versionId } = await publishedModule();
    const v2 = await draft(moduleId, 2);
    await publishOk(moduleId, v2);
    expect((await publish(moduleId, versionId, { supersedesEarlierPasses: true })).body.error).toBe("module_version_number_fixed");
    // Samme versjon på nytt uten avkrysning er ufarlig, og nummeret står.
    expect(await publishOk(moduleId, v2)).toMatchObject({ versionMajor: 1, versionMinor: 1 });
    // Tilbake til en eldre versjon i samme hovedversjon går også; nummeret står, og ingen nye rader er laget.
    expect(await publishOk(moduleId, versionId)).toMatchObject({ versionMajor: 1, versionMinor: 0 });
    expect((await prisma.module.findUniqueOrThrow({ where: { id: moduleId } })).activeVersionId).toBe(versionId);
    expect(await numberOf(v2)).toBe("1.1");
  });

  it("en eldre versjon med lavere hovedversjon: 409 module_version_outdated, og den aktive står", async () => {
    const { moduleId, versionId } = await publishedModule();
    const v2 = await draft(moduleId, 2);
    await publishOk(moduleId, v2, { supersedesEarlierPasses: true });
    const response = await publish(moduleId, versionId);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("module_version_outdated");
    expect((await prisma.module.findUniqueOrThrow({ where: { id: moduleId } })).activeVersionId).toBe(v2);
  });

  it("en avvist publisering av en versjon uten nummer ruller også tilbake nummereringen av historikken", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    await legacyPass(u.userId, moduleId, versionId);
    const v2 = await draft(moduleId, 2);
    await publishOk(moduleId, v2, { supersedesEarlierPasses: true });
    await forgetNumbers(moduleId);
    expect((await publish(moduleId, versionId)).body.error).toBe("module_version_outdated");
    expect([await numberOf(versionId), await numberOf(v2)]).toEqual([null, null]);
  });

  it("publisert før tilbakefyllingen: historikken får nummer først, så den nye versjonen teller videre riktig", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    await legacyPass(u.userId, moduleId, versionId);
    const v2 = await draft(moduleId, 2);
    await publishOk(moduleId, v2, { supersedesEarlierPasses: true });
    await forgetNumbers(moduleId);
    const v3 = await draft(moduleId, 3);
    expect(await publishOk(moduleId, v3)).toMatchObject({ versionMajor: 2, versionMinor: 1 });
    expect([await numberOf(versionId), await numberOf(v2)]).toEqual(["1.0", "2.0"]);
  });

  it("publisert før tilbakefyllingen: en revisjon som ikke rørte noen, ble mindre, samme svar som tilbakefyllingen", async () => {
    const { moduleId, versionId } = await publishedModule();
    const v2 = await draft(moduleId, 2);
    await publishOk(moduleId, v2, { supersedesEarlierPasses: true });
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

  it("«Publiser nye versjoner» med avkrysning: modulen med beståtte får hovedversjon, den uten får mindre, og kravet heves i andre kurs", async () => {
    const withPass = await publishedModule();
    const withoutPass = await publishedModule();
    const courseId = await courseWith([withPass.moduleId, withoutPass.moduleId]);
    const other = await courseWith([withPass.moduleId]);
    expect((await request(app).post(`/api/admin/content/courses/${courseId}/publish`).set(admin())).status).toBe(200);
    const u = await learner();
    await legacyPass(u.userId, withPass.moduleId, withPass.versionId);
    const [v2, w2] = [await draft(withPass.moduleId, 2), await draft(withoutPass.moduleId, 2)];
    const response = await request(app).post(`/api/admin/content/courses/${courseId}/publish-pending`).set(admin()).send({ versionIds: [v2, w2], supersedesEarlierPasses: true });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect([await numberOf(v2), await numberOf(w2)]).toEqual(["2.0", "1.1"]);
    expect([await requirementOf(courseId, withPass.moduleId), await requirementOf(other, withPass.moduleId), await requirementOf(courseId, withoutPass.moduleId)]).toEqual([2, 2, 1]);
    expect((await statusOf(u.userId, withPass.moduleId)).status).toBe("SUPERSEDED");
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
    await publishOk(moduleId, await draft(moduleId, 2), { supersedesEarlierPasses: true });
    const response = await request(app).post("/api/admin/content/modules/import").set(admin()).send({ payload: envelope, mode: "replaceExisting", targetId: moduleId });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(201);
    expect(await numberOf(response.body.moduleVersionId)).toBe("2.1");
    expect(await requirementOf(courseId, moduleId)).toBe(2);
  });

  it("en kopi er en ny modul: 1.0, krav 1, og ingen beståtte følger med", async () => {
    const { moduleId, envelope } = await fullModule();
    const version = await prisma.moduleVersion.findFirstOrThrow({ where: { moduleId }, select: { id: true } });
    const u = await learner();
    await legacyPass(u.userId, moduleId, version.id);
    await backfillModuleCredit({ moduleIds: [moduleId], userIds: [u.userId] });
    await publishOk(moduleId, await draft(moduleId, 2), { supersedesEarlierPasses: true });

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
    await publishOk(b.moduleId, await draft(b.moduleId, 2), { supersedesEarlierPasses: true });
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
    await publishOk(a.moduleId, await draft(a.moduleId, 2), { supersedesEarlierPasses: true });
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
    const { submissionId } = await legacyPass(u.userId, moduleId, versionId);
    await backfillModuleCredit({ moduleIds: [moduleId], userIds: [u.userId] });
    expect(await passesOf(u.userId, moduleId)).toHaveLength(1);
    const appealId = await appealed(u.userId, submissionId);
    const response = await request(app).post(`/api/appeals/${appealId}/resolve`).set(HANDLER).send({ passFailTotal: false, decisionReason: "Stryk etter anke.", resolutionNote: "Ny vurdering er gjort." });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(await passesOf(u.userId, moduleId)).toEqual([]);
    expect(await findCreditedModuleIds(prisma, u.userId, courseId)).toEqual([]);

    // Dagens regel, målt og ikke antatt: vakta mot nedgradering treffer, for `passedAt` er alltid etter innleveringen.
    // Statusen står som bestått. Det er ikke rettet her (ingen utfall endres i 5a-2): «Kjente mangler» nr. 41.
    expect((await statusOf(u.userId, moduleId)).status).toBe("ACTIVE");
    const report = await compareModuleCredit({ moduleIds: [moduleId], userIds: [u.userId] });
    expect(report.differences.map((d) => d.reason)).toEqual(["overturned_pass_kept_by_old_rule"]);
    expect(report.ok).toBe(false);
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
    const report = await compareModuleCredit({ moduleIds: [moduleId], userIds: [u.userId] });
    expect(report.differences.map((d) => [d.reason, d.expected, d.oldCredit, d.newCredit])).toEqual([["retake_failed_after_pass", true, false, true]]);
    expect(report.ok).toBe(true);
  });

  it("et nytt vedtak som består på en rad tilbakefyllingen hadde ugyldiggjort: gjelder igjen, slik en ny kjøring ville sagt", async () => {
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

describe("#934 5a-2: ingen leser har byttet regel", () => {
  it("en bestått på gammel versjon etter en revisjon gir fortsatt kursbevis i dag, og den nye regelen sier nei", async () => {
    const { moduleId, versionId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    expect((await request(app).post(`/api/admin/content/courses/${courseId}/publish`).set(admin())).status).toBe(200);
    await publishOk(moduleId, await draft(moduleId, 2), { supersedesEarlierPasses: true });
    const u = await learner();
    // Innleveringen var på den gamle versjonen. Vedtaket kommer etter revisjonen («Kjente mangler» nr. 30).
    await legacyPass(u.userId, moduleId, versionId);
    await backfillModuleCredit({ moduleIds: [moduleId], userIds: [u.userId] });
    await reconcileCourseCompletionsForUser(u.userId);
    expect(await prisma.courseCompletion.count({ where: { userId: u.userId, courseId } })).toBe(1);
    expect(await findCreditedModuleIds(prisma, u.userId, courseId)).toEqual([]);
    const report = await compareModuleCredit({ moduleIds: [moduleId], userIds: [u.userId] });
    expect(report.differences.map((d) => [d.reason, d.expected])).toEqual([["pass_on_old_version_after_revision", true]]);
  });

  it("en revisjon tar statusen som før, og gir samme svar i begge regler", async () => {
    const { moduleId, versionId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    const u = await learner();
    await legacyPass(u.userId, moduleId, versionId);
    await backfillModuleCredit({ moduleIds: [moduleId], userIds: [u.userId] });
    expect(await findCreditedModuleIds(prisma, u.userId, courseId)).toEqual([moduleId]);
    await publishOk(moduleId, await draft(moduleId, 2), { supersedesEarlierPasses: true });
    expect((await statusOf(u.userId, moduleId)).status).toBe("SUPERSEDED");
    expect(await findCreditedModuleIds(prisma, u.userId, courseId)).toEqual([]);
    const report = await compareModuleCredit({ moduleIds: [moduleId], userIds: [u.userId] });
    expect(report.differences).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe("#934 5a-2: tilbakefyllingen", () => {
  /** Gammel kode har kjørt: revisjonen ble skrevet slik #997 gjorde det, uten nummer og krav. */
  async function oldCodeHistory() {
    const { moduleId, versionId: v1 } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    const before = await learner();
    await legacyPass(before.userId, moduleId, v1);
    const v2 = await draft(moduleId, 2);
    await publishOk(moduleId, v2, { supersedesEarlierPasses: true });
    const v3 = await draft(moduleId, 3);
    await publishOk(moduleId, v3);
    const after = await learner();
    await legacyPass(after.userId, moduleId, v3);
    await forgetNumbers(moduleId);
    await forgetRequirements(moduleId);
    return { moduleId, courseId, v1, v2, v3, before, after };
  }
  const scope = (moduleId: string, ...users: Array<{ userId: string }>) => ({ moduleIds: [moduleId], userIds: users.map((u) => u.userId) });

  it("regner ut nummer, krav og beståtte fra historikken, og beståtten #997 tok bort, teller ikke", async () => {
    const h = await oldCodeHistory();
    const result = await backfillModuleCredit(scope(h.moduleId, h.before, h.after));
    expect(result).toMatchObject({ modules: 1, versionsNumbered: 3, requirements: 1, users: 2, passes: 2, invalidated: 1, busy: { modules: [], users: [] } });
    expect([await numberOf(h.v1), await numberOf(h.v2), await numberOf(h.v3)]).toEqual(["1.0", "2.0", "2.1"]);
    expect(await requirementOf(h.courseId, h.moduleId)).toBe(2);
    expect((await passesOf(h.before.userId, h.moduleId))[0]?.invalidatedAt).not.toBeNull();
    expect((await passesOf(h.after.userId, h.moduleId))[0]?.invalidatedAt).toBeNull();
    expect(await findCreditedModuleIds(prisma, h.before.userId, h.courseId)).toEqual([]);
    expect(await findCreditedModuleIds(prisma, h.after.userId, h.courseId)).toEqual([h.moduleId]);
    const report = await compareModuleCredit(scope(h.moduleId, h.before, h.after));
    expect(report).toMatchObject({ compared: 2, differences: [], unexplained: 0, ok: true });
    expect(Object.values(report.structure).flat()).toEqual([]);
  });

  it("kan kjøres to ganger: samme nummer, krav og beståtte", async () => {
    const h = await oldCodeHistory();
    await backfillModuleCredit(scope(h.moduleId, h.before, h.after));
    const snapshot = async () => ({
      numbers: await Promise.all([h.v1, h.v2, h.v3].map(numberOf)),
      requirement: await requirementOf(h.courseId, h.moduleId),
      passes: (await prisma.modulePass.findMany({ where: { moduleId: h.moduleId }, orderBy: { submissionId: "asc" } })).map(({ submissionId, decisionId, moduleVersionId, passedAt, invalidatedAt }) => ({ submissionId, decisionId, moduleVersionId, passedAt, invalidatedAt })),
    });
    const first = await snapshot();
    const second = await backfillModuleCredit(scope(h.moduleId, h.before, h.after));
    expect(second.versionsNumbered).toBe(0);
    expect(await snapshot()).toEqual(first);
  });

  it("en ny kjøring retter det gammel kode gjorde under utrullingen: vedtak uten rad, og en rad som ikke skal stå", async () => {
    const { moduleId, versionId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    const u = await learner();
    await legacyPass(u.userId, moduleId, versionId);
    await backfillModuleCredit(scope(moduleId, u));
    // Gammel kode: et vedtak uten rad.
    const v = await learner();
    await legacyPass(v.userId, moduleId, versionId);
    expect(await passesOf(v.userId, moduleId)).toEqual([]);
    // En rad som ikke hører hjemme (en anke på gammel kode snudde vedtaket).
    const row = (await passesOf(u.userId, moduleId))[0]!;
    await prisma.assessmentDecision.create({
      data: { submissionId: row.submissionId, moduleVersionId: versionId, mcqScaledScore: 0, practicalScaledScore: 0, totalScore: 0, redFlagsJson: "[]", passFailTotal: false, decisionType: "APPEAL_RESOLUTION", decisionReason: "Snudd.", parentDecisionId: row.decisionId, finalisedAt: new Date() },
    });
    await backfillModuleCredit(scope(moduleId, u, v));
    expect(await passesOf(u.userId, moduleId)).toEqual([]);
    expect(await passesOf(v.userId, moduleId)).toHaveLength(1);
    expect(await findCreditedModuleIds(prisma, v.userId, courseId)).toEqual([moduleId]);
  });

  it("SUPERSEDED på samme versjon som vedtaket, og den eneste versjonen: ugyldiggjort, teller ikke, og forblir 1.0", async () => {
    const { moduleId, versionId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    const u = await learner();
    await legacyPass(u.userId, moduleId, versionId);
    // Slik #997 gjorde det før 5a-2: revisjonen på den aktive versjonen, i én transaksjon.
    await runContentWrite(async (tx) => {
      await recordAuditEvent({ entityType: auditEntityTypes.module, entityId: moduleId, action: auditActions.adminContent.modulePassesSuperseded, actorId: undefined, metadata: { moduleId, moduleVersionId: versionId, supersededCount: 1, notifiedCount: 1 } }, tx);
      await tx.certificationStatus.updateMany({ where: { moduleId }, data: { status: "SUPERSEDED", supersededByVersionId: versionId } });
    });
    await forgetNumbers(moduleId);
    const result = await backfillModuleCredit(scope(moduleId, u));
    expect(result.invalidated).toBe(1);
    expect(await numberOf(versionId)).toBe("1.0");
    expect(await requirementOf(courseId, moduleId)).toBe(1);
    expect(await findCreditedModuleIds(prisma, u.userId, courseId)).toEqual([]);
    const report = await compareModuleCredit(scope(moduleId, u));
    expect(report.differences).toEqual([]);
    expect(report.ok).toBe(true);

    // Lesespørringen i planen finner raden, og hele fila kjører.
    const sql = readFileSync("scripts/maintenance/module-credit-precheck.sql", "utf8");
    const [same, perVersion, withoutTrail] = sql.split(";").map((part) => part.trim()).filter(Boolean);
    const count = await prisma.$queryRawUnsafe<Array<{ same_version_superseded: bigint }>>(same!);
    expect(Number(count[0]!.same_version_superseded)).toBeGreaterThanOrEqual(1);
    const rows = await prisma.$queryRawUnsafe<Array<{ moduleId: string; supersededByVersionId: string }>>(perVersion!);
    expect(rows.some((row) => row.moduleId === moduleId && row.supersededByVersionId === versionId)).toBe(true);
    const missing = await prisma.$queryRawUnsafe<Array<{ moduleId: string }>>(withoutTrail!);
    expect(missing.some((row) => row.moduleId === moduleId)).toBe(false);
  });

  it("den samme raden uten spor: ugyldiggjort likevel, og lesespørringen sier fra", async () => {
    const { moduleId, versionId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    const u = await learner();
    await legacyPass(u.userId, moduleId, versionId);
    await runContentWrite((tx) => tx.certificationStatus.updateMany({ where: { moduleId }, data: { status: "SUPERSEDED", supersededByVersionId: versionId } }));
    await forgetNumbers(moduleId);
    await backfillModuleCredit(scope(moduleId, u));
    expect(await findCreditedModuleIds(prisma, u.userId, courseId)).toEqual([]);
    const sql = readFileSync("scripts/maintenance/module-credit-precheck.sql", "utf8");
    const withoutTrail = sql.split(";").map((part) => part.trim()).filter(Boolean)[2]!;
    const missing = await prisma.$queryRawUnsafe<Array<{ moduleId: string }>>(withoutTrail);
    expect(missing.some((row) => row.moduleId === moduleId)).toBe(true);
  });

  it("en revisjon uten spor skjules ikke av en annen rad med null beståtte: ny hovedversjon, og lesespørringen sier fra", async () => {
    const { moduleId, versionId: v1 } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    const v2 = await draft(moduleId, 2);
    await publishOk(moduleId, v2);
    const u = await learner();
    await legacyPass(u.userId, moduleId, v1);
    await runContentWrite(async (tx) => {
      await tx.certificationStatus.updateMany({ where: { moduleId }, data: { status: "SUPERSEDED", supersededByVersionId: v2 } });
      await recordAuditEvent({ entityType: auditEntityTypes.module, entityId: moduleId, action: auditActions.adminContent.modulePassesSuperseded, actorId: undefined, metadata: { moduleId, moduleVersionId: v2, supersededCount: 0, notifiedCount: 0 } }, tx);
    });
    const sql = readFileSync("scripts/maintenance/module-credit-precheck.sql", "utf8");
    const withoutTrail = sql.split(";").map((part) => part.trim()).filter(Boolean)[2]!;
    const missing = await prisma.$queryRawUnsafe<Array<{ moduleId: string }>>(withoutTrail);
    expect(missing.some((row) => row.moduleId === moduleId)).toBe(true);

    await forgetNumbers(moduleId);
    await backfillModuleCredit(scope(moduleId, u));
    expect([await numberOf(v1), await numberOf(v2)]).toEqual(["1.0", "2.0"]);
    expect(await requirementOf(courseId, moduleId)).toBe(2);
  });

  it("gamle DUE og EXPIRED er bestått i begge regler", async () => {
    for (const status of ["DUE", "EXPIRED"] as const) {
      const { moduleId, versionId } = await publishedModule();
      const courseId = await courseWith([moduleId]);
      const u = await learner();
      await legacyPass(u.userId, moduleId, versionId, { status });
      await backfillModuleCredit(scope(moduleId, u));
      expect(await findCreditedModuleIds(prisma, u.userId, courseId)).toEqual([moduleId]);
      expect((await compareModuleCredit(scope(moduleId, u))).differences).toEqual([]);
    }
  });

  it("en innlevering uten vedtak, og en forlatt, gir ingen rad", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    await prisma.submission.create({ data: { userId: u.userId, moduleId, moduleVersionId: versionId, deliveryType: "text", responseJson: "{}", submissionStatus: "SUBMITTED" } });
    await legacyDecision(u.userId, moduleId, versionId, { status: "SUPERSEDED" });
    const result = await backfillModuleCredit(scope(moduleId, u));
    expect(result.passes).toBe(0);
    expect(await passesOf(u.userId, moduleId)).toEqual([]);
  });

  it("et automatisk bestått som ventet på sensor, teller ikke; en åpen anke på en bestått gjør", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    const waiting = await legacyDecision(u.userId, moduleId, versionId, { status: "UNDER_REVIEW" });
    await prisma.manualReview.create({ data: { submissionId: waiting.submissionId, triggerReason: "Test", reviewStatus: "OPEN" } });
    await backfillModuleCredit(scope(moduleId, u));
    expect(await passesOf(u.userId, moduleId)).toEqual([]);

    const v = await learner();
    const passed = await legacyPass(v.userId, moduleId, versionId);
    await prisma.appeal.create({ data: { submissionId: passed.submissionId, appealedById: v.userId, appealReason: "Jeg ber om en ny vurdering.", appealStatus: "OPEN" } });
    await prisma.submission.update({ where: { id: passed.submissionId }, data: { submissionStatus: "UNDER_REVIEW" } });
    await backfillModuleCredit(scope(moduleId, v));
    expect(await passesOf(v.userId, moduleId)).toHaveLength(1);
  });

  it("revisjon på en versjon som alt var ute, og et vedtak på en eldre versjon etterpå: teller ikke, også når vedtaket kommer etter tilbakefyllingen", async () => {
    const { moduleId, versionId: v1 } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    const v2 = await draft(moduleId, 2);
    await publishOk(moduleId, v2);
    const before = await learner();
    await legacyPass(before.userId, moduleId, v2);
    await runContentWrite(async (tx) => {
      await recordAuditEvent({ entityType: auditEntityTypes.module, entityId: moduleId, action: auditActions.adminContent.modulePassesSuperseded, actorId: undefined, metadata: { moduleId, moduleVersionId: v2, supersededCount: 1, notifiedCount: 1 } }, tx);
      await tx.certificationStatus.updateMany({ where: { moduleId }, data: { status: "SUPERSEDED", supersededByVersionId: v2 } });
    });
    const late = await learner();
    await legacyPass(late.userId, moduleId, v1);
    const sameVersion = await learner();
    await legacyPass(sameVersion.userId, moduleId, v2);
    await forgetNumbers(moduleId);
    await forgetRequirements(moduleId);

    await backfillModuleCredit(scope(moduleId, before, late, sameVersion));
    expect([await numberOf(v1), await numberOf(v2)]).toEqual(["1.0", "2.0"]);
    expect(await requirementOf(courseId, moduleId)).toBe(2);
    expect(await findCreditedModuleIds(prisma, before.userId, courseId)).toEqual([]);
    expect(await findCreditedModuleIds(prisma, late.userId, courseId)).toEqual([]);
    expect(await findCreditedModuleIds(prisma, sameVersion.userId, courseId)).toEqual([moduleId]);

    const report = await compareModuleCredit(scope(moduleId, before, late, sameVersion));
    expect(report.differences.map((d) => [d.userId, d.reason, d.expected])).toEqual([[late.userId, "pass_on_old_version_after_revision", true]]);
    expect(report.ok).toBe(true);

    // Sensoren godkjenner den gamle innleveringen etter tilbakefyllingen, gjennom koden som skriver raden.
    const afterBackfill = await learner();
    const decided = await legacyDecision(afterBackfill.userId, moduleId, v1);
    await runLearnerWrite(afterBackfill.userId, (tx: LearnerTx) => recordModulePassFromDecision(tx, {
      id: decided.decisionId,
      submissionId: decided.submissionId,
      moduleVersionId: v1,
      passFailTotal: true,
      finalisedAt: decided.finalisedAt,
      submission: { userId: afterBackfill.userId, moduleId },
    }));
    expect(await passesOf(afterBackfill.userId, moduleId)).toHaveLength(1);
    expect(await findCreditedModuleIds(prisma, afterBackfill.userId, courseId)).toEqual([]);
  });

  it("en versjon som ble aktivert på nytt med revisjon, blir høyest, og den den tok over for, teller ikke", async () => {
    const { moduleId, versionId: v1 } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    const v2 = await draft(moduleId, 2);
    await publishOk(moduleId, v2);
    const u = await learner();
    await legacyPass(u.userId, moduleId, v2);
    // Slik gammel kode gjorde det: v1 publisert på nytt med avkrysning.
    await runContentWrite(async (tx) => {
      await tx.module.update({ where: { id: moduleId }, data: { activeVersionId: v1 } });
      await recordAuditEvent({ entityType: auditEntityTypes.module, entityId: moduleId, action: auditActions.adminContent.modulePassesSuperseded, actorId: undefined, metadata: { moduleId, moduleVersionId: v1, supersededCount: 1, notifiedCount: 1 } }, tx);
      await tx.certificationStatus.updateMany({ where: { moduleId }, data: { status: "SUPERSEDED", supersededByVersionId: v1 } });
    });
    await forgetNumbers(moduleId);
    await backfillModuleCredit(scope(moduleId, u));
    expect([await numberOf(v2), await numberOf(v1)]).toEqual(["1.0", "2.0"]);
    expect(await requirementOf(courseId, moduleId)).toBe(2);
    expect(await findCreditedModuleIds(prisma, u.userId, courseId)).toEqual([]);
    const report = await compareModuleCredit(scope(moduleId, u));
    expect(report.structure.activeVersionBelowRequirement).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("gamle rader: en versjon som er aktiv, eller har innleveringer, uten publiseringstid, får nummer; et utkast får det ikke", async () => {
    const moduleId = await newModule();
    const withSubmission = await draft(moduleId, 1);
    const active = await draft(moduleId, 2);
    const unused = await draft(moduleId, 3);
    await prisma.module.update({ where: { id: moduleId }, data: { activeVersionId: active } });
    const courseId = await courseWith([moduleId]);
    const u = await learner();
    await legacyPass(u.userId, moduleId, withSubmission);
    await forgetNumbers(moduleId);
    await backfillModuleCredit(scope(moduleId, u));
    expect([await numberOf(withSubmission), await numberOf(active), await numberOf(unused)]).toEqual(["1.0", "1.1", null]);
    expect(await findCreditedModuleIds(prisma, u.userId, courseId)).toEqual([moduleId]);
    expect((await compareModuleCredit(scope(moduleId, u))).ok).toBe(true);
  });

  it("et nummer forfatteren har fått, står gjennom en ny kjøring", async () => {
    const { moduleId, versionId } = await publishedModule();
    const v2 = await draft(moduleId, 2);
    await publishOk(moduleId, v2, { supersedesEarlierPasses: true });
    const result = await backfillModuleCredit({ moduleIds: [moduleId], userIds: [] });
    expect(result.versionsNumbered).toBe(0);
    expect([await numberOf(versionId), await numberOf(v2)]).toEqual(["1.0", "2.0"]);
  });

  it("en rad for et kurs modulen ikke lenger ligger i, fjernes", async () => {
    const { moduleId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    await runContentWrite((tx) => tx.courseItem.deleteMany({ where: { courseId } }));
    await backfillModuleCredit({ moduleIds: [moduleId], userIds: [] });
    expect(await requirementOf(courseId, moduleId)).toBeNull();
  });

  it("en deltaker som ikke får låsen, hoppes over og listes; neste kjøring tar hen", async () => {
    const { moduleId, versionId } = await publishedModule();
    const u = await learner();
    await legacyPass(u.userId, moduleId, versionId);
    let release!: () => void;
    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => { markHeld = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const lock = runLearnerWrite(u.userId, async (_tx: LearnerTx) => {
      markHeld();
      await released;
    }, { timeout: 15_000 });
    await held;
    const blocked = await backfillModuleCredit(scope(moduleId, u));
    release();
    await lock;
    expect(blocked.busy.users).toEqual([u.userId]);
    expect(blocked.users).toBe(0);
    expect(await passesOf(u.userId, moduleId)).toEqual([]);
    expect((await backfillModuleCredit(scope(moduleId, u))).passes).toBe(1);
  }, 20_000);

  it("en modul som ikke får innholdslåsen, hoppes over og listes; neste kjøring tar den", async () => {
    const { moduleId } = await publishedModule();
    await forgetNumbers(moduleId);
    let release!: () => void;
    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => { markHeld = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const lock = runContentWrite(async () => {
      markHeld();
      await released;
    }, { timeout: 25_000 });
    await held;
    const blocked = await backfillModuleCredit({ moduleIds: [moduleId], userIds: [] });
    release();
    await lock;
    expect(blocked.busy.modules).toEqual([moduleId]);
    expect(blocked.modules).toBe(0);
    expect((await backfillModuleCredit({ moduleIds: [moduleId], userIds: [] })).versionsNumbered).toBe(1);
  }, 30_000);

  it("nekter å kjøre når den nye regelen er slått på: da er kravene forfatterens valg", async () => {
    const { moduleId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    await prisma.courseModuleRequirement.update({ where: { courseId_moduleId: { courseId, moduleId } }, data: { minModuleMajor: 5 } });
    await prisma.platformConfig.upsert({ where: { key: MODULE_PASS_SWITCH_KEY }, update: { value: "on" }, create: { key: MODULE_PASS_SWITCH_KEY, value: "on" } });
    try {
      await expect(backfillModuleCredit({ moduleIds: [moduleId], userIds: [] })).rejects.toMatchObject({ code: "module_credit_backfill_refused" });
      expect(await requirementOf(courseId, moduleId)).toBe(5);
    } finally {
      await prisma.platformConfig.delete({ where: { key: MODULE_PASS_SWITCH_KEY } });
    }
  });
});

describe("#934 5a-2: sammenligningsrapporten ser en ekte forskjell (kontrollcase)", () => {
  async function clean() {
    const { moduleId, versionId } = await publishedModule();
    const courseId = await courseWith([moduleId]);
    const u = await learner();
    const decided = await legacyPass(u.userId, moduleId, versionId);
    await backfillModuleCredit({ moduleIds: [moduleId], userIds: [u.userId] });
    expect((await compareModuleCredit({ moduleIds: [moduleId], userIds: [u.userId] })).ok).toBe(true);
    return { moduleId, versionId, courseId, u, decided };
  }
  const report = (moduleId: string, userId: string) => compareModuleCredit({ moduleIds: [moduleId], userIds: [userId] });

  it("en #997-bestått som teller igjen: rød, med egen årsak", async () => {
    const c = await clean();
    await prisma.certificationStatus.update({ where: { userId_moduleId: { userId: c.u.userId, moduleId: c.moduleId } }, data: { status: "SUPERSEDED", supersededByVersionId: c.versionId } });
    const out = await report(c.moduleId, c.u.userId);
    expect(out.differences).toEqual([expect.objectContaining({ userId: c.u.userId, courseId: c.courseId, moduleId: c.moduleId, oldCredit: false, newCredit: true, reason: "superseded_pass_counts_again", expected: false })]);
    expect(out.unexplained).toBe(1);
    expect(out.ok).toBe(false);
    expect(out.byReason).toEqual({ superseded_pass_counts_again: 1 });
  });

  it("en bestått som mangler rad (vedtak fra gammel kode): rød", async () => {
    const c = await clean();
    await prisma.modulePass.deleteMany({ where: { moduleId: c.moduleId } });
    const out = await report(c.moduleId, c.u.userId);
    expect(out.differences.map((d) => [d.reason, d.oldCredit, d.newCredit])).toEqual([["unexplained", true, false]]);
    expect(out.ok).toBe(false);
  });

  it("et krav som mangler: rød, både som forskjell og som hull i dataene", async () => {
    const c = await clean();
    await prisma.courseModuleRequirement.deleteMany({ where: { moduleId: c.moduleId } });
    const out = await report(c.moduleId, c.u.userId);
    expect(out.differences.map((d) => d.reason)).toEqual(["missing_requirement"]);
    expect(out.structure.missingRequirements).toEqual([{ courseId: c.courseId, moduleId: c.moduleId }]);
    expect(out.ok).toBe(false);
  });

  it("en versjon uten nummer: rød", async () => {
    const c = await clean();
    await forgetNumbers(c.moduleId);
    const out = await report(c.moduleId, c.u.userId);
    expect(out.differences.map((d) => d.reason)).toEqual(["pass_on_unnumbered_version"]);
    expect(out.structure.unnumberedLiveVersions).toEqual([c.versionId]);
  });

  it("et krav som står feil, og en rad uten element: hull i dataene, også uten at noen deltaker merker det", async () => {
    const c = await clean();
    await prisma.courseModuleRequirement.update({ where: { courseId_moduleId: { courseId: c.courseId, moduleId: c.moduleId } }, data: { minModuleMajor: 1 } });
    await publishOk(c.moduleId, await draft(c.moduleId, 2), { supersedesEarlierPasses: true });
    const courseWithout = await newCourse();
    await prisma.courseModuleRequirement.create({ data: { courseId: courseWithout, moduleId: c.moduleId, minModuleMajor: 2 } });
    await prisma.courseModuleRequirement.update({ where: { courseId_moduleId: { courseId: c.courseId, moduleId: c.moduleId } }, data: { minModuleMajor: 1 } });
    const out = await report(c.moduleId, c.u.userId);
    expect(out.structure.orphanRequirements).toEqual([{ courseId: courseWithout, moduleId: c.moduleId }]);
    expect(out.structure.requirementsNotAtCurrentMajor).toEqual([{ courseId: c.courseId, moduleId: c.moduleId, minModuleMajor: 1, currentMajor: 2 }]);
    expect(out.ok).toBe(false);
  });

  it("en eldre versjon som gammel kode aktiverte på nytt etter en revisjon: hull i dataene, ingen kan oppfylle kravet", async () => {
    const c = await clean();
    expect((await report(c.moduleId, c.u.userId)).structure.activeVersionBelowRequirement).toEqual([]);
    await publishOk(c.moduleId, await draft(c.moduleId, 2), { supersedesEarlierPasses: true });
    expect((await report(c.moduleId, c.u.userId)).structure.activeVersionBelowRequirement).toEqual([]);
    await prisma.module.update({ where: { id: c.moduleId }, data: { activeVersionId: c.versionId } });
    const out = await report(c.moduleId, c.u.userId);
    expect(out.structure.activeVersionBelowRequirement).toEqual([{ courseId: c.courseId, moduleId: c.moduleId, activeMajor: 1, minModuleMajor: 2 }]);
    expect(out.ok).toBe(false);
  });

  it("rapporten skriver ingenting", async () => {
    const c = await clean();
    const count = async () => [await prisma.modulePass.count(), await prisma.courseModuleRequirement.count(), await prisma.moduleVersion.count({ where: { versionMajor: null } }), await prisma.auditEvent.count()];
    const before = await count();
    await report(c.moduleId, c.u.userId);
    expect(await count()).toEqual(before);
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
