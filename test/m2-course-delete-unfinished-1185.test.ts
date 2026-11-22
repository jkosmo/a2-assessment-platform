import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { createRetentionContext, evaluateArchivedCourse } from "../src/modules/content/archivedRetention.js";
import { addCalendarDays, osloCalendarDate } from "../src/modules/content/retentionDeadline.js";
import { checkCourseDelete } from "../src/modules/course/courseDeleteGuard.js";
import { withRevision } from "./support/courseRevision.js";
import { archiveCourseConfirmed } from "./support/courseArchive.js";

// #1185 (produkteier 21.11.2026: «Deltager får 7 dager så sletting», regnet «fra deltageren leverte»). doc/design/PLAN_1148, «Tillegg
// 21.11.2026».
//
// I en modul med fritekst og flervalg lages innleveringen når teksten leveres, og vurderingsjobben først når flervalget er sendt inn.
// Imens står den som SUBMITTED uten jobb. Et arkivert kurs med en slik innlevering, levert for under sju kalenderdager siden, kan ikke
// slettes (`course_has_unfinished_submissions`, med `count` og `untilDate`). Etter de sju dagene kan det. En ren flervalgsmodul som
// bare er åpnet, holder fortsatt ingenting igjen.
//
// Gjennom rutene: «Slett» (DELETE) og kurslista med `?includeRetention=1`. Innleveringene skrives direkte: ingen rute kan sette
// `submittedAt` tilbake i tid. Fiksturen setter hvert felt regelen leser (CLAUDE.md, pre-flight punkt 4): modultypen (kontrollert
// etter publisering), status, `submittedAt` og om det finnes en vurderingsjobb.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const ADMIN: Record<string, string> = { "x-user-id": "", "x-user-email": "", "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `cdel-1185-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `cdel.1185.admin.${RUN}.${adminSeq}@x.test`;
  ADMIN["x-forwarded-for"] = `10.185.${Math.floor(adminSeq / 250)}.${adminSeq % 250}`;
});
let seq = 0;
const tag = (name: string) => `1185 ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

const C = "/api/admin/content";
const DAY = 24 * 60 * 60 * 1000;
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 600);
const post = (path: string, body: object = {}) => request(app).post(path).set(ADMIN).send(body);
const del = (path: string) => request(app).delete(path).set(ADMIN);
const M = (id: string, action = "") => `${C}/modules/${id}${action}`;
const K = (id: string, action = "") => `${C}/courses/${id}${action}`;

async function ok(r: request.Response | Promise<request.Response>, label: string) {
  const res = await r;
  expect(res.status, `${label}: ${show(res)}`).toBeLessThan(300);
  return res.body;
}

type Mode = "FREETEXT_PLUS_MCQ" | "MCQ_ONLY" | "FREETEXT_ONLY";

/** En publisert modul av typen. Typen kontrolleres etter publisering, så fiksturen ikke stilltiende får standardverdien. */
async function apiModule(name: string, mode: Mode) {
  const module = await ok(post(`${C}/modules`, { title: L(tag(name)), description: L("Beskrivelse"), certificationLevel: "basic" }), "modul");
  const moduleId = module.module.id as string;
  const base = M(moduleId);
  const mcq = await ok(post(`${base}/mcq-set-versions`, { title: L("MCQ"), questions: [{ stem: L("1+1?"), options: [L("2"), L("3")], correctAnswer: L("2"), rationale: L("M") }] }), "flervalg");
  let body: Record<string, unknown>;
  if (mode === "MCQ_ONLY") {
    body = { assessmentMode: "MCQ_ONLY", mcqSetVersionId: mcq.mcqSetVersion.id, assessmentPolicy: { passRules: { mcqMinPercent: 60 } } };
  } else {
    const rubric = await ok(post(`${base}/rubric-versions`, { criteria: { relevance: "0-4" }, scalingRule: { practical_weight: 70, max_total: 20 } }), "kriterier");
    const prompt = await ok(post(`${base}/prompt-template-versions`, { systemPrompt: L("Sys"), userPromptTemplate: L("Eval"), examples: [] }), "ledetekst");
    body = {
      taskText: L("Oppgave"), assessorExpectedContent: L("Fasit"),
      rubricVersionId: rubric.rubricVersion.id, promptTemplateVersionId: prompt.promptTemplateVersion.id,
      ...(mode === "FREETEXT_ONLY" ? { assessmentMode: "FREETEXT_ONLY" } : { mcqSetVersionId: mcq.mcqSetVersion.id }),
    };
  }
  const version = await ok(post(`${base}/module-versions`, body), "modulversjon");
  await ok(post(`${base}/module-versions/${version.moduleVersion.id}/publish`), "publiser modul");
  const stored = await prisma.moduleVersion.findUniqueOrThrow({ where: { id: version.moduleVersion.id }, select: { assessmentMode: true } });
  expect(stored.assessmentMode, "fiksturen har riktig modultype").toBe(mode);
  return { moduleId, versionId: version.moduleVersion.id as string };
}

/** Et kurs med modulen, arkivert (modulen følger med). */
async function archivedCourse(name: string, mode: Mode) {
  const module = await apiModule(`${name} modul`, mode);
  const created = await ok(post(`${C}/courses`, { title: L(tag(name)) }), "kurs");
  const courseId = created.course.id as string;
  const r = await request(app).put(K(courseId, "/items")).set(ADMIN).send(await withRevision(courseId, { items: [{ type: "MODULE", moduleId: module.moduleId }] }));
  expect(r.status, show(r)).toBe(204);
  const { response } = await archiveCourseConfirmed(courseId, ADMIN);
  expect(response.status, show(response)).toBe(200);
  return { courseId, module };
}

async function user(name: string) {
  const id = `cdel-1185-${name}-${RUN}-${seq++}`;
  await prisma.user.upsert({ where: { id }, update: {}, create: { id, email: `${id}@x.test`, name, externalId: id } });
  return id;
}

/** Innleveringen slik deltakeren etterlot den: SUBMITTED, levert for `daysAgo` dager siden, med eller uten vurderingsjobb. */
async function delivered(userId: string, module: { moduleId: string; versionId: string }, daysAgo: number, withJob = false) {
  const submittedAt = new Date(Date.now() - daysAgo * DAY);
  const created = await prisma.submission.create({
    data: { userId, moduleId: module.moduleId, moduleVersionId: module.versionId, deliveryType: "text", submissionStatus: "SUBMITTED", submittedAt },
    select: { id: true },
  });
  if (withJob) await prisma.assessmentJob.create({ data: { submissionId: created.id, status: "PENDING" } });
  return { id: created.id, submittedAt };
}

const untilFor = (submittedAt: Date) => addCalendarDays(osloCalendarDate(submittedAt), 7);

/** Kurslista slik klienten leser den under «Arkiverte». */
async function listRetention(courseId: string) {
  const response = await request(app).get(`${C}/courses?includeRetention=1`).set(ADMIN);
  expect(response.status, show(response)).toBe(200);
  const row = (response.body.courses as Array<{ id: string; retention?: unknown }>).find((c) => c.id === courseId);
  expect(row, "kurset står i lista").toBeTruthy();
  return row?.retention;
}

describe("#1185: levert tekst uten fullført flervalg holder et arkivert kurs igjen i sju dager", () => {
  it("levert for 1 dag siden → «Slett» og lista sier course_has_unfinished_submissions med antall og dato; kurset står", async () => {
    const x = await archivedCourse("en dag", "FREETEXT_PLUS_MCQ");
    const sub = await delivered(await user("en-dag"), x.module, 1);

    const refused = await del(K(x.courseId));
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("course_has_unfinished_submissions");
    expect(refused.body.details).toEqual({ count: 1, untilDate: untilFor(sub.submittedAt) });
    expect(await prisma.course.count({ where: { id: x.courseId } })).toBe(1);

    expect(await listRetention(x.courseId)).toEqual({ kept: { code: "course_has_unfinished_submissions", details: { count: 1, untilDate: untilFor(sub.submittedAt) } } });
  });

  it("KONTROLL: levert for 8 dager siden → kurset slettes; modulen og teksten står (levert innlevering holder modulen)", async () => {
    const x = await archivedCourse("åtte dager", "FREETEXT_PLUS_MCQ");
    const sub = await delivered(await user("atte-dager"), x.module, 8);

    const deleted = await del(K(x.courseId));
    expect(deleted.status, show(deleted)).toBe(204);
    expect(await prisma.course.count({ where: { id: x.courseId } })).toBe(0);
    expect(await prisma.submission.count({ where: { id: sub.id } }), "teksten står").toBe(1);
    expect(await prisma.module.count({ where: { id: x.module.moduleId } }), "modulen står").toBe(1);
  });

  it("KONTROLL: en ren flervalgsmodul som bare er åpnet (SUBMITTED uten jobb, i dag) holder ikke kurset igjen", async () => {
    const x = await archivedCourse("bare åpnet", "MCQ_ONLY");
    await delivered(await user("apnet"), x.module, 0);
    const deleted = await del(K(x.courseId));
    expect(deleted.status, show(deleted)).toBe(204);
  });

  it("KONTROLL: med vurderingsjobb er det «venter på vurdering» som før, også etter sju dager", async () => {
    const x = await archivedCourse("med jobb", "FREETEXT_PLUS_MCQ");
    await delivered(await user("jobb"), x.module, 8, true);
    const refused = await del(K(x.courseId));
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("course_has_pending_reviews");
    // Kaskadens forhåndsvisning viser ALLE grunnene: en innlevering med jobb venter på vurdering, den er ikke «levert uten å fullføre».
    // (Gjennom «Slett» alene ville det ikke synes, fordi «venter på vurdering» sies først.)
    const preview = await ok(request(app).get(K(x.courseId, "/cascade-delete-preview")).set(ADMIN), "forhåndsvisning");
    expect((preview.blockers as Array<{ id: string; code?: string }>).filter((b) => b.id === x.courseId).map((b) => b.code)).toEqual(["course_has_pending_reviews"]);
  });

  it("i kaskadens forhåndsvisning står grunnen med antall og dato, ved siden av en sak som venter", async () => {
    const x = await archivedCourse("kaskade", "FREETEXT_PLUS_MCQ");
    await delivered(await user("kaskade-jobb"), x.module, 1, true);
    const sub = await delivered(await user("kaskade-tekst"), x.module, 2);
    const preview = await ok(request(app).get(K(x.courseId, "/cascade-delete-preview")).set(ADMIN), "forhåndsvisning");
    const mine = (preview.blockers as Array<{ id: string; code?: string; details?: unknown }>).filter((b) => b.id === x.courseId);
    expect(mine.map((b) => [b.code, b.details])).toEqual([
      ["course_has_pending_reviews", { count: 1 }],
      ["course_has_unfinished_submissions", { count: 1, untilDate: untilFor(sub.submittedAt) }],
    ]);
  });

  it("bare fritekst uten jobb (et unntak) teller også, i sju dager", async () => {
    const x = await archivedCourse("bare fritekst", "FREETEXT_ONLY");
    await delivered(await user("fritekst"), x.module, 2);
    const refused = await del(K(x.courseId));
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("course_has_unfinished_submissions");
  });

  it("to deltakere: antallet er deltakerne, datoen er fra den SISTE leveringen; én deltaker med to innleveringer telles én gang", async () => {
    const x = await archivedCourse("to", "FREETEXT_PLUS_MCQ");
    const first = await user("forste");
    await delivered(first, x.module, 5);
    await delivered(first, x.module, 3);
    const latest = await delivered(await user("andre"), x.module, 1);
    const refused = await del(K(x.courseId));
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.details).toEqual({ count: 2, untilDate: untilFor(latest.submittedAt) });
  });

  it("KLOKKA: samme innlevering, målt åtte dager fram (jobben, skriptet), kan slettes; målt nå, beholdes", async () => {
    const x = await archivedCourse("klokka", "FREETEXT_PLUS_MCQ");
    await delivered(await user("klokka"), x.module, 0);
    const later = new Date(Date.now() + 8 * DAY);

    const nowCheck = await checkCourseDelete(x.courseId, prisma);
    expect(nowCheck.status).toBe("blocked");
    const laterCheck = await checkCourseDelete(x.courseId, prisma, { now: later });
    expect(laterCheck.status).toBe("deletable");

    // Lista med samme klokke: en dato, ikke «beholdes».
    const ctx = await createRetentionContext(prisma, later);
    expect(await evaluateArchivedCourse(ctx, x.courseId)).toHaveProperty("deletesAt");
  });

  it("grensen er norsk kalenderdato: levert for nøyaktig 7 dager siden → kan slettes; for 6 dager siden → beholdes", async () => {
    const x6 = await archivedCourse("seks", "FREETEXT_PLUS_MCQ");
    await delivered(await user("seks"), x6.module, 6);
    expect((await del(K(x6.courseId))).status).toBe(400);

    const x7 = await archivedCourse("sju", "FREETEXT_PLUS_MCQ");
    await delivered(await user("sju"), x7.module, 7);
    const deleted = await del(K(x7.courseId));
    expect(deleted.status, show(deleted)).toBe(204);
  });
});
