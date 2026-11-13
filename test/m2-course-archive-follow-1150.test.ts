import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { runContentWrite, lockLearnersInContentWrite } from "../src/db/contentLock.js";
import { recordAuditEvent } from "../src/services/auditService.js";
import { auditActions, auditEntityTypes } from "../src/observability/auditEvents.js";
import { createCourseRepository } from "../src/modules/course/courseRepository.js";
import { withRevision } from "./support/courseRevision.js";
import { recordFixturePass } from "./support/modulePassFixture.js";
import { archiveCourseConfirmed } from "./support/courseArchive.js";

// #1150 skive 2a-2 (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, etappe 2): arkivering av et kurs tar med seg modulene og
// seksjonene som ikke brukes andre steder, og gjenoppretting av kurset setter dem tilbake slik de var.
//
// Alt gjennom rutene (supertest). Hver fikstur sier det regelen leser: kursets `archivedAt` og `publishedAt`, elementenes
// `archivedAt`, `activeVersionId` og merkene (`archivedWithCourseId`, `activeVersionIdBeforeArchive`), hvilke kurs og utkast
// elementene står i, lesingens `readAt`, beståttens versjon og bevisets `versionMajor`.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
// En ny administrator per test: admin-API-et slipper bare 120 kall i minuttet per bruker.
const ADMIN: Record<string, string> = { "x-user-id": "", "x-user-email": "", "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `follow-1150-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `follow.1150.admin.${RUN}.${adminSeq}@x.test`;
});
// Fagansvarlige: en ny per test også, av samme grunn.
const smo = (name: string) => ({
  "x-user-id": `follow-1150-${name}-${RUN}-${adminSeq}`,
  "x-user-email": `follow.1150.${name}.${RUN}.${adminSeq}@x.test`,
  "x-user-name": name,
  "x-user-roles": "SUBJECT_MATTER_OWNER",
  "x-locale": "nb",
});

