import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { runContentWrite, runLearnerWrite, type LearnerTx } from "../src/db/contentLock.js";
import { deleteModuleInTx } from "../src/modules/adminContent/adminContentCommands.js";
import { deleteCourseInTx } from "../src/modules/course/courseCommands.js";
import { deleteSectionInTx } from "../src/modules/course/sectionCommands.js";
import { withRevision } from "./support/courseRevision.js";
import { archiveCourseConfirmed } from "./support/courseArchive.js";
import { recordFixturePass } from "./support/modulePassFixture.js";

// #1152 skive 4a-2 (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Etter gjennomlesingen», punkt 1–3 og 5): HVA SOM HOLDER ET
// ARKIVERT KURS IGJEN FRA SLETTING, og kaskaden med de samme reglene.
//
//   1. «Fullført uten kursbevis»: kravet måles slik det var da kurset ble arkivert. Det som fulgte kurset inn i arkivet, teller;
//      en modul arkivert for seg og en seksjon som aldri ble publisert, gjør det ikke.
//   2. «Venter på vurdering»: en besvarelse i kravets moduler som venter på vurdering, manuell behandling eller anke.
//   3. Låsene: et vedtak som kommer mens slettingen holder deltakerlåsene, venter, og slettingen ser resultatet.
//   4. Kaskaden: samme vakter, bare arkiverte elementer slettes, én hendelse per seksjon, utkast stopper.
//   5. De indre funksjonene hopper over en rad som er borte; rutene svarer 404 som før.
//
// Gjennom rutene (supertest). Det ingen rute kan lage, skrives direkte og er merket: en bestått (vedtakssporet), en lesing etter
// arkiveringen (lesestien slipper ikke inn i et arkivert kurs), en sak som venter, og et utkast som nevner et arkivert element.
// Beståtte og lesinger skrives ETTER arkiveringen: arkiveringen utsteder ellers beviset selv (#1150 2a-2).

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const ADMIN: Record<string, string> = { "x-user-id": "", "x-user-email": "", "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `cdel-1152-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `cdel.1152.admin.${RUN}.${adminSeq}@x.test`;
  ADMIN["x-forwarded-for"] = `10.153.${Math.floor(adminSeq / 250)}.${adminSeq % 250}`;
});
let seq = 0;
const tag = (name: string) => `1152c ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

const C = "/api/admin/content";
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 600);
const post = (path: string, body: object = {}) => request(app).post(path).set(ADMIN).send(body);
const get = (path: string) => request(app).get(path).set(ADMIN);
const del = (path: string) => request(app).delete(path).set(ADMIN);
const S = (id: string, action = "") => `${C}/sections/${id}${action}`;
const M = (id: string, action = "") => `${C}/modules/${id}${action}`;
const K = (id: string, action = "") => `${C}/courses/${id}${action}`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ok(r: request.Response | Promise<request.Response>, label: string) {
  const res = await r;
  expect(res.status, `${label}: ${show(res)}`).toBeLessThan(300);
  return res.body;
}

function expectRefused(r: request.Response, code: string, count?: number) {
  expect(r.status, show(r)).toBe(400);
  expect(r.body.error, show(r)).toBe(code);
  if (count !== undefined) expect(r.body.details, show(r)).toEqual({ count });
}

// ── Fiksturer ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** En seksjon. `publish: false`: et utkast som aldri ble publisert. */
async function apiSection(name: string, publish = true) {
  const created = await ok(post(`${C}/sections`, { title: L(tag(name)), bodyMarkdown: L("Tekst."), draft: !publish }), "seksjon");
  const id = created.section.id as string;
  if (publish) await ok(post(S(id, "/publish")), "publiser seksjon");
  return id;
}

/** En publisert modul med kriterier, ledetekst, flervalg og en nummerert versjon. */
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

type Item = { type: "MODULE"; moduleId: string } | { type: "SECTION"; sectionId: string };

/** Et kurs med elementene. Ikke publisert: et kurs med en upublisert seksjon kan ikke publiseres, og kravet spør ikke om det. */
async function apiCourse(name: string, items: Item[]) {
  const created = await ok(post(`${C}/courses`, { title: L(tag(name)) }), "kurs");
  const id = created.course.id as string;
  const r = await request(app).put(K(id, "/items")).set(ADMIN).send(await withRevision(id, { items }));
  expect(r.status, show(r)).toBe(204);
  return id;
}

async function archiveCourse(courseId: string) {
  const { response } = await archiveCourseConfirmed(courseId, ADMIN);
  expect(response.status, show(response)).toBe(200);
}

async function user(name: string) {
  const id = `cdel-1152-${name}-${RUN}-${seq++}`;
  await prisma.user.upsert({ where: { id }, update: {}, create: { id, email: `${id}@x.test`, name, externalId: id } });
  return id;
}

const publishedVersion = (moduleId: string) =>
  prisma.moduleVersion.findFirstOrThrow({ where: { moduleId, publishedAt: { not: null } }, orderBy: { createdAt: "desc" }, select: { id: true } });

/** Bestått, slik vedtakssporet skriver det (innlevering ferdig vurdert, vedtak, ModulePass). Direkte: vedtakssporet. */
async function pass(userId: string, moduleId: string) {
  const version = await publishedVersion(moduleId);
  const submission = await prisma.submission.create({
    data: { userId, moduleId, moduleVersionId: version.id, deliveryType: "text", submissionStatus: "COMPLETED" },
    select: { id: true },
  });
  const decision = await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id, moduleVersionId: version.id, mcqScaledScore: 1, practicalScaledScore: 1, totalScore: 1, redFlagsJson: "[]",
      passFailTotal: true, decisionType: "AUTOMATIC", decisionReason: "Fikstur for #1152.",
    },
    select: { id: true },
  });
  await recordFixturePass({ userId, moduleId, moduleVersionId: version.id, submissionId: submission.id, decisionId: decision.id });
}

/** En lesing i kurset, etter arkiveringen. Direkte: lesestien slipper ikke inn i et arkivert kurs. */
async function read(userId: string, courseId: string, sectionId: string) {
  await prisma.courseSectionRead.create({ data: { userId, courseId, sectionId, readAt: new Date() } });
}

/**
 * En besvarelse med status, som ikke er bestått. Direkte: vurderingen i køen. En LEVERT besvarelse med status SUBMITTED har en
 * vurderingsjobb; `bareÅpnet` er modulen åpnet uten å levere (innleveringen lages ved åpning, før noe er levert).
 */
async function submission(userId: string, moduleId: string, status: "SUBMITTED" | "UNDER_REVIEW" | "COMPLETED", bareÅpnet = false) {
  const version = await publishedVersion(moduleId);
  const created = await prisma.submission.create({ data: { userId, moduleId, moduleVersionId: version.id, deliveryType: "text", submissionStatus: status }, select: { id: true } });
  if (status === "SUBMITTED" && !bareÅpnet) await prisma.assessmentJob.create({ data: { submissionId: created.id, status: "PENDING" } });
  return created;
}

const exists = {
  course: (id: string) => prisma.course.count({ where: { id } }),
  module: (id: string) => prisma.module.count({ where: { id } }),
  section: (id: string) => prisma.courseSection.count({ where: { id } }),
};

/** Kurs X med en eksklusiv modul og en eksklusiv seksjon, arkivert (begge fulgte med). */
async function archivedCourseWithModuleAndSection(name: string) {
  const module = await apiModule(`${name} modul`);
  const section = await apiSection(`${name} seksjon`);
  const course = await apiCourse(name, [{ type: "MODULE", moduleId: module }, { type: "SECTION", sectionId: section }]);
  await archiveCourse(course);
  const marks = await prisma.module.findUniqueOrThrow({ where: { id: module }, select: { archivedWithCourseId: true } });
  expect(marks.archivedWithCourseId, "modulen fulgte kurset").toBe(course);
  return { course, module, section };
}

// ── 1. Fullført uten kursbevis ──────────────────────────────────────────────────────────────────────────────────────────────

describe("#1152: «fullført uten kursbevis» holder kurset igjen, målt slik kravet var da kurset ble arkivert", () => {
  it("alt som fulgte kurset er bestått og lest → course_has_completed_without_certificate med tallet; KONTROLL: halvveis → slettes", async () => {
    const done = await archivedCourseWithModuleAndSection("fullført");
    const learner = await user("ferdig");
    await pass(learner, done.module);
    await read(learner, done.course, done.section);
    expectRefused(await del(K(done.course)), "course_has_completed_without_certificate", 1);
    expect(await exists.course(done.course)).toBe(1);

    // Kontroll: samme kurs, deltakeren har bare lest. Ikke fullført; ingenting venter (innleveringen er ferdig vurdert uten bestått).
    const half = await archivedCourseWithModuleAndSection("halvveis");
    const other = await user("halvveis");
    await read(other, half.course, half.section);
    await submission(other, half.module, "COMPLETED");
    expect((await del(K(half.course))).status).toBe(204);
    expect(await exists.course(half.course)).toBe(0);
  });

  it("en seksjon som aldri ble publisert, er ikke med i kravet: den som har fullført resten, holder kurset igjen", async () => {
    const module = await apiModule("upublisert-kurs modul");
    const published = await apiSection("upublisert-kurs publisert");
    const draft = await apiSection("upublisert-kurs aldri publisert", false);
    const course = await apiCourse("med upublisert seksjon", [
      { type: "MODULE", moduleId: module }, { type: "SECTION", sectionId: published }, { type: "SECTION", sectionId: draft },
    ]);
    await archiveCourse(course);
    const draftRow = await prisma.courseSection.findUniqueOrThrow({ where: { id: draft }, select: { archivedWithCourseId: true, activeVersionIdBeforeArchive: true } });
    expect(draftRow, "utkastet fulgte kurset, uten publisert versjon").toEqual({ archivedWithCourseId: course, activeVersionIdBeforeArchive: null });

    const learner = await user("resten");
    await pass(learner, module);
    await read(learner, course, published);
    expectRefused(await del(K(course)), "course_has_completed_without_certificate", 1);
  });

  it("en modul arkivert for seg før kurset slettes, er ikke med i kravet: den som har bestått resten, holder kurset igjen", async () => {
    const own = await apiModule("for seg");
    const rest = await apiModule("resten");
    const course = await apiCourse("modul for seg", [{ type: "MODULE", moduleId: own }, { type: "MODULE", moduleId: rest }]);
    await archiveCourse(course);
    // Modulen tas ut av arkivet for seg (merket nullstilles) og arkiveres for hånd igjen: arkivert for seg, uten merket.
    await ok(post(M(own, "/restore")), "gjenopprett modulen");
    await ok(post(M(own, "/archive")), "arkiver modulen for seg");
    expect(await prisma.module.findUniqueOrThrow({ where: { id: own }, select: { archivedWithCourseId: true } })).toEqual({ archivedWithCourseId: null });

    const learner = await user("bare resten");
    await pass(learner, rest);
    expectRefused(await del(K(course)), "course_has_completed_without_certificate", 1);
  });

  it("KONTROLL: bare en DELT modul bestått, i et kurs der den eksklusive fulgte med inn i arkivet → ikke fullført → slettes", async () => {
    const shared = await apiModule("delt");
    const exclusive = await apiModule("eksklusiv");
    const course = await apiCourse("delt og eksklusiv", [{ type: "MODULE", moduleId: shared }, { type: "MODULE", moduleId: exclusive }]);
    await apiCourse("bruker den delte", [{ type: "MODULE", moduleId: shared }]);
    await archiveCourse(course);
    expect(await prisma.module.findUniqueOrThrow({ where: { id: exclusive }, select: { archivedWithCourseId: true } })).toEqual({ archivedWithCourseId: course });
    expect(await prisma.module.findUniqueOrThrow({ where: { id: shared }, select: { archivedAt: true } })).toEqual({ archivedAt: null });

    const learner = await user("bare delt");
    await pass(learner, shared);
    const deleted = await del(K(course));
    expect(deleted.status, show(deleted)).toBe(204);
    expect(await exists.course(course)).toBe(0);
  });

  it("KONTROLL: modulen bestått, men seksjonen som fulgte kurset ikke lest → ikke fullført → slettes", async () => {
    const x = await archivedCourseWithModuleAndSection("ulest seksjon");
    await pass(await user("ulest"), x.module);
    const deleted = await del(K(x.course));
    expect(deleted.status, show(deleted)).toBe(204);
  });

  it("et kurs uten krav gjør ingen fullført, også når noen har en lesing i det: slettes", async () => {
    // Kurset har bare en seksjon som aldri ble publisert: kravet er tomt (utstedelsen: «never completable»).
    const draft = await apiSection("tomt krav", false);
    const course = await apiCourse("tomt krav", [{ type: "SECTION", sectionId: draft }]);
    await archiveCourse(course);
    await read(await user("leser"), course, draft);
    const deleted = await del(K(course));
    expect(deleted.status, show(deleted)).toBe(204);
  });

  // Codex, byggenotatet for 4c (18.11.2026), og QA-porten 2.169.0: et krav som har blitt TOMT kan ikke gjenskapes. Kurs A har bare
  // den delte modulen M; A arkiveres, M blir stående (brukes av B). Så arkiveres B, og M følger B (merket peker på B). For A er M nå
  // «arkivert for seg», og kravet ble tomt. Før 2.169.0 betydde det «ingen kan ha fullført», og A kunne slettes selv om deltakeren
  // hadde bestått alt A krevde. Produkteier valgte A (21.11.2026): tvil gir «beholdes» når noen har bestått eller lest noe av det
  // som falt ut.
  it("et krav som har blitt tomt (den eneste modulen fulgte et ANNET kurs inn i arkivet): den som har bestått den, holder kurset igjen (course_requirement_unclear); KONTROLL: ingen bestått → slettes", async () => {
    const shared = await apiModule("tomt krav delt");
    const a = await apiCourse("tomt krav A", [{ type: "MODULE", moduleId: shared }]);
    const b = await apiCourse("tomt krav B", [{ type: "MODULE", moduleId: shared }]);
    await archiveCourse(a);
    expect(await prisma.module.findUniqueOrThrow({ where: { id: shared }, select: { archivedAt: true } })).toEqual({ archivedAt: null });
    await archiveCourse(b);
    expect(await prisma.module.findUniqueOrThrow({ where: { id: shared }, select: { archivedWithCourseId: true } })).toEqual({ archivedWithCourseId: b });

    await pass(await user("tomt krav bestått"), shared);
    expectRefused(await del(K(a)), "course_requirement_unclear", 1);
    expect(await exists.course(a)).toBe(1);

    // KONTROLL: samme oppsett uten noen som har gjort noe. Ingen fremgang på det som falt ut: slettes.
    const shared2 = await apiModule("tomt krav delt 2");
    const a2 = await apiCourse("tomt krav A2", [{ type: "MODULE", moduleId: shared2 }]);
    const b2 = await apiCourse("tomt krav B2", [{ type: "MODULE", moduleId: shared2 }]);
    await archiveCourse(a2);
    await archiveCourse(b2);
    const deleted = await del(K(a2));
    expect(deleted.status, show(deleted)).toBe(204);
  });

  it("QA-porten 2.169.0 runde 2: en delt seksjon lest via et ANNET kurs etter at kurset ble arkivert, og så falt ut: kurset holdes igjen", async () => {
    const shared = await apiSection("lest senere delt");
    const a = await apiCourse("lest senere A", [{ type: "SECTION", sectionId: shared }]);
    const b = await apiCourse("lest senere B", [{ type: "SECTION", sectionId: shared }]);
    await archiveCourse(a);
    // Lest gjennom B, etter at A ble arkivert. Utstedelsens regel ville ikke telt denne lesingen for A.
    await read(await user("lest senere"), b, shared);
    await archiveCourse(b);
    expect(await prisma.courseSection.findUniqueOrThrow({ where: { id: shared }, select: { archivedWithCourseId: true } })).toEqual({ archivedWithCourseId: b });
    expectRefused(await del(K(a)), "course_requirement_unclear", 1);
    expect(await exists.course(a)).toBe(1);
  });

  it("KONTROLL: en bestått som er gjort ugyldig (`invalidatedAt`), holder ikke et kurs med uklart krav igjen", async () => {
    const shared = await apiModule("ugyldig bestått delt");
    const a = await apiCourse("ugyldig bestått A", [{ type: "MODULE", moduleId: shared }]);
    const b = await apiCourse("ugyldig bestått B", [{ type: "MODULE", moduleId: shared }]);
    await archiveCourse(a);
    await archiveCourse(b);
    const learner = await user("ugyldig bestått");
    await pass(learner, shared);
    await prisma.modulePass.updateMany({ where: { userId: learner, moduleId: shared }, data: { invalidatedAt: new Date() } });
    const deleted = await del(K(a));
    expect(deleted.status, show(deleted)).toBe(204);
  });

  it("to moduler falt ut senere, og deltakeren har bestått bare den ene: kurset holdes igjen (minst én er nok når kravet er uklart)", async () => {
    const m1 = await apiModule("to ut 1");
    const m2 = await apiModule("to ut 2");
    const a = await apiCourse("to ut A", [{ type: "MODULE", moduleId: m1 }, { type: "MODULE", moduleId: m2 }]);
    const b = await apiCourse("to ut B", [{ type: "MODULE", moduleId: m1 }, { type: "MODULE", moduleId: m2 }]);
    await archiveCourse(a);
    await archiveCourse(b);
    await pass(await user("to ut bare én"), m1);
    expectRefused(await del(K(a)), "course_requirement_unclear", 1);
  });

  it("QA-porten 2.169.0: modulen og en seksjon som aldri ble publisert, falt begge ut senere; den som har bestått modulen, holder kurset igjen (seksjonen gjør ikke kravet umulig)", async () => {
    const shared = await apiModule("ut senere delt");
    const draft = await apiSection("ut senere aldri publisert", false);
    const a = await apiCourse("ut senere A", [{ type: "MODULE", moduleId: shared }, { type: "SECTION", sectionId: draft }]);
    const b = await apiCourse("ut senere B", [{ type: "MODULE", moduleId: shared }]);
    const c = await apiCourse("ut senere C", [{ type: "SECTION", sectionId: draft }]);
    await archiveCourse(a);
    expect(await prisma.courseSection.findUniqueOrThrow({ where: { id: draft }, select: { archivedAt: true } })).toEqual({ archivedAt: null });
    await archiveCourse(b);
    await archiveCourse(c);
    expect(await prisma.courseSection.findUniqueOrThrow({ where: { id: draft }, select: { archivedWithCourseId: true } })).toEqual({ archivedWithCourseId: c });

    await pass(await user("ut senere bestått"), shared);
    expectRefused(await del(K(a)), "course_requirement_unclear", 1);
    // Kaskadens forhåndsvisning sier det samme.
    const preview = await ok(get(K(a, "/cascade-delete-preview")), "forhåndsvisning");
    expect((preview.blockers as Array<{ id: string; code?: string }>).filter((x) => x.id === a).map((x) => x.code)).toEqual(["course_requirement_unclear"]);
  });

  it("den som har kursbevis, er ikke «uten kursbevis»: kaskaden viser bare kursbevisene", async () => {
    const x = await archivedCourseWithModuleAndSection("med bevis");
    const learner = await user("med bevis");
    await pass(learner, x.module);
    await read(learner, x.course, x.section);
    const course = await prisma.course.findUniqueOrThrow({ where: { id: x.course }, select: { versionMajor: true } });
    await prisma.courseCompletion.create({ data: { userId: learner, courseId: x.course, versionMajor: course.versionMajor, moduleSnapshotJson: "[]" } });

    expectRefused(await del(K(x.course)), "course_has_completions", 1);
    const preview = await ok(get(K(x.course, "/cascade-delete-preview")), "forhåndsvisning");
    expect((preview.blockers as Array<{ id: string; code?: string }>).filter((b) => b.id === x.course).map((b) => b.code)).toEqual(["course_has_completions"]);
  });
});

/**
 * QA-porten 4a: modulen er delt med et aktivt kurs da kurset arkiveres, og følger ikke med. Så tar det andre kurset den ut, og den
 * arkiveres for hånd (uten merket). Den er ikke i kravet lenger, men en sak på den kan bli bestått. Deltakeren har en sak til
 * manuell behandling på den.
 */
async function courseWithSharedModuleArchivedLater(name: string) {
  // QA-porten 4a: modulen M er delt med et aktivt kurs da kurset arkiveres, og følger ikke med. Så tar det andre kurset den ut, og
  // den arkiveres for hånd (uten merket). Den er ikke i kravet lenger, men saken på den kan bli bestått.
  const shared = await apiModule(`${name} delt`);
  const section = await apiSection(`${name} seksjon`);
  const course = await apiCourse(name, [{ type: "MODULE", moduleId: shared }, { type: "SECTION", sectionId: section }]);
  const other = await apiCourse("bruker den delte", [{ type: "MODULE", moduleId: shared }, { type: "SECTION", sectionId: await apiSection("annet") }]);
  const learner = await user("delt sak");
  const pending = await submission(learner, shared, "UNDER_REVIEW");
  await archiveCourse(course);
  expect(await prisma.module.findUniqueOrThrow({ where: { id: shared }, select: { archivedAt: true } })).toEqual({ archivedAt: null });

  // Det andre kurset tar modulen ut, og modulen arkiveres for seg.
  const others = (await prisma.courseItem.findMany({ where: { courseId: other, itemType: "SECTION" }, select: { sectionId: true } }))
    .map((row) => ({ type: "SECTION" as const, sectionId: row.sectionId as string }));
  const put = await request(app).put(K(other, "/items")).set(ADMIN).send(await withRevision(other, { items: others }));
  expect(put.status, show(put)).toBe(204);
  await ok(post(M(shared, "/archive")), "arkiver modulen for seg");
  expect(await prisma.module.findUniqueOrThrow({ where: { id: shared }, select: { archivedWithCourseId: true } })).toEqual({ archivedWithCourseId: null });
  return { course, shared, learner, pending };
}

// ── 2. Venter på vurdering ──────────────────────────────────────────────────────────────────────────────────────────────────

describe("#1152: en besvarelse som venter, holder kurset igjen til den er avgjort", () => {
  const cases = [
    ["venter på vurdering (SUBMITTED)", "SUBMITTED", false],
    ["til manuell behandling (UNDER_REVIEW)", "UNDER_REVIEW", false],
    ["ferdig vurdert, med en åpen anke", "COMPLETED", true],
  ] as const;
  for (const [label, status, appeal] of cases) {
    it(`${label} → course_has_pending_reviews; avgjort → slettes`, async () => {
      const x = await archivedCourseWithModuleAndSection(`venter ${status}`);
      const learner = await user("venter");
      const pending = await submission(learner, x.module, status);
      const openAppeal = appeal
        ? await prisma.appeal.create({ data: { submissionId: pending.id, appealedById: learner, appealReason: "Fikstur for #1152.", appealStatus: "OPEN" }, select: { id: true } })
        : null;

      expectRefused(await del(K(x.course)), "course_has_pending_reviews", 1);
      expect(await exists.course(x.course)).toBe(1);

      // Avgjort uten bestått: ingenting venter, og ingen har fullført.
      await prisma.submission.update({ where: { id: pending.id }, data: { submissionStatus: "COMPLETED" } });
      if (openAppeal) await prisma.appeal.update({ where: { id: openAppeal.id }, data: { appealStatus: "RESOLVED", resolvedAt: new Date() } });
      const deleted = await del(K(x.course));
      expect(deleted.status, show(deleted)).toBe(204);
    });
  }

  it("KONTROLL (stage-testen 2.164.0): en modul som bare er åpnet, aldri levert (SUBMITTED uten vurderingsjobb), holder ikke kurset igjen", async () => {
    // #1185: «bare åpnet» finnes bare i en ren flervalgsmodul; der lages innleveringen når modulen åpnes. I en modul med fritekst
    // betyr SUBMITTED uten jobb at teksten ER levert, og da holder den kurset igjen i sju dager (m2-course-delete-unfinished-1185).
    // Fiksturen var stum om modultypen og fikk fritekst som standard.
    const x = await archivedCourseWithModuleAndSection("bare åpnet");
    await prisma.moduleVersion.updateMany({ where: { moduleId: x.module }, data: { assessmentMode: "MCQ_ONLY" } });
    await submission(await user("åpnet"), x.module, "SUBMITTED", true);
    const deleted = await del(K(x.course));
    expect(deleted.status, show(deleted)).toBe(204);
  });

  it("en sak på en DELT modul som senere ble arkivert for seg (etter kurset), holder kurset igjen: alle kursets moduler teller", async () => {
    const { course } = await courseWithSharedModuleArchivedLater("delt sak");
    expectRefused(await del(K(course)), "course_has_pending_reviews", 1);
    expect(await exists.course(course)).toBe(1);
  });

  it("LÅSENE gjelder også den modulen: et vedtak på saken som pågår, gjør at slettingen venter, og den ser at saken er avgjort", async () => {
    const { course, learner, pending } = await courseWithSharedModuleArchivedLater("delt sak lås");
    const lock = holdLearner(learner);
    await lock.held;
    const deleting = request(app).delete(K(course)).set(ADMIN).then((r) => r);
    expect(await stillWaiting(deleting), "slettingen venter på deltakerlåsen").toBe(true);
    // Vedtaket: ikke bestått. Da venter ingenting, og ingen har fullført.
    lock.release((tx) => tx.submission.update({ where: { id: pending.id }, data: { submissionStatus: "COMPLETED" } }));
    await lock.done;
    const deleted = await deleting;
    expect(deleted.status, show(deleted)).toBe(204);
  });

  it("rekkefølgen: fullført uten kursbevis sies før det som venter (det går ikke bort av seg selv)", async () => {
    const x = await archivedCourseWithModuleAndSection("begge");
    const done = await user("ferdig");
    await pass(done, x.module);
    await read(done, x.course, x.section);
    await submission(await user("venter"), x.module, "UNDER_REVIEW");
    expectRefused(await del(K(x.course)), "course_has_completed_without_certificate", 1);
  });
});

// ── 3. Låsene ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Holder deltakerlåsen (et vedtak som pågår) til testen slipper den; `release(fn)` kjører vedtaket før commit. */
function holdLearner(userId: string) {
  let markHeld!: () => void;
  const held = new Promise<void>((resolve) => { markHeld = resolve; });
  let release!: (fn?: (tx: LearnerTx) => Promise<unknown>) => void;
  const released = new Promise<((tx: LearnerTx) => Promise<unknown>) | undefined>((resolve) => { release = resolve; });
  const done = runLearnerWrite(userId, async (tx) => {
    markHeld();
    const fn = await released;
    if (fn) await fn(tx);
  }, { timeout: 15_000 });
  return { held, release, done };
}

async function stillWaiting(promise: Promise<unknown>, ms = 500) {
  let settled = false;
  const tracked = promise.then(() => { settled = true; }, () => { settled = true; });
  await Promise.race([tracked, pause(ms)]);
  return !settled;
}

describe("#1152: slettingen tar deltakerlåsene før den måler", () => {
  it("et vedtak som pågår når «Slett» kommer: slettingen venter, og ser at deltakeren nå har fullført", async () => {
    const x = await archivedCourseWithModuleAndSection("lås");
    const learner = await user("lås");
    await read(learner, x.course, x.section);
    const pending = await submission(learner, x.module, "UNDER_REVIEW");
    const version = await publishedVersion(x.module);

    const lock = holdLearner(learner);
    await lock.held;
    // Startes utenfor låsens callback (ellers ville den sett seg selv som nestet).
    const deleting = request(app).delete(K(x.course)).set(ADMIN).then((r) => r);
    expect(await stillWaiting(deleting), "slettingen venter på deltakerlåsen").toBe(true);

    // Vedtaket: bestått etter manuell behandling. Skrevet i transaksjonen som holder låsen, som vedtakssporet gjør.
    lock.release(async (tx) => {
      await tx.submission.update({ where: { id: pending.id }, data: { submissionStatus: "COMPLETED" } });
      const decision = await tx.assessmentDecision.create({
        data: {
          submissionId: pending.id, moduleVersionId: version.id, mcqScaledScore: 1, practicalScaledScore: 1, totalScore: 1, redFlagsJson: "[]",
          passFailTotal: true, decisionType: "MANUAL_OVERRIDE", decisionReason: "Fikstur for #1152.",
        },
        select: { id: true },
      });
      await tx.modulePass.create({ data: { userId: learner, moduleId: x.module, submissionId: pending.id, decisionId: decision.id, moduleVersionId: version.id, passedAt: new Date() } });
    });
    await lock.done;

    // Uten låsen hadde slettingen svart med en gang, med saken som ventet. Nå ser den vedtaket.
    expectRefused(await deleting, "course_has_completed_without_certificate", 1);
    expect(await exists.course(x.course)).toBe(1);
  });
});

// ── 4. Kaskaden ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function cascade(courseId: string) {
  const preview = await ok(get(K(courseId, "/cascade-delete-preview")), "forhåndsvisning");
  const run = await post(K(courseId, "/cascade-delete"), {
    expectedDeletedModuleIds: (preview.deletableModules as Array<{ id: string }>).map((m) => m.id),
    expectedDeletedSectionIds: (preview.deletableSections as Array<{ id: string }>).map((s) => s.id),
  });
  return { preview, run };
}

type Entry = { id: string; code?: string; details?: Record<string, unknown>; stays?: string };

describe("#1152: kaskaden bruker de samme vaktene som «Slett»", () => {
  it("fullført uten kursbevis og en sak som venter: begge i forhåndsvisningen, med kode og tall; slettingen nekter, og ingenting er slettet", async () => {
    const x = await archivedCourseWithModuleAndSection("kaskade vakt");
    const done = await user("ferdig");
    await pass(done, x.module);
    await read(done, x.course, x.section);
    await submission(await user("venter"), x.module, "SUBMITTED");

    const { preview, run } = await cascade(x.course);
    const blockers = preview.blockers as Entry[];
    expect(blockers.filter((b) => b.id === x.course).map((b) => [b.code, b.details])).toEqual([
      ["course_has_completed_without_certificate", { count: 1 }],
      ["course_has_pending_reviews", { count: 1 }],
    ]);
    expect(preview.deletable).toBe(false);
    expectRefused(run, "course_cascade_blocked");
    expect(await exists.course(x.course)).toBe(1);
    expect(await exists.section(x.section)).toBe(1);
  });

  it("et aktivt eksklusivt element blir stående, og forhåndsvisningen sier det; det arkiverte slettes, med én hendelse per seksjon", async () => {
    const archivedSection = await apiSection("kaskade arkivert");
    const activeSection = await apiSection("kaskade aktiv");
    const module = await apiModule("kaskade modul");
    const activeModule = await apiModule("kaskade aktiv modul");
    const course = await apiCourse("kaskade aktiv", [
      { type: "SECTION", sectionId: archivedSection }, { type: "SECTION", sectionId: activeSection }, { type: "MODULE", moduleId: module },
      { type: "MODULE", moduleId: activeModule },
    ]);
    await archiveCourse(course);
    // En seksjon og en modul tas ut av arkivet for seg: aktive igjen, fortsatt bare i dette kurset (som et kurs arkivert før 2.159.0).
    await ok(post(S(activeSection, "/restore")), "gjenopprett seksjonen");
    await ok(post(M(activeModule, "/restore")), "gjenopprett modulen");

    const { preview, run } = await cascade(course);
    expect((preview.deletableSections as Entry[]).map((s) => s.id)).toEqual([archivedSection]);
    expect((preview.deletableModules as Entry[]).map((m) => m.id)).toEqual([module]);
    expect((preview.sparedSections as Entry[]).map((s) => [s.id, s.stays])).toEqual([[activeSection, "not_archived"]]);
    expect((preview.sparedModules as Entry[]).map((m) => [m.id, m.stays])).toEqual([[activeModule, "not_archived"]]);
    expect(run.status, show(run)).toBe(200);
    expect(run.body).toMatchObject({ deletedSectionIds: [archivedSection], deletedModuleIds: [module], sparedSectionIds: [activeSection], sparedModuleIds: [activeModule] });

    expect(await exists.course(course)).toBe(0);
    expect(await exists.section(archivedSection)).toBe(0);
    expect(await exists.module(module)).toBe(0);
    // Den aktive står, i ingen kurs.
    expect(await exists.section(activeSection)).toBe(1);
    expect(await prisma.courseItem.count({ where: { sectionId: activeSection } })).toBe(0);
    expect(await exists.module(activeModule)).toBe(1);

    // Én hendelse per slettet seksjon og modul, med kilden; én for kurset (kaskadens egen), ingen vanlig «kurs slettet».
    const events = async (entityId: string, action: string) =>
      (await prisma.auditEvent.findMany({ where: { entityId, action }, select: { metadataJson: true } })).map((e) => JSON.parse(e.metadataJson));
    expect(await events(archivedSection, "section_deleted")).toEqual([expect.objectContaining({ sectionId: archivedSection, source: "course_cascade_delete" })]);
    expect(await events(module, "module_deleted")).toEqual([expect.objectContaining({ moduleId: module, source: "course_cascade_delete" })]);
    expect(await events(activeSection, "section_deleted")).toEqual([]);
    expect(await events(course, "course_cascade_deleted")).toHaveLength(1);
    expect(await events(course, "course_deleted")).toEqual([]);
  });

  it("et lagret utkast til et annet kurs som nevner et eksklusivt arkivert element, stopper kaskaden; forkastet utkast → slettes", async () => {
    const x = await archivedCourseWithModuleAndSection("kaskade utkast");
    const other = await apiCourse("med utkast", [{ type: "SECTION", sectionId: await apiSection("i utkastkurset") }]);
    // Direkte: ingen rute lagrer et utkast med et arkivert element (#1150).
    await prisma.courseDraft.create({ data: { courseId: other, payloadText: JSON.stringify({ items: [{ type: "MODULE", moduleId: x.module }] }), baseRevision: 0, source: "form" } });

    const { preview, run } = await cascade(x.course);
    expect((preview.blockers as Entry[]).map((b) => [b.id, b.code])).toEqual([[x.module, "delete_blocked_by_course_draft"]]);
    expectRefused(run, "course_cascade_blocked");
    expect(await exists.module(x.module)).toBe(1);
    expect(await exists.course(x.course)).toBe(1);

    await prisma.courseDraft.deleteMany({ where: { courseId: other } });
    const again = await cascade(x.course);
    expect(again.run.status, show(again.run)).toBe(200);
    expect(await exists.module(x.module)).toBe(0);
  });
});

// ── 5. De indre funksjonene ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("#1152: de indre slettefunksjonene hopper over en rad som er borte; rutene svarer 404", () => {
  it("kurs, modul og seksjon som ikke finnes: `not_found`, ingen feil, i samme transaksjon", async () => {
    const missing = `finnes-ikke-${RUN}`;
    const results = await runContentWrite(async (tx) => [
      await deleteCourseInTx(tx, missing),
      await deleteModuleInTx(tx, missing),
      await deleteSectionInTx(tx, missing),
    ]);
    expect(results).toEqual([{ deleted: false, reason: "not_found" }, { deleted: false, reason: "not_found" }, { deleted: false, reason: "not_found" }]);
  });

  it("det samme kurset slettet to ganger: første gang 204, andre gang 404 course_not_found", async () => {
    const course = await apiCourse("to ganger", []);
    await archiveCourse(course);
    expect((await del(K(course))).status).toBe(204);
    const again = await del(K(course));
    expect(again.status, show(again)).toBe(404);
    expect(again.body.error).toBe("course_not_found");
    // Indre funksjon på raden som nettopp ble slettet: hoppes over.
    expect(await runContentWrite((tx) => deleteCourseInTx(tx, course))).toEqual({ deleted: false, reason: "not_found" });
  });
});

// ── 6. Ingenting med deltakerhistorikk forsvinner ───────────────────────────────────────────────────────────────────────────

describe("#1152: kurssletting rører ikke innleveringer, beståtte, sertifiseringer og kursbevis", () => {
  it("tallene er like før og etter en runde med slettinger og avslag", async () => {
    const kept = await archivedCourseWithModuleAndSection("telling beholdt");
    const learner = await user("telling");
    await pass(learner, kept.module);
    await read(learner, kept.course, kept.section);
    const free = await archivedCourseWithModuleAndSection("telling fri");
    await submission(await user("telling fri"), free.module, "COMPLETED");
    const cascaded = await archivedCourseWithModuleAndSection("telling kaskade");

    const count = async () => ({
      submissions: await prisma.submission.count(),
      passes: await prisma.modulePass.count(),
      certifications: await prisma.certificationStatus.count(),
      completions: await prisma.courseCompletion.count(),
    });
    const before = await count();

    expectRefused(await del(K(kept.course)), "course_has_completed_without_certificate", 1);
    expect((await del(K(free.course))).status).toBe(204);
    expect((await cascade(cascaded.course)).run.status).toBe(200);

    expect(await count()).toEqual(before);
    // Modulen med innleveringen står, arkivert, uten kurs.
    expect(await exists.module(free.module)).toBe(1);
  });
});
