import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { withRevision } from "./support/courseRevision.js";
import { recordFixturePass } from "./support/modulePassFixture.js";
import { archiveCourseConfirmed } from "./support/courseArchive.js";

// #1150 skive 2a-1 (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, etappe 2): bare lesing på tjeneren.
//
//   1. Én regel for «brukes andre steder» ved arkivering: et annet AKTIVT kurs, eller et lagret utkast (#1140) til et annet
//      aktivt kurs. Arkivering for hånd og importens `updateExisting` bruker den. Avpublisering og sletting er uendret.
//   2. `GET /api/admin/content/courses/:courseId/archive-preview`: hva en arkivering av kurset ville gjort.
//   3. «Deltakere midt i»: samme regel som «Mine kurs» (I gang), i G3 og i forhåndsvisningen.
//   4. `pendingReviewCount`: besvarelser fra dem som ikke er ferdig vurdert, eller har en åpen anke.
//
// Testene går gjennom rutene (supertest). Hver fikstur sier ALT regelen leser: kursets `archivedAt`, `publishedAt` og
// `versionMajor`, elementenes `archivedAt`, utkastets elementliste, bevisets `versionMajor`, lesingens `readAt` og raden i
// `CourseVersion` (eller at den mangler), innleveringens status og ankens status.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
// En ny administrator per test: admin-API-et slipper bare 120 kall i minuttet per bruker (`generalApiLimiter`).
const ADMIN: Record<string, string> = {
  "x-user-id": "archive-1150-admin",
  "x-user-email": "archive.1150.admin@x.test",
  "x-user-name": "Admin",
  "x-user-roles": "ADMINISTRATOR",
  "x-locale": "nb",
};
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `archive-1150-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `archive.1150.admin.${RUN}.${adminSeq}@x.test`;
});
// To fagansvarlige, så «eier» kan skilles fra «kan se og bruke» (stående produktavgjørelse: deling er ønsket).
const smo = (name: string) => ({
  "x-user-id": `archive-1150-${name}-${RUN}`,
  "x-user-email": `archive.1150.${name}.${RUN}@x.test`,
  "x-user-name": name,
  "x-user-roles": "SUBJECT_MATTER_OWNER",
  "x-locale": "nb",
});

let seq = 0;
const tag = (name: string) => `1150 ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

const sectionPath = (sectionId: string, action = "") => `/api/admin/content/sections/${sectionId}${action}`;
const modulePath = (moduleId: string, action = "") => `/api/admin/content/modules/${moduleId}${action}`;
const coursePath = (courseId: string, action = "") => `/api/admin/content/courses/${courseId}${action}`;
const post = (path: string, body: object = {}, headers: Record<string, string> = ADMIN) => request(app).post(path).set(headers).send(body);
const preview = (courseId: string, headers: Record<string, string> = ADMIN) => request(app).get(coursePath(courseId, "/archive-preview")).set(headers);

/** En publisert modul med hovedversjon 1.0 (feltet `findModuleProgress` leser), uten eier. */
async function createPublishedModule(title: string) {
  const source = await prisma.moduleVersion.findFirst({
    where: { module: { activeVersionId: { not: null } } },
    select: { rubricVersionId: true, promptTemplateVersionId: true, mcqSetVersionId: true },
    orderBy: { createdAt: "asc" },
  });
  expect(source).toBeTruthy();
  const module = await prisma.module.create({ data: { title: JSON.stringify(L(title)), archivedAt: null }, select: { id: true } });
  const moduleVersion = await prisma.moduleVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      versionMajor: 1,
      versionMinor: 0,
      taskText: JSON.stringify(L(`${title} task`)),
      assessorExpectedContent: JSON.stringify(L(`${title} guidance`)),
      rubricVersionId: source!.rubricVersionId,
      promptTemplateVersionId: source!.promptTemplateVersionId,
      mcqSetVersionId: source!.mcqSetVersionId,
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: moduleVersion.id } });
  return { id: module.id, versionId: moduleVersion.id };
}

