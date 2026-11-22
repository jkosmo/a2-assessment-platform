import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1176: en arkivert modul der deltakere bare har ÅPNET modulen (innlevering SUBMITTED uten noe levert, og for flervalg et forsøk
// uten svar), kan slettes, og de tomme radene går med. En LEVERT innlevering holder den igjen som før.
//
// Gjennom rutene. Innleveringene og forsøkene skrives direkte: slik åpningen av modulen lager dem (og slik vurderingssporet merker
// dem levert), uten å gå gjennom deltakerflyten.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const ADMIN: Record<string, string> = { "x-user-id": "", "x-user-email": "", "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `mdel-1176-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `mdel.1176.admin.${RUN}.${adminSeq}@x.test`;
  ADMIN["x-forwarded-for"] = `10.176.${Math.floor(adminSeq / 250)}.${adminSeq % 250}`;
});
let seq = 0;
const tag = (name: string) => `1176 ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

const C = "/api/admin/content";
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 600);
const post = (path: string, body: object = {}) => request(app).post(path).set(ADMIN).send(body);
const M = (id: string, action = "") => `${C}/modules/${id}${action}`;

async function ok(r: request.Response | Promise<request.Response>, label: string) {
  const res = await r;
  expect(res.status, `${label}: ${show(res)}`).toBeLessThan(300);
  return res.body;
}

type Mode = "MCQ_ONLY" | "FREETEXT_PLUS_MCQ";

/**
 * En publisert modul i ingen kurs (arkiveres i testen). `MCQ_ONLY`: en ren flervalgsmodul, der innleveringen lages når modulen
 * åpnes. `FREETEXT_PLUS_MCQ`: fritekst og flervalg, der innleveringen lages når deltakeren leverer teksten (QA 2.172.0).
 */
async function archivedModule(name: string, mode: Mode = "MCQ_ONLY") {
  const module = await ok(post(`${C}/modules`, { title: L(tag(name)), description: L("Beskrivelse"), certificationLevel: "basic" }), "modul");
  const moduleId = module.module.id as string;
  const base = M(moduleId);
  const mcq = await ok(post(`${base}/mcq-set-versions`, { title: L("MCQ"), questions: [{ stem: L("1+1?"), options: [L("2"), L("3")], correctAnswer: L("2"), rationale: L("M") }] }), "flervalg");
  let body: Record<string, unknown> = { assessmentMode: "MCQ_ONLY", mcqSetVersionId: mcq.mcqSetVersion.id, assessmentPolicy: { passRules: { mcqMinPercent: 60 } } };
  if (mode === "FREETEXT_PLUS_MCQ") {
    const rubric = await ok(post(`${base}/rubric-versions`, { criteria: { relevance: "0-4" }, scalingRule: { practical_weight: 70, max_total: 20 } }), "kriterier");
    const prompt = await ok(post(`${base}/prompt-template-versions`, { systemPrompt: L("Sys"), userPromptTemplate: L("Eval"), examples: [] }), "ledetekst");
    body = {
      taskText: L("Oppgave"), assessorExpectedContent: L("Fasit"),
      rubricVersionId: rubric.rubricVersion.id, promptTemplateVersionId: prompt.promptTemplateVersion.id, mcqSetVersionId: mcq.mcqSetVersion.id,
    };
  }
  const version = await ok(post(`${base}/module-versions`, body), "modulversjon");
  await ok(post(`${base}/module-versions/${version.moduleVersion.id}/publish`), "publiser modul");
  const stored = await prisma.moduleVersion.findUniqueOrThrow({ where: { id: version.moduleVersion.id }, select: { assessmentMode: true } });
  expect(stored.assessmentMode, "fiksturen har riktig modultype").toBe(mode);
  return { moduleId, moduleVersionId: version.moduleVersion.id as string, mcqSetVersionId: mcq.mcqSetVersion.id as string };
}

async function user() {
  const id = `mdel-1176-${RUN}-${seq++}`;
  await prisma.user.upsert({ where: { id }, update: {}, create: { id, email: `${id}@x.test`, name: "Deltaker", externalId: id } });
  return id;
}

/**
 * Slik klienten lager det: en innlevering SUBMITTED, og (flervalg) et forsøk uten svar. `responseJson` som klienten sender: tomt
 * for en ren flervalgsmodul, den leverte teksten for en modul med fritekst (participant.js, «/api/submissions»).
 */
async function opened(m: { moduleId: string; moduleVersionId: string; mcqSetVersionId: string }, withAttempt = true, responseJson = "{}") {
  const submission = await prisma.submission.create({
    data: { userId: await user(), moduleId: m.moduleId, moduleVersionId: m.moduleVersionId, deliveryType: "text", responseJson, submissionStatus: "SUBMITTED" },
    select: { id: true },
  });
  const attempt = withAttempt
    ? await prisma.mCQAttempt.create({ data: { submissionId: submission.id, mcqSetVersionId: m.mcqSetVersionId, startedAt: new Date() }, select: { id: true } })
    : null;
  return { submissionId: submission.id, attemptId: attempt?.id ?? null };
}

const archive = (moduleId: string) => ok(post(M(moduleId, "/archive")), "arkiver modulen");
const del = (moduleId: string) => request(app).delete(M(moduleId)).set(ADMIN);
const counts = (moduleId: string) => Promise.all([
  prisma.module.count({ where: { id: moduleId } }),
  prisma.submission.count({ where: { moduleId } }),
]);

describe("#1176: en modul som bare er åpnet, aldri levert, kan slettes", () => {
  it("bare åpnede innleveringer (med og uten flervalgsforsøk): «Slett» sletter modulen, og de tomme radene er borte; lista sier ikke «beholdes»", async () => {
    const m = await archivedModule("bare åpnet");
    const a = await opened(m, true);
    const b = await opened(m, false);
    await archive(m.moduleId);

    const list = await request(app).get(`${C}/modules/library?includeRetention=1`).set(ADMIN);
    expect(list.status, show(list)).toBe(200);
    const row = (list.body.modules as Array<{ id: string; retention?: { kept?: unknown; deletesAt?: string } }>).find((x) => x.id === m.moduleId);
    expect(row?.retention?.kept, "lista skal ikke si «beholdes: har besvarelser»").toBeUndefined();
    expect(row?.retention?.deletesAt, "lista skal vise datoen").toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const r = await del(m.moduleId);
    expect(r.status, show(r)).toBe(200);
    expect(r.body.deletedModule?.id).toBe(m.moduleId);
    expect(await counts(m.moduleId)).toEqual([0, 0]);
    expect(await prisma.submission.count({ where: { id: { in: [a.submissionId, b.submissionId] } } })).toBe(0);
    expect(await prisma.mCQAttempt.count({ where: { id: a.attemptId! } })).toBe(0);
  });

  // QA 2.172.0 (NO-GO i første versjon): i en modul med fritekst og flervalg lages innleveringen når teksten leveres, og den står som
  // SUBMITTED uten vurderingsjobb til flervalget er sendt inn. Den er levert arbeid og skal aldri slettes.
  it("KONTROLL (QA-funnet): fritekst levert, flervalget ikke sendt inn ennå — holdes igjen, og teksten står", async () => {
    const m = await archivedModule("fritekst levert", "FREETEXT_PLUS_MCQ");
    const text = JSON.stringify({ response: "Mitt leverte svar, som ikke er vurdert ennå." });
    const s = await opened(m, true, text);
    await archive(m.moduleId);
    const r = await del(m.moduleId);
    expect(r.status, show(r)).toBe(400);
    expect(r.body.error).toBe("module_has_submissions");
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: s.submissionId }, select: { responseJson: true } })).responseJson).toBe(text);
  });

  const firstQuestion = (moduleId: string) => prisma.mCQQuestion.findFirstOrThrow({ where: { moduleId }, select: { id: true } });
  const delivered: Array<[string, (m: Awaited<ReturnType<typeof archivedModule>>, s: { submissionId: string; attemptId: string | null }) => Promise<unknown>]> = [
    ["vurderingsjobb", (_m, s) => prisma.assessmentJob.create({ data: { submissionId: s.submissionId, status: "PENDING" } })],
    ["flervalg besvart (forsøket fullført)", (_m, s) => prisma.mCQAttempt.update({ where: { id: s.attemptId! }, data: { completedAt: new Date() } })],
    ["flervalg med svar, men forsøket ikke markert fullført", async (m, s) => prisma.mCQResponse.create({ data: { mcqAttemptId: s.attemptId!, questionId: (await firstQuestion(m.moduleId)).id, selectedAnswer: "2", isCorrect: true } })],
    ["vurdert (status COMPLETED)", (_m, s) => prisma.submission.update({ where: { id: s.submissionId }, data: { submissionStatus: "COMPLETED" } })],
    ["en avgjørelse", (m, s) => prisma.assessmentDecision.create({
      data: {
        submissionId: s.submissionId, moduleVersionId: m.moduleVersionId, mcqScaledScore: 0, practicalScaledScore: 0, totalScore: 0, redFlagsJson: "[]",
        passFailTotal: false, decisionType: "AUTOMATIC", decisionReason: "Fikstur for #1176.",
      },
    })],
  ];
  for (const [label, deliver] of delivered) {
    it(`KONTROLL, ren flervalgsmodul, ${label}: holdes igjen med module_has_submissions, og ingenting slettes`, async () => {
      const m = await archivedModule(`levert ${label}`);
      const empty = await opened(m, true);
      const real = await opened(m, true);
      await deliver(m, real);
      await archive(m.moduleId);

      const r = await del(m.moduleId);
      expect(r.status, show(r)).toBe(400);
      expect(r.body.error).toBe("module_has_submissions");
      // Tallet er de leverte, ikke de åpnede.
      expect(r.body.details).toEqual({ count: 1 });
      expect(await counts(m.moduleId)).toEqual([1, 2]);
      expect(await prisma.submission.count({ where: { id: empty.submissionId } })).toBe(1);
    });
  }
});
