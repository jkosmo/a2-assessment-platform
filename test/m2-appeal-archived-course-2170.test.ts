import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { withRevision } from "./support/courseRevision.js";
import { archiveCourseConfirmed } from "./support/courseArchive.js";

// 2.170.0 (produkteier 21.11.2026, doc/DECISIONS.md «Hva som holder et arkivert kurs igjen fra sletting»): «Det skal ikke være
// mulig å anke et arkivert kurs, da må student heller få en informativ feilmelding som forteller at kurset er arkivert».
//
// En innlevering kjenner bare modulen, så regelen går gjennom den (godkjent tolkning): anke stoppes når modulen er arkivert, eller
// når alle kursene den står i, er arkivert. Står den i minst ett aktivt kurs, kan den ankes.
//
// Gjennom ruta (`POST /api/submissions/:id/appeals`). Stryket skrives direkte (vedtakssporet), som i m2-course-delete-1152.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const ADMIN: Record<string, string> = { "x-user-id": "", "x-user-email": "", "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `appeal-2170-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `appeal.2170.admin.${RUN}.${adminSeq}@x.test`;
  ADMIN["x-forwarded-for"] = `10.170.${Math.floor(adminSeq / 250)}.${adminSeq % 250}`;
});
let seq = 0;
const tag = (name: string) => `2170 ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

const C = "/api/admin/content";
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 600);
const post = (path: string, body: object = {}) => request(app).post(path).set(ADMIN).send(body);
const M = (id: string, action = "") => `${C}/modules/${id}${action}`;
const K = (id: string, action = "") => `${C}/courses/${id}${action}`;

async function ok(r: request.Response | Promise<request.Response>, label: string) {
  const res = await r;
  expect(res.status, `${label}: ${show(res)}`).toBeLessThan(300);
  return res.body;
}

/** En publisert modul med kriterier, ledetekst, flervalg og en nummerert versjon (som m2-course-delete-1152). */
async function apiModule(name: string) {
  const module = await ok(post(`${C}/modules`, { title: L(tag(name)), description: L("Beskrivelse"), certificationLevel: "basic" }), "modul");
  const moduleId = module.module.id as string;
  const base = M(moduleId);
  const rubric = await ok(post(`${base}/rubric-versions`, { criteria: { relevance: "0-4" }, scalingRule: { practical_weight: 70, max_total: 20 } }), "kriterier");
  const prompt = await ok(post(`${base}/prompt-template-versions`, { systemPrompt: L("Sys"), userPromptTemplate: L("Eval"), examples: [] }), "ledetekst");
  const mcq = await ok(post(`${base}/mcq-set-versions`, { title: L("MCQ"), questions: [{ stem: L("1+1?"), options: [L("2"), L("3")], correctAnswer: L("2"), rationale: L("M") }] }), "flervalg");
  const version = await ok(post(`${base}/module-versions`, {
    taskText: L("Oppgave"), assessorExpectedContent: L("Fasit"),
    rubricVersionId: rubric.rubricVersion.id, promptTemplateVersionId: prompt.promptTemplateVersion.id, mcqSetVersionId: mcq.mcqSetVersion.id,
  }), "modulversjon");
  await ok(post(`${base}/module-versions/${version.moduleVersion.id}/publish`), "publiser modul");
  return moduleId;
}

async function apiCourse(name: string, moduleId: string) {
  const created = await ok(post(`${C}/courses`, { title: L(tag(name)) }), "kurs");
  const id = created.course.id as string;
  const r = await request(app).put(K(id, "/items")).set(ADMIN).send(await withRevision(id, { items: [{ type: "MODULE", moduleId }] }));
  expect(r.status, show(r)).toBe(204);
  return id;
}

async function archiveCourse(courseId: string) {
  const { response } = await archiveCourseConfirmed(courseId, ADMIN);
  expect(response.status, show(response)).toBe(200);
}

/** En deltaker med et ferdig vurdert stryk på modulen. Direkte: vedtakssporet. */
async function failedSubmission(moduleId: string) {
  const userId = `appeal-2170-${RUN}-${seq++}`;
  await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, email: `${userId}@x.test`, name: "Deltaker", externalId: userId } });
  const version = await prisma.moduleVersion.findFirstOrThrow({ where: { moduleId, publishedAt: { not: null } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const submission = await prisma.submission.create({
    data: { userId, moduleId, moduleVersionId: version.id, deliveryType: "text", submissionStatus: "COMPLETED" },
    select: { id: true },
  });
  await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id, moduleVersionId: version.id, mcqScaledScore: 0, practicalScaledScore: 0, totalScore: 0, redFlagsJson: "[]",
      passFailTotal: false, decisionType: "AUTOMATIC", decisionReason: "Fikstur for 2.170.0.",
    },
  });
  const headers = { "x-user-id": userId, "x-user-email": `${userId}@x.test`, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT", "x-locale": "nb" };
  const appeal = () => request(app).post(`/api/submissions/${submission.id}/appeals`).set(headers).send({ appealReason: "Jeg ber om ny vurdering." });
  return { submissionId: submission.id, appeal };
}

describe("2.170.0: et arkivert kurs kan ikke ankes", () => {
  it("modulen står bare i et arkivert kurs: 400 appeal_course_archived, ingen anke, innleveringen urørt", async () => {
    const moduleId = await apiModule("bare arkivert");
    const course = await apiCourse("bare arkivert", moduleId);
    const { submissionId, appeal } = await failedSubmission(moduleId);
    await archiveCourse(course);

    const r = await appeal();
    expect(r.status, show(r)).toBe(400);
    expect(r.body.error).toBe("appeal_course_archived");
    expect(await prisma.appeal.count({ where: { submissionId } })).toBe(0);
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: submissionId }, select: { submissionStatus: true } })).submissionStatus).toBe("COMPLETED");
  });

  it("modulen er arkivert (for seg, uten kurs): 400 appeal_course_archived", async () => {
    // En modul i et aktivt kurs kan ikke arkiveres for seg (#1149); denne står ikke i noe kurs.
    const moduleId = await apiModule("modul arkivert");
    const { appeal } = await failedSubmission(moduleId);
    await ok(post(M(moduleId, "/archive")), "arkiver modulen");
    const r = await appeal();
    expect(r.status, show(r)).toBe(400);
    expect(r.body.error).toBe("appeal_course_archived");
  });

  it("KONTROLL: modulen står også i et aktivt kurs: anken går (201), og gjelder det aktive kurset", async () => {
    const moduleId = await apiModule("delt");
    const archived = await apiCourse("delt arkivert", moduleId);
    await apiCourse("delt aktivt", moduleId);
    const { submissionId, appeal } = await failedSubmission(moduleId);
    await archiveCourse(archived);
    expect(await prisma.module.findUniqueOrThrow({ where: { id: moduleId }, select: { archivedAt: true } })).toEqual({ archivedAt: null });

    const r = await appeal();
    expect(r.status, show(r)).toBe(201);
    expect(await prisma.appeal.count({ where: { submissionId } })).toBe(1);
  });
});