/** En publisert seksjon, uten eier. `archived`: arkivert (og dermed avpublisert, I3). */
async function createSection(title: string, options: { archived?: boolean } = {}) {
  const section = await prisma.courseSection.create({ data: { title: JSON.stringify(L(title)), archivedAt: null }, select: { id: true } });
  const v1 = await prisma.courseSectionVersion.create({
    data: { sectionId: section.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Tekst.")), publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.courseSection.update({
    where: { id: section.id },
    data: options.archived ? { archivedAt: new Date(), activeVersionId: null } : { activeVersionId: v1.id },
  });
  return section.id;
}

/** En seksjon laget og publisert gjennom API-et av `headers`: den som lager, blir eier. */
async function apiSection(title: string, headers: Record<string, string>) {
  const created = await post("/api/admin/content/sections", { title: L(title), bodyMarkdown: L("Tekst.") }, headers);
  expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
  const id = created.body.section.id as string;
  expect((await post(sectionPath(id, "/publish"), {}, headers)).status).toBe(200);
  return id;
}

type CourseState = "archived" | "draft" | "published";
type Items = { moduleIds?: string[]; sectionIds?: string[] };

function itemRows(items: Items) {
  return [
    ...(items.moduleIds ?? []).map((moduleId) => ({ itemType: "MODULE" as const, moduleId })),
    ...(items.sectionIds ?? []).map((sectionId) => ({ itemType: "SECTION" as const, sectionId })),
  ].map((row, sortOrder) => ({ ...row, sortOrder }));
}

/**
 * Et kurs i en bestemt tilstand, med elementene. Tilstanden sier begge feltene regelen leser:
 *   archived  = archivedAt satt, publishedAt null (arkivering avpubliserer, I3)
 *   draft     = archivedAt null, publishedAt null
 *   published = archivedAt null, publishedAt satt
 * `versionMajor` står alltid (beviset sammenlignes med den).
 */
async function createCourse(name: string, state: CourseState, items: Items, versionMajor = 1) {
  const title = tag(name);
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify(L(title)),
      certificationLevel: "basic",
      archivedAt: state === "archived" ? new Date() : null,
      publishedAt: state === "published" ? new Date() : null,
      versionMajor,
      versionMinor: 0,
      slug: `archive-1150-${RUN}-${seq++}`,
      items: { create: itemRows(items) },
    },
    select: { id: true },
  });
  return { id: course.id, title };
}

/** Lagrer et utkast slik kursbyggeren gjør (krever et publisert kurs). `items` er HELE lista i utkastet. */
async function saveDraft(courseId: string, items: Items, headers: Record<string, string> = ADMIN) {
  const loaded = (await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { contentRevision: true } })).contentRevision;
  const list = [
    ...(items.moduleIds ?? []).map((moduleId) => ({ type: "MODULE", moduleId })),
    ...(items.sectionIds ?? []).map((sectionId) => ({ type: "SECTION", sectionId })),
  ];
  const saved = await request(app).put(coursePath(courseId, "/draft")).set(headers).send({ items: list, loaded: { expectedRevision: loaded } });
  expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
}

/** Et publisert kurs med et lagret utkast som tar med `inDraft` (kursets egen liste er en annen seksjon). */
async function courseWithDraft(name: string, state: "published" | "archived", inDraft: Items) {
  const own = await createSection(tag(`${name} egen seksjon`));
  const course = await createCourse(name, "published", { sectionIds: [own] });
  await saveDraft(course.id, { moduleIds: inDraft.moduleIds, sectionIds: [own, ...(inDraft.sectionIds ?? [])] });
  // Arkivert MED utkastet liggende: tilstanden data arkivert før 2a-2 kan ha. Fra 2a-2 forkaster arkiveringen gjennom ruta kursets
  // utkast, så fiksturen skriver feltene direkte (arkivert = archivedAt satt, publishedAt null, I3).
  if (state === "archived") await prisma.course.update({ where: { id: course.id }, data: { archivedAt: new Date(), publishedAt: null } });
  return course;
}

async function createUser(name: string) {
  const id = `${RUN}-${seq++}`;
  const user = await prisma.user.create({
    data: { externalId: `archive-1150-${name}-${id}`, email: `archive.1150.${name}.${id}@company.com`, name },
    select: { id: true },
  });
  return user.id;
}