let seq = 0;
const tag = (name: string) => `1150f ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

const coursePath = (courseId: string, action = "") => `/api/admin/content/courses/${courseId}${action}`;
const sectionPath = (sectionId: string, action = "") => `/api/admin/content/sections/${sectionId}${action}`;
const modulePath = (moduleId: string, action = "") => `/api/admin/content/modules/${moduleId}${action}`;
const post = (path: string, body: object = {}, headers: Record<string, string> = ADMIN) => request(app).post(path).set(headers).send(body);
const get = (path: string, headers: Record<string, string> = ADMIN) => request(app).get(path).set(headers);
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 400);

/** En publisert modul med hovedversjon 1.0, uten eier. */
async function createPublishedModule(title: string) {
  const source = await prisma.moduleVersion.findFirst({
    where: { module: { activeVersionId: { not: null } } },
    select: { rubricVersionId: true, promptTemplateVersionId: true, mcqSetVersionId: true },
    orderBy: { createdAt: "asc" },
  });
  expect(source).toBeTruthy();
  const module = await prisma.module.create({ data: { title: JSON.stringify(L(title)), archivedAt: null, archivedWithCourseId: null, activeVersionIdBeforeArchive: null }, select: { id: true } });
  const version = await prisma.moduleVersion.create({
    data: {
      moduleId: module.id, versionNo: 1, versionMajor: 1, versionMinor: 0,
      taskText: JSON.stringify(L(`${title} task`)), assessorExpectedContent: JSON.stringify(L(`${title} guidance`)),
      rubricVersionId: source!.rubricVersionId, promptTemplateVersionId: source!.promptTemplateVersionId, mcqSetVersionId: source!.mcqSetVersionId,
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: version.id } });
  return { id: module.id, versionId: version.id };
}

/** En publisert modul laget gjennom API-et av `headers` (kriterier, ledetekst, flervalg, versjon, publisering). */
async function apiModule(title: string, headers: Record<string, string> = ADMIN) {
  const send = async (path: string, body: object) => {
    const r = await post(path, body, headers);
    expect(r.status, `${path}: ${show(r)}`).toBeLessThan(300);
    return r.body;
  };
  const module = await send("/api/admin/content/modules", { title: L(title), description: L("Beskrivelse"), certificationLevel: "basic" });
  const moduleId = module.module.id as string;
  const rubric = await send(modulePath(moduleId, "/rubric-versions"), { criteria: { relevance: "0-4", quality: "0-4" }, scalingRule: { practical_weight: 70, max_total: 20 } });
  const prompt = await send(modulePath(moduleId, "/prompt-template-versions"), { systemPrompt: L("Sys"), userPromptTemplate: L("Eval"), examples: [{ note: "fixture" }] });
  const mcq = await send(modulePath(moduleId, "/mcq-set-versions"), { title: L("MCQ"), questions: [{ stem: L("Hva er 1+1?"), options: [L("2"), L("3")], correctAnswer: L("2"), rationale: L("Matte") }] });
  const version = await send(modulePath(moduleId, "/module-versions"), {
    taskText: L("Reflekter"), assessorExpectedContent: L("Nevn QA"),
    rubricVersionId: rubric.rubricVersion.id, promptTemplateVersionId: prompt.promptTemplateVersion.id, mcqSetVersionId: mcq.mcqSetVersion.id,
  });
  await send(modulePath(moduleId, `/module-versions/${version.moduleVersion.id}/publish`), {});
  return { id: moduleId, versionId: version.moduleVersion.id as string };
}

/** En publisert seksjon laget gjennom API-et av `headers`: den som lager, blir eier. */
async function apiSection(title: string, headers: Record<string, string> = ADMIN) {
  const created = await post("/api/admin/content/sections", { title: L(title), bodyMarkdown: L("Tekst.") }, headers);
  expect(created.status, show(created)).toBe(201);
  const id = created.body.section.id as string;
  expect((await post(sectionPath(id, "/publish"), {}, headers)).status).toBe(200);
  return id;
}

type Items = { moduleIds?: string[]; sectionIds?: string[] };
function itemList(items: Items) {
  return [
    ...(items.moduleIds ?? []).map((moduleId) => ({ type: "MODULE", moduleId })),
    ...(items.sectionIds ?? []).map((sectionId) => ({ type: "SECTION", sectionId })),
  ];
}

/** Et kurs laget og fylt gjennom API-et av `headers`. `publish`: «Publiser kurs» (alle elementene er publisert). */
async function apiCourse(name: string, items: Items, options: { headers?: Record<string, string>; publish?: boolean } = {}) {
  const headers = options.headers ?? ADMIN;
  const title = tag(name);
  const created = await post("/api/admin/content/courses", { title: L(title) }, headers);
  expect(created.status, show(created)).toBe(201);
  const courseId = created.body.course.id as string;
  const put = await request(app).put(coursePath(courseId, "/items")).set(headers).send(await withRevision(courseId, { items: itemList(items) }));
  expect(put.status, show(put)).toBe(204);
  if (options.publish !== false) {
    const published = await post(coursePath(courseId, "/publish"), {}, headers);
    expect(published.status, show(published)).toBe(200);
  }
  return { id: courseId, title };
}

/**
 * Tar et element ut av et ARKIVERT kurs. Gjennom ruta stoppes det av `course_item_archived` så lenge de andre elementene i lista er
 * arkivert (lagringen sender hele lista); tilstanden kan likevel oppstå (kurset hadde aktive elementer igjen, eller gammel kode),
 * og planen sier hva gjenopprettingen da gjør. Fiksturen skriver koblingen direkte.
 */
async function removeFromArchivedCourse(courseId: string, sectionId: string) {
  await prisma.courseItem.deleteMany({ where: { courseId, sectionId } });
}

/** Bytter elementlista i et kurs, slik kursbyggeren gjør. */
async function setItems(courseId: string, items: Items, headers: Record<string, string> = ADMIN) {
  const put = await request(app).put(coursePath(courseId, "/items")).set(headers).send(await withRevision(courseId, { items: itemList(items) }));
  expect(put.status, show(put)).toBe(204);
}

async function createUser(name: string) {
  const id = `${RUN}-${seq++}`;
  return (await prisma.user.create({ data: { externalId: `follow-1150-${name}-${id}`, email: `follow.1150.${name}.${id}@company.com`, name }, select: { id: true } })).id;
}

async function read(userId: string, courseId: string, sectionId: string) {
  await prisma.courseSectionRead.create({ data: { userId, courseId, sectionId, readAt: new Date() } });
}

/** Bestått modul, slik vedtakssporet skriver det (innlevering, vedtak, ModulePass). */
async function pass(userId: string, module: { id: string; versionId: string }) {
  const submission = await prisma.submission.create({
    data: { userId, moduleId: module.id, moduleVersionId: module.versionId, deliveryType: "text", submissionStatus: "COMPLETED" },
    select: { id: true },
  });
  const decision = await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id, moduleVersionId: module.versionId, mcqScaledScore: 1, practicalScaledScore: 1, totalScore: 1, redFlagsJson: "[]",
      passFailTotal: true, decisionType: "AUTOMATIC", decisionReason: "Fikstur for #1150.",
    },
    select: { id: true },
  });
  await recordFixturePass({ userId, moduleId: module.id, moduleVersionId: module.versionId, submissionId: submission.id, decisionId: decision.id });
}

const moduleRow = (id: string) => prisma.module.findUniqueOrThrow({ where: { id }, select: { archivedAt: true, activeVersionId: true, archivedWithCourseId: true, activeVersionIdBeforeArchive: true } });
const sectionRow = (id: string) => prisma.courseSection.findUniqueOrThrow({ where: { id }, select: { archivedAt: true, activeVersionId: true, archivedWithCourseId: true, activeVersionIdBeforeArchive: true } });
const courseRow = (id: string) => prisma.course.findUniqueOrThrow({ where: { id }, select: { archivedAt: true, publishedAt: true, versionMajor: true, versionMinor: true } });

async function lastAudit(entityType: string, entityId: string, action: string) {
  const row = await prisma.auditEvent.findFirst({ where: { entityType, entityId, action }, orderBy: { chainSeq: "desc" }, select: { metadataJson: true } });
  return row ? (JSON.parse(row.metadataJson) as Record<string, unknown>) : null;
}

const sorted = (ids: string[]) => [...ids].sort();

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. Hva som følger med, og merkene.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("#1150 2a-2: arkivering av kurset tar med det som ikke brukes andre steder", () => {
  it("eksklusivt innhold følger med (også det en annen eier), delt med aktivt kurs og i et annet kurs' utkast står", async () => {
    const forfatter = smo("forfatter");
    const annen = smo("annen");
    const exclusiveModule = await createPublishedModule(tag("eksklusiv modul"));
    const othersSection = await apiSection(tag("eksklusiv seksjon, den andres"), annen);
    const sharedSection = await apiSection(tag("delt med aktivt kurs"));
    const inOtherDraft = await apiSection(tag("i et annet kurs' utkast"));
    const before = { module: await moduleRow(exclusiveModule.id), section: await sectionRow(othersSection) };
    // KONTROLL på fiksturen: begge er publisert og uten merke.
    expect(before.module).toMatchObject({ archivedAt: null, activeVersionId: exclusiveModule.versionId, archivedWithCourseId: null });
    expect(before.section.activeVersionId).not.toBeNull();

    await apiCourse("aktivt kurs som deler", { sectionIds: [sharedSection] });
    // Et annet publisert kurs med et lagret utkast som tar med `inOtherDraft` (kursets egen liste er en annen seksjon).
    const own = await apiSection(tag("egen seksjon i kurset med utkast"));
    const withDraft = await apiCourse("kurs med utkast", { sectionIds: [own] });
    const draftSaved = await request(app).put(coursePath(withDraft.id, "/draft")).set(ADMIN)
      .send({ items: itemList({ sectionIds: [own, inOtherDraft] }), loaded: { expectedRevision: (await prisma.course.findUniqueOrThrow({ where: { id: withDraft.id }, select: { contentRevision: true } })).contentRevision } });
    expect(draftSaved.status, show(draftSaved)).toBe(200);

    const course = await apiCourse("kurset som arkiveres", { moduleIds: [exclusiveModule.id], sectionIds: [othersSection, sharedSection, inOtherDraft] }, { headers: forfatter });

    const preview = await get(coursePath(course.id, "/archive-preview"), forfatter);
    expect(preview.status, show(preview)).toBe(200);
    expect(sorted(preview.body.follows.map((f: { id: string }) => f.id))).toEqual(sorted([exclusiveModule.id, othersSection]));
    expect(preview.body.follows.find((f: { id: string }) => f.id === othersSection).owned).toBe(false);

    // Rekkefølgen i `expected` spiller ingen rolle: id-ene sendes baklengs.
    const archived = await post(coursePath(course.id, "/archive"), {
      expected: { follows: { moduleIds: [exclusiveModule.id], sectionIds: [othersSection] }, inProgressCount: 0 },
    }, forfatter);
    expect(archived.status, show(archived)).toBe(200);
    expect(archived.body.followed).toEqual({ moduleIds: [exclusiveModule.id], sectionIds: [othersSection] });
    expect(archived.body.course.archivedAt).toBeTruthy();
    expect(archived.body.course.publishedAt).toBeNull();

    // Fulgte med: arkivert, uten aktiv versjon (I3), med merket og versjonen fra før.
    expect(await moduleRow(exclusiveModule.id)).toMatchObject({ activeVersionId: null, archivedWithCourseId: course.id, activeVersionIdBeforeArchive: exclusiveModule.versionId });
    expect((await moduleRow(exclusiveModule.id)).archivedAt).not.toBeNull();
    expect(await sectionRow(othersSection)).toMatchObject({ activeVersionId: null, archivedWithCourseId: course.id, activeVersionIdBeforeArchive: before.section.activeVersionId });
    // Står: urørt.
    for (const id of [sharedSection, inOtherDraft]) {
      expect(await sectionRow(id), id).toMatchObject({ archivedAt: null, archivedWithCourseId: null, activeVersionIdBeforeArchive: null });
      expect((await sectionRow(id)).activeVersionId, id).not.toBeNull();
    }

    // Revisjonssporet: kurset med hva som fulgte, og hvert element med kurset.
    expect(await lastAudit(auditEntityTypes.course, course.id, auditActions.course.archived)).toMatchObject({
      followedModuleIds: [exclusiveModule.id], followedSectionIds: [othersSection], inProgressCount: 0, certificatesIssued: 0, confirmed: true,
    });
    expect(await lastAudit(auditEntityTypes.module, exclusiveModule.id, auditActions.adminContent.moduleArchived)).toMatchObject({ archivedWithCourseId: course.id, activeVersionIdBeforeArchive: exclusiveModule.versionId });
    expect(await lastAudit(auditEntityTypes.courseSection, othersSection, auditActions.section.archived)).toMatchObject({ archivedWithCourseId: course.id });
  });

  it("kursets eget utkast forkastes, med revisjonshendelse", async () => {
    const section = await apiSection(tag("seksjon i kurs med eget utkast"));
    const course = await apiCourse("kurs med eget utkast", { sectionIds: [section] });
    const saved = await request(app).put(coursePath(course.id, "/draft")).set(ADMIN)
      .send({ items: itemList({ sectionIds: [section] }), loaded: { expectedRevision: (await prisma.course.findUniqueOrThrow({ where: { id: course.id }, select: { contentRevision: true } })).contentRevision } });
    expect(saved.status, show(saved)).toBe(200);
    const draftId = saved.body.draft.id as string;
    expect(draftId).toBeTruthy();

    const { response, preview } = await archiveCourseConfirmed(course.id, ADMIN);
    expect(preview.hasDraft).toBe(true);
    expect(response.status, show(response)).toBe(200);
    expect(response.body.draftDiscarded).toBe(true);
    expect((await get(coursePath(course.id, "/draft"))).status).toBe(404);
    const audit = await lastAudit(auditEntityTypes.course, course.id, auditActions.course.draftDiscarded);
    expect(audit).toMatchObject({ courseId: course.id, reason: "course_archived" });
    expect(audit?.draftId).toBe(draftId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. Bekreftelsen: uten `expected`, med feil `expected`, og når analysen endres mellom forhåndsvisning og arkivering.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("#1150 2a-2: uten bekreftelse arkiveres bare et kurs der ingenting følger med og ingen er midt i", () => {
  it("noe ville fulgt med: 409 course_archive_needs_confirmation, og ingenting er arkivert", async () => {
    const section = await apiSection(tag("eksklusiv, gammel fane"));
    const course = await apiCourse("kurs fra gammel fane", { sectionIds: [section] });
    const response = await post(coursePath(course.id, "/archive"));
    expect(response.status, show(response)).toBe(409);
    expect(response.body.error).toBe("course_archive_needs_confirmation");
    expect(response.body.details).toEqual({ moduleCount: 0, sectionCount: 1 });
    expect((await courseRow(course.id)).archivedAt).toBeNull();
    expect((await sectionRow(section)).archivedAt).toBeNull();
  });

  it("noen er midt i: 400 course_has_active_participants (som før), og ingenting er arkivert", async () => {
    const shared = await apiSection(tag("delt, så ingenting følger med"));
    const shared2 = await apiSection(tag("delt nummer to"));
    await apiCourse("annet aktivt kurs", { sectionIds: [shared, shared2] });
    const course = await apiCourse("kurs med deltaker midt i", { sectionIds: [shared, shared2] });
    const learner = await createUser("midt-i");
    await read(learner, course.id, shared);
    const response = await post(coursePath(course.id, "/archive"));
    expect(response.status, show(response)).toBe(400);
    expect(response.body.error).toBe("course_has_active_participants");
    expect(response.body.details).toEqual({ count: 1 });
    expect((await courseRow(course.id)).archivedAt).toBeNull();
  });

  it("KONTROLL: ingenting følger med og ingen er midt i: arkiveres uten `expected`", async () => {
    const shared = await apiSection(tag("bare delt"));
    await apiCourse("kurs som beholder seksjonen", { sectionIds: [shared] });
    const course = await apiCourse("kurs uten noe som følger", { sectionIds: [shared] });
    const response = await post(coursePath(course.id, "/archive"));
    expect(response.status, show(response)).toBe(200);
    expect(response.body.followed).toEqual({ moduleIds: [], sectionIds: [] });
    expect((await sectionRow(shared)).archivedAt).toBeNull();
    // Et arkivert kurs kan ikke arkiveres igjen.
    const again = await post(coursePath(course.id, "/archive"));
    expect(again.status, show(again)).toBe(400);
    expect(again.body.error).toBe("course_already_archived");
  });
});

describe("#1150 2a-2: `expected` må stemme med analysen under låsen", () => {
  it("andre id-er eller en id for mye: 409 course_archive_preview_changed, og ingenting er arkivert", async () => {
    const s1 = await apiSection(tag("følger 1"));
    const s2 = await apiSection(tag("følger 2"));
    const course = await apiCourse("kurs med to som følger", { sectionIds: [s1, s2] });
    for (const expected of [
      { follows: { moduleIds: [], sectionIds: [s1] }, inProgressCount: 0 },
      { follows: { moduleIds: [], sectionIds: [s1, s2, "finnes-ikke"] }, inProgressCount: 0 },
      { follows: { moduleIds: [s1], sectionIds: [s2] }, inProgressCount: 0 },
      { follows: { moduleIds: ["en-modul-som-ikke-følger"], sectionIds: [s1, s2] }, inProgressCount: 0 },
    ]) {
      const response = await post(coursePath(course.id, "/archive"), { expected });
      expect(response.status, `${JSON.stringify(expected)} ${show(response)}`).toBe(409);
      expect(response.body.error).toBe("course_archive_preview_changed");
      expect(response.body.details).toEqual({ inProgressCount: 0, follows: { moduleIds: [], sectionIds: [s1, s2] } });
    }
    expect((await courseRow(course.id)).archivedAt).toBeNull();
    expect((await sectionRow(s1)).archivedAt).toBeNull();
    // KONTROLL: det riktige svaret, i en annen rekkefølge, går gjennom.
    const ok = await post(coursePath(course.id, "/archive"), { expected: { follows: { moduleIds: [], sectionIds: [s2, s1] }, inProgressCount: 0 } });
    expect(ok.status, show(ok)).toBe(200);
  });

  // QA-porten 2a-2: forfatteren bekreftet N deltakere midt i. Færre nå er innenfor bekreftelsen; flere er det ikke.
  it("flere midt i enn bekreftet: 409. Færre enn bekreftet: arkiveres", async () => {
    const s1 = await apiSection(tag("tallet 1"));
    const s2 = await apiSection(tag("tallet 2"));
    const course = await apiCourse("kurs der tallet endrer seg", { sectionIds: [s1, s2] });
    const learner = await createUser("begynner etter forhåndsvisningen");
    await read(learner, course.id, s1);

    const flere = await post(coursePath(course.id, "/archive"), { expected: { follows: { moduleIds: [], sectionIds: [s1, s2] }, inProgressCount: 0 } });
    expect(flere.status, show(flere)).toBe(409);
    expect(flere.body.error).toBe("course_archive_preview_changed");
    expect(flere.body.details.inProgressCount).toBe(1);
    expect((await courseRow(course.id)).archivedAt).toBeNull();

    const faerre = await post(coursePath(course.id, "/archive"), { expected: { follows: { moduleIds: [], sectionIds: [s1, s2] }, inProgressCount: 2 } });
    expect(faerre.status, show(faerre)).toBe(200);
    expect((await courseRow(course.id)).archivedAt).not.toBeNull();
  });

  it("SAMTIDIGHET: et element legges inn i et annet kurs mellom forhåndsvisning og arkivering → 409, og elementet står", async () => {
    const section = await apiSection(tag("legges i et annet kurs i mellomtiden"));
    const course = await apiCourse("kurs som skulle arkiveres", { sectionIds: [section] });
    const preview = await get(coursePath(course.id, "/archive-preview"));
    expect(preview.body.follows.map((f: { id: string }) => f.id)).toEqual([section]);

    // En annen forfatter legger seksjonen inn i sitt kurs før arkiveringen kommer fram.
    await apiCourse("kurs som tar seksjonen", { sectionIds: [section] }, { publish: false });

    const response = await post(coursePath(course.id, "/archive"), { expected: { follows: { moduleIds: [], sectionIds: [section] }, inProgressCount: 0 } });
    expect(response.status, show(response)).toBe(409);
    expect(response.body.error).toBe("course_archive_preview_changed");
    expect(response.body.details.follows).toEqual({ moduleIds: [], sectionIds: [] });
    expect((await sectionRow(section)).archivedAt).toBeNull();
    expect((await courseRow(course.id)).archivedAt).toBeNull();
  });

  it("ugyldig `expected` (feil form): 400 validation_error med `issues`", async () => {
    const course = await apiCourse("kurs med feil form", { sectionIds: [await apiSection(tag("s"))] });
    const response = await post(coursePath(course.id, "/archive"), { expected: { follows: { moduleIds: "x" }, inProgressCount: -1 } });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("validation_error");
    expect(Array.isArray(response.body.issues)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. Deltakerne: midt i (prøvesteinen) og fullført uten kursbevis.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("#1150 2a-2: deltakerne", () => {
  it("PRØVESTEIN: et kurs med én deltaker halvveis arkiveres med bekreftelse, og lesehistorikken finnes etterpå", async () => {
    const s1 = await apiSection(tag("halvveis 1"));
    const s2 = await apiSection(tag("halvveis 2"));
    const course = await apiCourse("kurs med én halvveis", { sectionIds: [s1, s2] });
    const learner = await createUser("halvveis");
    await read(learner, course.id, s1);

    const { response, preview } = await archiveCourseConfirmed(course.id, ADMIN);
    expect(preview.inProgressCount).toBe(1);
    expect(response.status, show(response)).toBe(200);
    expect(await prisma.courseSectionRead.count({ where: { userId: learner, courseId: course.id, sectionId: s1 } })).toBe(1);
    expect(await prisma.courseCompletion.count({ where: { userId: learner, courseId: course.id } })).toBe(0);
    expect(await lastAudit(auditEntityTypes.course, course.id, auditActions.course.archived)).toMatchObject({ inProgressCount: 1, confirmed: true });
  });

  it("fullført uten kursbevis: beviset utstedes før kurset arkiveres. KONTROLL: et upublisert kurs utsteder ikke (#933)", async () => {
    const module = await createPublishedModule(tag("modul for fullført"));
    const section = await apiSection(tag("seksjon for fullført"));
    const course = await apiCourse("kurs med en som har fullført", { moduleIds: [module.id], sectionIds: [section] });
    const done = await createUser("fullfort");
    await pass(done, module);
    await read(done, course.id, section);
    // Den halvveis teller ikke som fullført.
    const halfway = await createUser("halvveis-2");
    await read(halfway, course.id, section);
    const versionMajor = (await courseRow(course.id)).versionMajor;

    const { response, preview } = await archiveCourseConfirmed(course.id, ADMIN);
    expect(preview).toMatchObject({ published: true, inProgressCount: 1, completedWithoutCertificateCount: 1 });
    expect(response.status, show(response)).toBe(200);
    expect(response.body.certificatesIssued).toBe(1);
    const certificate = await prisma.courseCompletion.findFirst({ where: { userId: done, courseId: course.id }, select: { versionMajor: true, moduleSnapshotJson: true, sectionSnapshotJson: true } });
    expect(certificate).toMatchObject({ versionMajor });
    expect(JSON.parse(certificate!.moduleSnapshotJson)).toEqual([module.id]);
    expect(JSON.parse(certificate!.sectionSnapshotJson!)).toEqual([section]);
    expect(await prisma.courseCompletion.count({ where: { userId: halfway, courseId: course.id } })).toBe(0);
    expect(await lastAudit(auditEntityTypes.course, course.id, auditActions.course.completionIssued)).toMatchObject({ userId: done });

    // KONTROLL: samme tilstand i et avpublisert kurs. Forhåndsvisningen viser tallet, men ingenting utstedes.
    const s2 = await apiSection(tag("seksjon i avpublisert kurs"));
    const unpublished = await apiCourse("avpublisert kurs med en som har fullført", { sectionIds: [s2] });
    expect((await post(coursePath(unpublished.id, "/unpublish"))).status).toBe(200);
    const other = await createUser("fullfort-avpublisert");
    await read(other, unpublished.id, s2);
    const second = await archiveCourseConfirmed(unpublished.id, ADMIN);
    expect(second.preview).toMatchObject({ published: false, completedWithoutCertificateCount: 1 });
    expect(second.response.status, show(second.response)).toBe(200);
    expect(second.response.body.certificatesIssued).toBe(0);
    expect(await prisma.courseCompletion.count({ where: { userId: other, courseId: unpublished.id } })).toBe(0);
  });

  it("LÅSENE: deltakerlåsene kan ikke tas etter at transaksjonen har skrevet i revisjonssporet", async () => {
    await expect(
      runContentWrite(async (tx) => {
        await recordAuditEvent({ entityType: auditEntityTypes.course, entityId: `laas-${RUN}`, action: auditActions.course.archived, metadata: { courseId: `laas-${RUN}` } }, tx);
        await lockLearnersInContentWrite(tx, ["en-deltaker"]);
      }),
    ).rejects.toMatchObject({ code: "internal_error" });
    // KONTROLL: i riktig rekkefølge går det.
    await expect(runContentWrite(async (tx) => { await lockLearnersInContentWrite(tx, ["b-deltaker", "a-deltaker"]); })).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. Gjenopprettingen.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("#1150 2a-2: gjenoppretting av kurset setter tilbake det som fulgte med", () => {
  it("nøyaktig det som fulgte inn kommer tilbake med samme versjon; håndarkivert, tatt ut og arkivert med et annet kurs blir stående", async () => {
    const followModule = await createPublishedModule(tag("modul som følger"));
    const followSection = await apiSection(tag("seksjon som følger"));
    const handArchived = await apiSection(tag("arkivert for hånd før"));
    const removedLater = await apiSection(tag("tas ut mens kurset er arkivert"));
    const withOther = await apiSection(tag("følger et annet kurs"));
    const sectionVersion = (await sectionRow(followSection)).activeVersionId;

    // `withOther` ligger i begge kursene. Kurs Y arkiveres først (det fulgte ikke: X er aktivt), så X (nå følger den X).
    const course = await apiCourse("kurset X", { moduleIds: [followModule.id], sectionIds: [followSection, handArchived, removedLater, withOther] });
    const other = await apiCourse("kurset Y", { sectionIds: [withOther, await apiSection(tag("Y sin egen"))] });
    // Y deler `withOther` med X, så Y tar bare sin egen seksjon med seg.
    expect((await archiveCourseConfirmed(other.id, ADMIN)).response.status).toBe(200);
    expect((await sectionRow(withOther)).archivedAt).toBeNull();
    // `handArchived`: tatt ut av X, arkivert for hånd, og lagt tilbake i X (fiksturen skriver koblingen; arkiverte elementer kan
    // ikke legges inn gjennom ruta). Tilstanden «arkivert uten merke, i kurset» er den gamle koden og importen også lager.
    await setItems(course.id, { moduleIds: [followModule.id], sectionIds: [followSection, removedLater, withOther] });
    expect((await post(sectionPath(handArchived, "/archive"))).status).toBe(200);
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: handArchived, sortOrder: 9 } });

    const archived = await archiveCourseConfirmed(course.id, ADMIN);
    expect(archived.response.status, show(archived.response)).toBe(200);
    expect(sorted([...archived.response.body.followed.moduleIds, ...archived.response.body.followed.sectionIds])).toEqual(sorted([followModule.id, followSection, removedLater, withOther]));
    expect(archived.preview.alreadyArchived.map((a: { id: string }) => a.id)).toEqual([handArchived]);

    // Mens X er arkivert: `removedLater` tas ut av X. Y gjenopprettes (`withOther` blir stående: merket peker på X).
    await removeFromArchivedCourse(course.id, removedLater);
    const restoredY = await post(coursePath(other.id, "/restore"));
    expect(restoredY.status, show(restoredY)).toBe(200);
    expect(restoredY.body.staysArchived).toEqual(expect.arrayContaining([expect.objectContaining({ id: withOther, reason: "archived_with_other_course" })]));
    expect((await sectionRow(withOther)).archivedWithCourseId).toBe(course.id);

    // Forhåndsvisningen av X.
    const preview = await get(coursePath(course.id, "/restore-preview"));
    expect(preview.status, show(preview)).toBe(200);
    expect(preview.body.archived).toBe(true);
    const returns = Object.fromEntries((preview.body.returns as Array<{ id: string; asDraft?: string }>).map((r) => [r.id, r]));
    expect(sorted(Object.keys(returns))).toEqual(sorted([followModule.id, followSection, withOther]));
    expect(returns[followModule.id]).toMatchObject({ type: "MODULE", versionId: followModule.versionId, versionLabel: "1.0" });
    expect(returns[followSection]).toMatchObject({ type: "SECTION", versionId: sectionVersion, versionLabel: "1" });
    expect(returns[followModule.id].asDraft).toBeUndefined();
    expect(preview.body.staysArchived).toEqual([expect.objectContaining({ type: "SECTION", id: handArchived, reason: "archived_separately" })]);

    const restored = await post(coursePath(course.id, "/restore"));
    expect(restored.status, show(restored)).toBe(200);
    expect(restored.body.course).toMatchObject({ archivedAt: null, publishedAt: null });
    expect(sorted(restored.body.returns.map((r: { id: string }) => r.id))).toEqual(sorted([followModule.id, followSection, withOther]));
    expect(restored.body.staysArchived.map((s: { id: string }) => s.id)).toEqual([handArchived]);

    // Tilbake, publisert med SAMME versjon, uten merke.
    expect(await moduleRow(followModule.id)).toEqual({ archivedAt: null, activeVersionId: followModule.versionId, archivedWithCourseId: null, activeVersionIdBeforeArchive: null });
    expect(await sectionRow(followSection)).toEqual({ archivedAt: null, activeVersionId: sectionVersion, archivedWithCourseId: null, activeVersionIdBeforeArchive: null });
    expect((await sectionRow(withOther)).archivedAt).toBeNull();
    // Samme nummer: versjonen er ikke nummerert på nytt.
    expect(await prisma.moduleVersion.findUniqueOrThrow({ where: { id: followModule.versionId }, select: { versionMajor: true, versionMinor: true } })).toEqual({ versionMajor: 1, versionMinor: 0 });
    // Håndarkivert: står.
    expect(await sectionRow(handArchived)).toMatchObject({ activeVersionId: null, archivedWithCourseId: null });
    expect((await sectionRow(handArchived)).archivedAt).not.toBeNull();
    // Tatt ut mens kurset var arkivert: står arkivert, og merket er nullstilt.
    const removed = await sectionRow(removedLater);
    expect(removed.archivedAt).not.toBeNull();
    expect(removed).toMatchObject({ activeVersionId: null, archivedWithCourseId: null, activeVersionIdBeforeArchive: null });

    expect(await lastAudit(auditEntityTypes.course, course.id, auditActions.course.restored)).toMatchObject({ marksCleared: 1, returnedModuleIds: [followModule.id] });
    expect(await lastAudit(auditEntityTypes.module, followModule.id, auditActions.adminContent.moduleRestored)).toMatchObject({ restoredWithCourseId: course.id, activeVersionId: followModule.versionId });
  });

  it("enkeltgjenoppretting nullstiller merkene, og elementet lander som utkast", async () => {
    const module = await createPublishedModule(tag("modul gjenopprettes alene"));
    const section = await apiSection(tag("seksjon gjenopprettes alene"));
    const course = await apiCourse("kurs der elementene gjenopprettes alene", { moduleIds: [module.id], sectionIds: [section] });
    expect((await archiveCourseConfirmed(course.id, ADMIN)).response.status).toBe(200);
    expect((await moduleRow(module.id)).archivedWithCourseId).toBe(course.id);

    expect((await post(modulePath(module.id, "/restore"))).status).toBe(200);
    expect((await post(sectionPath(section, "/restore"))).status).toBe(200);
    expect(await moduleRow(module.id)).toEqual({ archivedAt: null, activeVersionId: null, archivedWithCourseId: null, activeVersionIdBeforeArchive: null });
    expect(await sectionRow(section)).toEqual({ archivedAt: null, activeVersionId: null, archivedWithCourseId: null, activeVersionIdBeforeArchive: null });

    // Gjenopprettes kurset nå, kommer ingenting tilbake (elementene er aktive), og de forblir utkast.
    const restored = await post(coursePath(course.id, "/restore"));
    expect(restored.status, show(restored)).toBe(200);
    expect(restored.body.returns).toEqual([]);
    expect(restored.body.staysArchived).toEqual([]);
    expect((await moduleRow(module.id)).activeVersionId).toBeNull();
  });

  it("versjonen finnes ikke lenger for elementet: kommer tilbake som utkast, og svaret sier det", async () => {
    const section = await apiSection(tag("seksjon med versjon som mangler"));
    const course = await apiCourse("kurs med versjon som mangler", { sectionIds: [section] });
    expect((await archiveCourseConfirmed(course.id, ADMIN)).response.status).toBe(200);
    // Merket peker på en versjon som hører til en annen seksjon.
    const stranger = await apiSection(tag("en annen seksjon"));
    await prisma.courseSection.update({ where: { id: section }, data: { activeVersionIdBeforeArchive: (await sectionRow(stranger)).activeVersionId } });

    const preview = await get(coursePath(course.id, "/restore-preview"));
    expect(preview.body.returns).toEqual([expect.objectContaining({ id: section, versionId: null, asDraft: "version_missing" })]);
    const restored = await post(coursePath(course.id, "/restore"));
    expect(restored.status, show(restored)).toBe(200);
    expect(restored.body.returns).toEqual([expect.objectContaining({ id: section, versionId: null, asDraft: "version_missing" })]);
    expect(await sectionRow(section)).toEqual({ archivedAt: null, activeVersionId: null, archivedWithCourseId: null, activeVersionIdBeforeArchive: null });
  });

  it("et kurs som ikke er arkivert: restore gir 400 course_not_archived, og forhåndsvisningen `archived: false`", async () => {
    const course = await apiCourse("kurs som ikke er arkivert", { sectionIds: [await apiSection(tag("s"))] });
    const response = await post(coursePath(course.id, "/restore"));
    expect(response.status, show(response)).toBe(400);
    expect(response.body.error).toBe("course_not_archived");
    expect((await courseRow(course.id)).publishedAt).not.toBeNull();
    const preview = await get(coursePath(course.id, "/restore-preview"));
    expect(preview.body).toMatchObject({ archived: false, returns: [], staysArchived: [] });
  });

  it("tilgang: forhåndsvisningen av gjenopprettingen er for kursets eier; andre fagansvarlige får 403", async () => {
    const eier = smo("eier");
    const course = await apiCourse("kurs med eier", { sectionIds: [await apiSection(tag("s"), eier)] }, { headers: eier });
    expect((await get(coursePath(course.id, "/restore-preview"), smo("ikke-eier"))).status).toBe(403);
    expect((await get(coursePath(course.id, "/restore-preview"), eier)).status).toBe(200);
  });

  it("slettes kurset, nullstilles merket på elementer som pekte på det", async () => {
    const section = await apiSection(tag("tatt ut, så slettes kurset"));
    const keep = await apiSection(tag("blir i kurset"));
    const course = await apiCourse("kurs som slettes", { sectionIds: [section, keep] });
    expect((await archiveCourseConfirmed(course.id, ADMIN)).response.status).toBe(200);
    // Tatt ut mens kurset er arkivert: merket peker fortsatt på kurset.
    await removeFromArchivedCourse(course.id, section);
    expect((await sectionRow(section)).archivedWithCourseId).toBe(course.id);
    const deleted = await request(app).delete(coursePath(course.id)).set(ADMIN);
    expect(deleted.status, show(deleted)).toBe(204);
    expect(await sectionRow(section)).toMatchObject({ archivedWithCourseId: null, activeVersionIdBeforeArchive: null });
    expect((await sectionRow(section)).archivedAt).not.toBeNull();
  });
});

describe("#1150 2a-2: merket settes bare av kursarkiveringen", () => {
  it("kaskadeslettingen nullstiller merket på elementer som overlever og pekte på kurset", async () => {
    const survivor = await apiSection(tag("overlever kaskaden"));
    const keep = await apiSection(tag("slettes med kaskaden"));
    const course = await apiCourse("kurs som kaskadeslettes", { sectionIds: [survivor, keep] });
    expect((await archiveCourseConfirmed(course.id, ADMIN)).response.status).toBe(200);
    await removeFromArchivedCourse(course.id, survivor);
    expect((await sectionRow(survivor)).archivedWithCourseId).toBe(course.id);
    const preview = await get(coursePath(course.id, "/cascade-delete-preview"));
    expect(preview.status, show(preview)).toBe(200);
    const deleted = await post(coursePath(course.id, "/cascade-delete"), { expectedDeletedModuleIds: [], expectedDeletedSectionIds: [keep] });
    expect(deleted.status, show(deleted)).toBe(200);
    expect(await sectionRow(survivor)).toMatchObject({ archivedWithCourseId: null, activeVersionIdBeforeArchive: null });
    expect((await sectionRow(survivor)).archivedAt).not.toBeNull();
  });

  it("arkivering for hånd setter ikke merket, og nullstiller et som gammel kode lot stå", async () => {
    const module = await createPublishedModule(tag("modul med gammelt merke"));
    const section = await apiSection(tag("seksjon med gammelt merke"));
    // Gammel kode (før 2a-2) gjenopprettet elementet uten å nullstille merket: aktivt, men med merke.
    const stale = { archivedWithCourseId: `gammelt-kurs-${RUN}`, activeVersionIdBeforeArchive: "gammel-versjon" };
    await prisma.module.update({ where: { id: module.id }, data: stale });
    await prisma.courseSection.update({ where: { id: section }, data: stale });
    expect((await post(modulePath(module.id, "/archive"))).status).toBe(200);
    expect((await post(sectionPath(section, "/archive"))).status).toBe(200);
    expect(await moduleRow(module.id)).toMatchObject({ archivedWithCourseId: null, activeVersionIdBeforeArchive: null, activeVersionId: null });
    expect(await sectionRow(section)).toMatchObject({ archivedWithCourseId: null, activeVersionIdBeforeArchive: null, activeVersionId: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5. Prøvesteinen for publisering etter gjenoppretting (planen, «Gjenoppretting»).
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("#1150 2a-2: et gjenopprettet kurs publiseres uten ny hovedversjon, og fremdriften står", () => {
  it("kursbevis og en lest seksjon: arkiver, gjenopprett, publiser — samme versjon, ingen e-post, lesing og bestått teller som før", async () => {
    const module = await apiModule(tag("modul i kurs med kursbevis"));
    const section = await apiSection(tag("seksjon i kurs med kursbevis"));
    const course = await apiCourse("kurs med kursbevis", { moduleIds: [module.id], sectionIds: [section] });
    const before = await courseRow(course.id);

    // Én har kursbevis for nåværende hovedversjon (bestått og lest), én har lest seksjonen og ikke bestått.
    const holder = await createUser("bevis");
    await pass(holder, module);
    await read(holder, course.id, section);
    await prisma.courseCompletion.create({ data: { userId: holder, courseId: course.id, versionMajor: before.versionMajor, versionMinor: before.versionMinor, moduleSnapshotJson: JSON.stringify([module.id]), sectionSnapshotJson: JSON.stringify([section]) } });
    const reader = await createUser("leser");
    await read(reader, course.id, section);
    const moduleVersion = (await moduleRow(module.id)).activeVersionId;
    const sectionVersion = (await sectionRow(section)).activeVersionId;
    const versionsBefore = await prisma.courseVersion.count({ where: { courseId: course.id } });
    const noticesBefore = await prisma.courseVersionNotice.count({ where: { courseId: course.id } });

    const archived = await archiveCourseConfirmed(course.id, ADMIN);
    expect(archived.preview.inProgressCount).toBe(1);
    expect(archived.response.status, show(archived.response)).toBe(200);
    const restored = await post(coursePath(course.id, "/restore"));
    expect(restored.status, show(restored)).toBe(200);
    expect(await moduleRow(module.id)).toMatchObject({ activeVersionId: moduleVersion, archivedAt: null });
    expect(await sectionRow(section)).toMatchObject({ activeVersionId: sectionVersion, archivedAt: null });

    // «Publiser kurs» uten noe svar om versjon: ingenting er upublisert, så ingen kaskade og ingen
    // `course_publish_has_republished_modules`.
    const preview = await get(coursePath(course.id, "/publish-preview"));
    expect(preview.body.unpublishedItems, show(preview)).toEqual([]);
    const published = await post(coursePath(course.id, "/publish"));
    expect(published.status, show(published)).toBe(200);
    expect(published.body.publishedItems ?? []).toEqual([]);

    const after = await courseRow(course.id);
    expect(after.publishedAt).not.toBeNull();
    expect({ major: after.versionMajor, minor: after.versionMinor }).toEqual({ major: before.versionMajor, minor: before.versionMinor });
    expect(await prisma.courseVersion.count({ where: { courseId: course.id } })).toBe(versionsBefore);
    expect(await prisma.courseVersionNotice.count({ where: { courseId: course.id } })).toBe(noticesBefore);
    // Modulens versjon har samme nummer.
    expect(await prisma.moduleVersion.findUniqueOrThrow({ where: { id: moduleVersion! }, select: { versionMajor: true, versionMinor: true } })).toEqual({ versionMajor: 1, versionMinor: 0 });

    // Fremdriften står: lesingene teller for nåværende hovedversjon, og beståtten teller i kurset.
    const repo = createCourseRepository(prisma);
    expect(await repo.findReadSectionIds(reader, course.id)).toEqual([section]);
    expect(await repo.findReadSectionIds(holder, course.id)).toEqual([section]);
    const progress = await repo.findModuleProgress({ userIds: [holder], courses: [{ courseId: course.id, moduleIds: [module.id] }] });
    expect([...progress.passedModuleIds(holder, course.id)]).toEqual([module.id]);
    // Kursbeviset er det samme, for samme hovedversjon.
    expect(await prisma.courseCompletion.count({ where: { userId: holder, courseId: course.id, versionMajor: before.versionMajor } })).toBe(1);
  });
});