async function submit(userId: string, module: { id: string; versionId: string }, status: "SUBMITTED" | "COMPLETED" | "SUPERSEDED" | "UNDER_REVIEW") {
  return (await prisma.submission.create({
    data: { userId, moduleId: module.id, moduleVersionId: module.versionId, deliveryType: "text", submissionStatus: status },
    select: { id: true },
  })).id;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. Arkivering for hånd: et lagret utkast til et annet AKTIVT kurs stopper. Et arkivert kurs' utkast gjør det ikke.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("#1150: arkivering for hånd stoppes av et lagret utkast til et annet aktivt kurs", () => {
  it("seksjon: stoppet med kurset og «utkast» i svaret. KONTROLL: i et ARKIVERT kurs' utkast arkiveres den", async () => {
    const inActiveDraft = await createSection(tag("seksjon i aktivt utkast"));
    const inArchivedDraft = await createSection(tag("seksjon i arkivert utkast"));
    const active = await courseWithDraft("aktivt kurs med utkast", "published", { sectionIds: [inActiveDraft] });
    await courseWithDraft("arkivert kurs med utkast", "archived", { sectionIds: [inArchivedDraft] });

    const blocked = await post(sectionPath(inActiveDraft, "/archive"));
    expect(blocked.status, JSON.stringify(blocked.body).slice(0, 300)).toBe(400);
    expect(blocked.body.error).toBe("content_in_course_draft");
    expect(blocked.body.details).toEqual({
      count: 1,
      courseTitles: [active.title],
      draftCount: 1,
      draftCourseTitles: [active.title],
      uses: [{ courseId: active.id, title: active.title, via: "draft" }],
    });
    // Reserven for en API-konsument uten oversettelser sier det samme.
    expect(blocked.body.message).toContain(`bare i et lagret utkast: «${active.title}»`);
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: inActiveDraft } })).archivedAt).toBeNull();

    const archived = await post(sectionPath(inArchivedDraft, "/archive"));
    expect(archived.status, JSON.stringify(archived.body).slice(0, 300)).toBe(200);
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: inArchivedDraft } })).archivedAt).not.toBeNull();
  });

  it("modul: stoppet med kurset og «utkast» i svaret. KONTROLL: i et ARKIVERT kurs' utkast arkiveres den", async () => {
    const inActiveDraft = await createPublishedModule(tag("modul i aktivt utkast"));
    const inArchivedDraft = await createPublishedModule(tag("modul i arkivert utkast"));
    const active = await courseWithDraft("aktivt kurs med utkast", "published", { moduleIds: [inActiveDraft.id] });
    await courseWithDraft("arkivert kurs med utkast", "archived", { moduleIds: [inArchivedDraft.id] });

    const blocked = await post(modulePath(inActiveDraft.id, "/archive"));
    expect(blocked.status, JSON.stringify(blocked.body).slice(0, 300)).toBe(400);
    expect(blocked.body.error).toBe("content_in_course_draft");
    expect(blocked.body.details).toMatchObject({ count: 1, courseTitles: [active.title], draftCount: 1, draftCourseTitles: [active.title] });
    expect((await prisma.module.findUniqueOrThrow({ where: { id: inActiveDraft.id } })).archivedAt).toBeNull();

    const archived = await post(modulePath(inArchivedDraft.id, "/archive"));
    expect(archived.status, JSON.stringify(archived.body).slice(0, 300)).toBe(200);
    expect((await prisma.module.findUniqueOrThrow({ where: { id: inArchivedDraft.id } })).archivedAt).not.toBeNull();
  });

  it("i et aktivt kurs' liste OG et annet kurs' utkast: begge navngis, og bare utkastet merkes som utkast", async () => {
    const sectionId = await createSection(tag("seksjon i liste og utkast"));
    const listed = await createCourse("kurs med seksjonen i lista", "draft", { sectionIds: [sectionId] });
    const drafted = await courseWithDraft("kurs med seksjonen i utkastet", "published", { sectionIds: [sectionId] });

    const blocked = await post(sectionPath(sectionId, "/archive"));
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe("content_in_course_draft");
    expect(blocked.body.details.count).toBe(2);
    expect([...blocked.body.details.courseTitles].sort()).toEqual([listed.title, drafted.title].sort());
    expect(blocked.body.details.draftCourseTitles).toEqual([drafted.title]);
  });

  it("KONTROLL: uten utkast er svaret det samme som før (`content_in_use`)", async () => {
    const sectionId = await createSection(tag("seksjon bare i lista"));
    const listed = await createCourse("kurs med seksjonen i lista", "published", { sectionIds: [sectionId] });
    const blocked = await post(sectionPath(sectionId, "/archive"));
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe("content_in_use");
    expect(blocked.body.details).toEqual({ count: 1, courseTitles: [listed.title] });
  });

  it("avpublisering er uendret: et element som bare står i et utkast, kan avpubliseres", async () => {
    const sectionId = await createSection(tag("seksjon bare i utkast, avpubliseres"));
    const moduleRef = await createPublishedModule(tag("modul bare i utkast, avpubliseres"));
    await courseWithDraft("kurs med utkast", "published", { sectionIds: [sectionId], moduleIds: [moduleRef.id] });
    expect((await post(sectionPath(sectionId, "/unpublish"))).status).toBe(200);
    expect((await post(modulePath(moduleRef.id, "/unpublish"))).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. Importens `updateExisting`: et utbyttet element som står i et annet kurs' utkast, blir stående.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("#1150: importens «oppdater kurs» arkiverer ikke det som står i et annet kurs' utkast", () => {
  const owner = () => smo("importerer");

  // En publisert modul laget gjennom API-et, slik eksporten krever (kriterier, ledetekst, flervalg, versjon).
  async function apiModule(title: string) {
    const send = async (path: string, body: object) => {
      const r = await post(path, body);
      expect(r.status, `${path}: ${JSON.stringify(r.body).slice(0, 300)}`).toBeLessThan(300);
      return r.body;
    };
    const module = await send("/api/admin/content/modules", { title: L(title), description: L("Beskrivelse"), certificationLevel: "basic" });
    const moduleId = module.module.id as string;
    const rubric = await send(modulePath(moduleId, "/rubric-versions"), { criteria: { relevance: "0-4", quality: "0-4" }, scalingRule: { practical_weight: 70, max_total: 20 } });
    const prompt = await send(modulePath(moduleId, "/prompt-template-versions"), { systemPrompt: L("Sys"), userPromptTemplate: L("Eval"), examples: [{ note: "fixture" }] });
    const mcq = await send(modulePath(moduleId, "/mcq-set-versions"), { title: L("MCQ"), questions: [{ stem: L("Hva er 1+1?"), options: [L("2"), L("3")], correctAnswer: L("2"), rationale: L("Matte") }] });
    const version = await send(modulePath(moduleId, "/module-versions"), {
      taskText: L("Reflekter"),
      assessorExpectedContent: L("Nevn QA"),
      rubricVersionId: rubric.rubricVersion.id,
      promptTemplateVersionId: prompt.promptTemplateVersion.id,
      mcqSetVersionId: mcq.mcqSetVersion.id,
    });
    await send(modulePath(moduleId, `/module-versions/${version.moduleVersion.id}/publish`), {});
    return moduleId;
  }

  it("i et aktivt kurs' utkast: blir stående. KONTROLL, i et arkivert kurs' utkast: arkiveres", async () => {
    // Administratoren eier fire elementer. Fagansvarlig legger dem i sitt kurs og oppdaterer kurset fra fil: det hen ikke
    // eier, byttes ut med egne kopier, og det gamle arkiveres når ingen andre AKTIVE kurs (eller utkast til dem) bruker det.
    const sectionInActiveDraft = await apiSection(tag("seksjon, ellers i aktivt utkast"), ADMIN);
    const sectionInArchivedDraft = await apiSection(tag("seksjon, ellers i arkivert utkast"), ADMIN);
    const moduleInActiveDraft = await apiModule(tag("modul, ellers i aktivt utkast"));
    const moduleInArchivedDraft = await apiModule(tag("modul, ellers i arkivert utkast"));
    await courseWithDraft("annet kurs med utkast, aktivt", "published", { sectionIds: [sectionInActiveDraft], moduleIds: [moduleInActiveDraft] });
    await courseWithDraft("annet kurs med utkast, arkivert", "archived", { sectionIds: [sectionInArchivedDraft], moduleIds: [moduleInArchivedDraft] });

    const created = await request(app).post("/api/admin/content/courses").set(owner()).send({ title: L(tag("fagansvarligs kurs")) });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const courseId = created.body.course.id as string;
    const items = await request(app).put(coursePath(courseId, "/items")).set(owner()).send(await withRevision(courseId, { items: [
      { type: "SECTION", sectionId: sectionInActiveDraft }, { type: "SECTION", sectionId: sectionInArchivedDraft },
      { type: "MODULE", moduleId: moduleInActiveDraft }, { type: "MODULE", moduleId: moduleInArchivedDraft },
    ] }));
    expect(items.status, JSON.stringify(items.body).slice(0, 300)).toBe(204);
    expect((await request(app).post(coursePath(courseId, "/publish")).set(owner())).status).toBe(200);

    const exported = await request(app).get(coursePath(courseId, "/export-package")).set(owner());
    expect(exported.status, JSON.stringify(exported.body).slice(0, 300)).toBe(200);
    const file = JSON.parse(JSON.stringify(exported.body.envelope ?? exported.body));
    for (const item of file.course.course.items as Array<any>) {
      if (item.section) item.section.bodyMarkdown = L("Justert av fagansvarlig.");
      else item.module.activeVersion.taskText = L("Justert oppgave.");
    }

    const imported = await request(app).post("/api/admin/content/courses/import").set(owner()).send({ payload: file, mode: "updateExisting", targetId: courseId });
    expect(imported.status, JSON.stringify(imported.body).slice(0, 400)).toBe(201);
    const replaced = imported.body.summary.replacedUnownedIds as Array<{ type: string; oldId: string; oldArchived: boolean }>;
    expect(replaced.map((r) => [r.type, r.oldId, r.oldArchived])).toEqual([
      ["SECTION", sectionInActiveDraft, false],
      ["SECTION", sectionInArchivedDraft, true],
      ["MODULE", moduleInActiveDraft, false],
      ["MODULE", moduleInArchivedDraft, true],
    ]);
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionInActiveDraft } })).archivedAt).toBeNull();
    expect((await prisma.module.findUniqueOrThrow({ where: { id: moduleInActiveDraft } })).archivedAt).toBeNull();
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionInArchivedDraft } })).archivedAt).not.toBeNull();
    expect((await prisma.module.findUniqueOrThrow({ where: { id: moduleInArchivedDraft } })).archivedAt).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. Forhåndsvisningen: følger med, blir stående, arkivert fra før, eierskap, tilgang.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("#1150: GET …/archive-preview — hva som følger kurset inn i arkivet", () => {
  type Entry = { type: string; id: string; title: string; owned?: boolean; usedBy?: Array<{ courseId: string; title: string; via: string }> };

  it("eksklusivt følger, delt med aktivt kurs eller aktivt utkast blir stående, arkivert kurs og arkivert utkast teller ikke", async () => {
    const forfatter = smo("forfatter");
    const annen = smo("annen-forfatter");
    // Elementene. `exclusiveOwned` lager forfatteren selv (eier), `exclusiveOther` lager den andre fagansvarlige.
    const exclusiveOwned = await apiSection(tag("eksklusiv, forfatterens"), forfatter);
    const exclusiveOther = await apiSection(tag("eksklusiv, den andres"), annen);
    const sharedWithActive = await createPublishedModule(tag("delt med aktivt kurs"));
    const sharedWithArchived = await createSection(tag("delt med arkivert kurs"));
    const inActiveDraft = await createSection(tag("i aktivt kurs' utkast"));
    const inArchivedDraft = await createPublishedModule(tag("i arkivert kurs' utkast"));
    const alreadyArchived = await createSection(tag("arkivert fra før"), { archived: true });

    const active = await createCourse("aktivt kurs", "published", { moduleIds: [sharedWithActive.id] });
    await createCourse("arkivert kurs", "archived", { sectionIds: [sharedWithArchived] });
    const activeWithDraft = await courseWithDraft("aktivt kurs med utkast", "published", { sectionIds: [inActiveDraft] });
    await courseWithDraft("arkivert kurs med utkast", "archived", { moduleIds: [inArchivedDraft.id] });

    // Kurset forfatteren eier (laget gjennom API-et), med elementene skrevet som fikstur, publisert, og med et EGET utkast som
    // tar med det eksklusive elementet: kursets eget utkast forkastes ved arkiveringen og teller ikke som «et annet sted».
    const created = await request(app).post("/api/admin/content/courses").set(forfatter).send({ title: L(tag("kurset som arkiveres")) });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const courseId = created.body.course.id as string;
    await prisma.courseItem.createMany({
      data: itemRows({
        moduleIds: [sharedWithActive.id, inArchivedDraft.id],
        sectionIds: [exclusiveOwned, exclusiveOther, sharedWithArchived, inActiveDraft, alreadyArchived],
      }).map((row) => ({ ...row, courseId })),
    });
    await prisma.course.update({ where: { id: courseId }, data: { publishedAt: new Date(), archivedAt: null } });
    await saveDraft(courseId, { sectionIds: [exclusiveOwned] }, forfatter);

    const response = await preview(courseId, forfatter);
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
    const body = response.body as { follows: Entry[]; stays: Entry[]; alreadyArchived: Entry[]; [key: string]: unknown };
    expect(body).toMatchObject({ courseId, archived: false, hasDraft: true, inProgressCount: 0, pendingReviewCount: 0 });

    const byId = (list: Entry[]) => Object.fromEntries(list.map((entry) => [entry.id, entry]));
    const follows = byId(body.follows);
    expect(Object.keys(follows).sort()).toEqual([exclusiveOwned, exclusiveOther, sharedWithArchived, inArchivedDraft.id].sort());
    // Eierskap: forfatteren eier sin egen seksjon, ikke den andres og ikke elementene uten eier. Alle følger likevel med.
    expect(follows[exclusiveOwned]).toMatchObject({ type: "SECTION", owned: true });
    expect(follows[exclusiveOther]).toMatchObject({ type: "SECTION", owned: false });
    expect(follows[inArchivedDraft.id]).toMatchObject({ type: "MODULE", owned: false });

    const stays = byId(body.stays);
    expect(Object.keys(stays).sort()).toEqual([sharedWithActive.id, inActiveDraft].sort());
    expect(stays[sharedWithActive.id]).toMatchObject({ type: "MODULE", usedBy: [{ courseId: active.id, title: active.title, via: "course" }] });
    expect(stays[inActiveDraft]).toMatchObject({ type: "SECTION", usedBy: [{ courseId: activeWithDraft.id, title: activeWithDraft.title, via: "draft" }] });

    expect(body.alreadyArchived).toEqual([expect.objectContaining({ type: "SECTION", id: alreadyArchived })]);
    // Titlene står på språket som spør.
    expect(follows[exclusiveOwned].title).toContain("eksklusiv, forfatterens");

    // Administratoren eier alt.
    const asAdmin = await preview(courseId);
    expect(asAdmin.status).toBe(200);
    expect((asAdmin.body.follows as Entry[]).every((entry) => entry.owned === true)).toBe(true);

    // Bare lesing: ingenting er arkivert.
    expect((await prisma.course.findUniqueOrThrow({ where: { id: courseId } })).archivedAt).toBeNull();
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: exclusiveOwned } })).archivedAt).toBeNull();
  });

  it("tilgang: en fagansvarlig som ikke eier kurset, får 403; eieren får svar", async () => {
    const eier = smo("kurseier");
    const created = await request(app).post("/api/admin/content/courses").set(eier).send({ title: L(tag("kurs med eier")) });
    expect(created.status).toBe(201);
    const courseId = created.body.course.id as string;
    const denied = await preview(courseId, smo("ikke-eier"));
    expect(denied.status, JSON.stringify(denied.body).slice(0, 300)).toBe(403);
    expect(denied.body.error).toBe("content_ownership");
    expect((await preview(courseId, eier)).status).toBe(200);
  });

  it("et arkivert kurs: `archived: true` og tomme lister", async () => {
    const sectionId = await createSection(tag("i arkivert kurs"));
    const course = await createCourse("arkivert kurs", "archived", { sectionIds: [sectionId] });
    const response = await preview(course.id);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      courseId: course.id, courseTitle: course.title, archived: true, published: false, inProgressCount: 0, completedWithoutCertificateCount: 0,
      pendingReviewCount: 0, hasDraft: false,
      follows: [], stays: [], alreadyArchived: [],
    });
  });

  it("et kurs som ikke finnes: 404 for administratoren", async () => {
    const response = await preview("finnes-ikke-1150");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("course_not_found");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. «Deltakere midt i» (som «Mine kurs»: I gang), i forhåndsvisningen og i G3.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("#1150: deltakere midt i kurset telles som «Mine kurs», og G3 og forhåndsvisningen svarer likt", () => {
  it("hvem som teller, og at arkiveringen stoppes med samme tall", async () => {
    // Kurset C er på hovedversjon 2 (siden T). Stegene: modulen M (delt med det aktive kurset A) og seksjonene S1, S2.
    const T = new Date(Date.now() - 24 * 3600 * 1000);
    const M = await createPublishedModule(tag("modul M, delt"));
    const S1 = await createSection(tag("seksjon S1"));
    const S2 = await createSection(tag("seksjon S2"));
    const C = await createCourse("kurs C", "published", { moduleIds: [M.id], sectionIds: [S1, S2] }, 2);
    await createCourse("kurs A, deler modulen", "published", { moduleIds: [M.id] });
    // Regelen for lesinger i hovedversjon 2: bare lesinger fra T og etter teller (ingen seksjon er uendret fra versjon 1).
    await prisma.courseVersion.createMany({
      data: [
        { courseId: C.id, versionMajor: 1, publishedAt: new Date(T.getTime() - 30 * 24 * 3600 * 1000), sectionVersionsJson: "{}" },
        { courseId: C.id, versionMajor: 2, publishedAt: T, sectionVersionsJson: "{}" },
      ],
    });
    const after = new Date(T.getTime() + 3600 * 1000);
    const before = new Date(T.getTime() - 3600 * 1000);
    const read = (userId: string, sectionId: string, readAt: Date) => prisma.courseSectionRead.create({ data: { userId, courseId: C.id, sectionId, readAt } });
    const certificate = (userId: string, versionMajor: number) =>
      prisma.courseCompletion.create({ data: { userId, courseId: C.id, versionMajor, versionMinor: 0, moduleSnapshotJson: "[]", sectionSnapshotJson: "[]" } });

    // TELLER: har lest én seksjon (etter T), ingen bevis.
    const lestEn = await createUser("lest-en");
    await read(lestEn, S1, after);
    // TELLER IKKE: kursbevis for nåværende hovedversjon (2), og har lest.
    const nyttBevis = await createUser("nytt-bevis");
    await certificate(nyttBevis, 2);
    await read(nyttBevis, S1, after);
    // TELLER: bevis for en eldre hovedversjon (1), og har begynt på nytt (lest etter T). «Mine kurs» viser I gang.
    const gammeltBevisIgang = await createUser("gammelt-bevis-i-gang");
    await certificate(gammeltBevisIgang, 1);
    await read(gammeltBevisIgang, S1, after);
    // TELLER IKKE: bevis for hovedversjon 1 og bare en lesing fra før T. Lesingen teller ikke i versjon 2, så hen har ikke
    // begynt på den. (Før #1150: telte ikke heller, beviset gjorde hen ferdig.)
    const gammeltBevisUrort = await createUser("gammelt-bevis-urort");
    await certificate(gammeltBevisUrort, 1);
    await read(gammeltBevisUrort, S1, before);
    // TELLER IKKE: alle stegene gjort uten bevis (bestått M i versjon 1, kravet 1, lest S1 og S2). «Mine kurs» sier Fullført.
    // (Før #1150: telte, uten bevis var hen «midt i».)
    const alleSteg = await createUser("alle-steg");
    const passSubmission = await submit(alleSteg, M, "COMPLETED");
    const decision = await prisma.assessmentDecision.create({
      data: {
        submissionId: passSubmission, moduleVersionId: M.versionId, mcqScaledScore: 1, practicalScaledScore: 1, totalScore: 1, redFlagsJson: "[]",
        passFailTotal: true, decisionType: "AUTOMATIC", decisionReason: "Fikstur for #1150.",
      },
      select: { id: true },
    });
    await recordFixturePass({ userId: alleSteg, moduleId: M.id, moduleVersionId: M.versionId, submissionId: passSubmission, decisionId: decision.id });
    expect(await prisma.courseModuleRequirement.findUnique({ where: { courseId_moduleId: { courseId: C.id, moduleId: M.id } }, select: { minModuleMajor: true } })).toEqual({ minModuleMajor: 1 });
    await read(alleSteg, S1, after);
    await read(alleSteg, S2, after);
    // TELLER (som i «Mine kurs»): en innlevering på den delte modulen M, levert «via» kurset A. En innlevering har ikke noe
    // kurs, så den gjør deltakeren påbegynt i alle kursene modulen ligger i. Uendret fra før #1150.
    const deltModul = await createUser("delt-modul");
    await submit(deltModul, M, "SUBMITTED");
    // TELLER IKKE: en lesing i en seksjon som er tatt ut av kurset (finnes bare som lesing). (Før #1150: telte.)
    const uttatt = await createSection(tag("seksjon tatt ut"));
    const lestUttatt = await createUser("lest-uttatt");
    await read(lestUttatt, uttatt, after);

    const response = await preview(C.id);
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    // lestEn, gammeltBevisIgang, deltModul.
    expect(response.body.inProgressCount).toBe(3);

    // G3 i `archiveCourse`: uten bekreftelse (en gammel fane) stopper det, med det samme tallet. (2a-2: med `expected` er det en
    // bekreftelse; se test/m2-course-archive-follow-1150.test.ts.)
    const blocked = await post(coursePath(C.id, "/archive"));
    expect(blocked.status, JSON.stringify(blocked.body).slice(0, 300)).toBe(400);
    expect(blocked.body.error).toBe("course_has_active_participants");
    expect(blocked.body.details).toEqual({ count: 3 });

    // Kurslista viser det samme tallet (#705-UX(F): «samme signal som G3-vakta»).
    const list = await request(app).get("/api/admin/content/courses").set(ADMIN);
    expect((list.body.courses as Array<{ id: string; inProgressCount: number }>).find((c) => c.id === C.id)?.inProgressCount).toBe(3);
  });

  it("KONTROLL: et kurs der ingen er midt i, viser 0 og kan arkiveres", async () => {
    const S = await createSection(tag("seksjon i kurs uten deltakere midt i"));
    const course = await createCourse("kurs uten deltakere midt i", "published", { sectionIds: [S] });
    // Den eneste deltakeren har fullført (lest den ene seksjonen), uten bevis.
    const ferdig = await createUser("ferdig");
    await prisma.courseSectionRead.create({ data: { userId: ferdig, courseId: course.id, sectionId: S, readAt: new Date() } });
    const response = await preview(course.id);
    expect(response.body.inProgressCount).toBe(0);
    // 2a-2: hen har fullført uten kursbevis, og seksjonen følger kurset inn i arkivet (lista bekreftes).
    expect(response.body.completedWithoutCertificateCount).toBe(1);
    expect((await archiveCourseConfirmed(course.id, ADMIN)).response.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5. `pendingReviewCount`
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("#1150: pendingReviewCount — besvarelser som fortsatt kan få et utfall", () => {
  it("i kø og åpen anke teller; ferdig vurdert, forlatt og den med bevis teller ikke", async () => {
    const M = await createPublishedModule(tag("modul med besvarelser"));
    const S = await createSection(tag("seksjon i kurset"));
    const course = await createCourse("kurs med besvarelser", "published", { moduleIds: [M.id], sectionIds: [S] });

    // Alle fire er midt i kurset (levert på M, ikke lest S, ingen bestått, ingen bevis).
    const iKo = await createUser("i-ko");
    await submit(iKo, M, "SUBMITTED");
    const ferdig = await createUser("ferdig-vurdert");
    await submit(ferdig, M, "COMPLETED");
    const anket = await createUser("anket");
    const anketSubmission = await submit(anket, M, "COMPLETED");
    await prisma.appeal.create({ data: { submissionId: anketSubmission, appealedById: anket, appealReason: "Fikstur for #1150.", appealStatus: "OPEN" } });
    const forlatt = await createUser("forlatt");
    await submit(forlatt, M, "SUPERSEDED");
    await submit(forlatt, M, "COMPLETED");
    // KONTROLL: kursbevis for nåværende hovedversjon (1). Hen er ikke midt i, så besvarelsen i kø telles ikke her.
    const medBevis = await createUser("med-bevis");
    await submit(medBevis, M, "SUBMITTED");
    await prisma.courseCompletion.create({ data: { userId: medBevis, courseId: course.id, versionMajor: 1, versionMinor: 0, moduleSnapshotJson: "[]", sectionSnapshotJson: "[]" } });
    // KONTROLL: en anke som er avgjort, teller ikke.
    const avgjortAnke = await createUser("avgjort-anke");
    const avgjortSubmission = await submit(avgjortAnke, M, "COMPLETED");
    await prisma.appeal.create({ data: { submissionId: avgjortSubmission, appealedById: avgjortAnke, appealReason: "Fikstur for #1150.", appealStatus: "RESOLVED" } });

    const response = await preview(course.id);
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(response.body.inProgressCount).toBe(5);
    // iKo (SUBMITTED) og anket (OPEN).
    expect(response.body.pendingReviewCount).toBe(2);
  });
});
