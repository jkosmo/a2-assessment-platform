import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { deleteModule, purgeUnpublishedModule } from "../src/modules/adminContent/adminContentCommands.js";
import { withRevision } from "./support/courseRevision.js";
import { archiveCourseConfirmed } from "./support/courseArchive.js";

// #1152 skive 4a-1 (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Etappe 4», og doc/DECISIONS.md, «Hva som holder et arkivert
// kurs igjen fra sletting»): SLETTING SOM VIRKER.
//
//   1. En arkivert modul uten deltakerhistorikk slettes med versjonene sine. Innleveringer og sertifiseringer holder den igjen,
//      hver med sin kode.
//   2. Et lagret kursutkast teller som bruk ved sletting, for modul og seksjon, og i masseryddingen av upubliserte moduler.
//   3. Eierradene (`ContentOwner`) går med kurs, modul og seksjon, også i kaskaden og masseryddingen.
//
// Alt gjennom rutene (supertest), med kontroll for hver sperre. Tilstandene ingen rute kan lage (et utkast som nevner et arkivert
// element; en sertifisering uten innlevering), skrives direkte og er merket der.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
// En ny administrator per test: admin-API-et slipper bare 120 kall i minuttet per bruker.
const ADMIN: Record<string, string> = { "x-user-id": "", "x-user-email": "", "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `del-1152-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `del.1152.admin.${RUN}.${adminSeq}@x.test`;
  ADMIN["x-forwarded-for"] = `10.152.${Math.floor(adminSeq / 250)}.${adminSeq % 250}`;
});
let seq = 0;
const tag = (name: string) => `1152 ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

const C = "/api/admin/content";
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 500);
const post = (path: string, body: object = {}) => request(app).post(path).set(ADMIN).send(body);
const put = (path: string, body: object = {}) => request(app).put(path).set(ADMIN).send(body);
const get = (path: string) => request(app).get(path).set(ADMIN);
const del = (path: string) => request(app).delete(path).set(ADMIN);
const S = (id: string, action = "") => `${C}/sections/${id}${action}`;
const M = (id: string, action = "") => `${C}/modules/${id}${action}`;
const K = (id: string, action = "") => `${C}/courses/${id}${action}`;

async function ok(r: request.Response | Promise<request.Response>, label: string) {
  const res = await r;
  expect(res.status, `${label}: ${show(res)}`).toBeLessThan(300);
  return res.body;
}

// ── Fiksturer ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function apiSection(name: string) {
  const created = await ok(post(`${C}/sections`, { title: L(tag(name)), bodyMarkdown: L("Tekst.") }), "seksjon");
  const id = created.section.id as string;
  await ok(post(S(id, "/publish")), "publiser seksjon");
  return id;
}

/** En publisert modul med alt: kriterier, ledetekst, flervalgssett med spørsmål, og en modulversjon. */
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

async function apiCourse(name: string, items: Item[], publish: boolean) {
  const created = await ok(post(`${C}/courses`, { title: L(tag(name)) }), "kurs");
  const id = created.course.id as string;
  const r = await put(K(id, "/items"), await withRevision(id, { items }));
  expect(r.status, show(r)).toBe(204);
  if (publish) await ok(post(K(id, "/publish")), "publiser kurs");
  return id;
}

async function archiveCourse(courseId: string) {
  const { response } = await archiveCourseConfirmed(courseId, ADMIN);
  expect(response.status, show(response)).toBe(200);
}

async function user(name: string) {
  const id = `del-1152-${name}-${RUN}-${seq++}`;
  await prisma.user.upsert({ where: { id }, update: {}, create: { id, email: `${id}@x.test`, name, externalId: id } });
  return id;
}

/** En eier til, så testen ikke hviler på at opprettelsen gjorde administratoren til eier. */
async function addOwner(contentType: "COURSE" | "MODULE" | "SECTION", contentId: string) {
  await prisma.contentOwner.create({ data: { contentType, contentId, userId: await user("eier") } });
}

const owners = (contentType: "COURSE" | "MODULE" | "SECTION", contentId: string) => prisma.contentOwner.count({ where: { contentType, contentId } });

/** Alle radene som hører til modulen. */
async function moduleRows(moduleId: string) {
  const where = { moduleId };
  const [modules, versions, questions, sets, rubrics, prompts] = await Promise.all([
    prisma.module.count({ where: { id: moduleId } }),
    prisma.moduleVersion.count({ where }),
    prisma.mCQQuestion.count({ where }),
    prisma.mCQSetVersion.count({ where }),
    prisma.rubricVersion.count({ where }),
    prisma.promptTemplateVersion.count({ where }),
  ]);
  return { modules, versions, questions, sets, rubrics, prompts, owners: await owners("MODULE", moduleId) };
}

async function archivedModuleWithEverything(name: string) {
  const id = await apiModule(name);
  await ok(post(M(id, "/archive")), "arkiver modul");
  await addOwner("MODULE", id);
  return id;
}

/** En innlevering på modulen (deltakerhistorikk). */
async function addSubmission(moduleId: string) {
  const version = await prisma.moduleVersion.findFirstOrThrow({ where: { moduleId }, select: { id: true } });
  return prisma.submission.create({ data: { userId: await user("deltaker"), moduleId, moduleVersionId: version.id, deliveryType: "text" } });
}

/**
 * En sertifisering på modulen UTEN innlevering på den. Ingen rute lager det (et vedtak henger på en innlevering); tilstanden skrives
 * direkte, med vedtaket på en hjelpemodul, så vakta for sertifiseringer måles for seg og ikke bak vakta for innleveringer.
 */
async function addCertificationOnly(moduleId: string) {
  const helper = await apiModule("hjelpemodul for vedtak");
  const submission = await addSubmission(helper);
  const decision = await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id, moduleVersionId: submission.moduleVersionId, mcqScaledScore: 0, practicalScaledScore: 0, totalScore: 0,
      redFlagsJson: "[]", passFailTotal: true, decisionType: "AUTOMATIC", decisionReason: "test",
    },
  });
  await prisma.certificationStatus.create({ data: { userId: submission.userId, moduleId, latestDecisionId: decision.id, status: "ACTIVE" } });
}

/**
 * Et lagret utkast til et AKTIVT kurs som nevner elementet. Ingen rute lagrer et utkast med et arkivert element (`checkUsable`), og
 * et element i et utkast kan ikke arkiveres (#1150). Tilstanden skrives direkte, som i m2-archived-readonly-1151.
 */
async function draftNaming(item: Item, name = "kurs med utkast") {
  const course = await apiCourse(name, [{ type: "SECTION", sectionId: await apiSection("i kurset med utkastet") }], true);
  await prisma.courseDraft.create({ data: { courseId: course, payloadText: JSON.stringify({ items: [item] }), baseRevision: 0, source: "form" } });
  return course;
}

// ── 1. Modulen slettes med versjonene sine ──────────────────────────────────────────────────────────────────────────────────

describe("#1152: en arkivert modul uten deltakerhistorikk slettes med versjonene sine", () => {
  it("med versjon, flervalg, kriterier og ledetekst: slettet, og alle radene er borte, også eierradene", async () => {
    const id = await archivedModuleWithEverything("alt");
    const before = await moduleRows(id);
    expect(before).toMatchObject({ modules: 1, versions: 1, questions: 1, sets: 1, rubrics: 1, prompts: 1 });
    expect(before.owners).toBeGreaterThan(0);

    const deleted = await del(M(id));
    expect(deleted.status, show(deleted)).toBe(200);
    expect(deleted.body.deletedModule).toMatchObject({ id });
    expect(await moduleRows(id)).toEqual({ modules: 0, versions: 0, questions: 0, sets: 0, rubrics: 0, prompts: 0, owners: 0 });
  });

  it("KONTROLL: samme modul, ikke arkivert → delete_requires_archived, og ingenting er slettet", async () => {
    const id = await apiModule("ikke arkivert");
    const before = await moduleRows(id);
    const refused = await del(M(id));
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("delete_requires_archived");
    expect(await moduleRows(id)).toEqual(before);
  });

  it("med en innlevering → module_has_submissions med tallet, og ingenting er slettet", async () => {
    const id = await archivedModuleWithEverything("innlevering");
    await addSubmission(id);
    await addSubmission(id);
    const before = await moduleRows(id);
    const refused = await del(M(id));
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("module_has_submissions");
    expect(refused.body.details).toEqual({ count: 2 });
    expect(await moduleRows(id)).toEqual(before);
  });

  it("med en sertifisering (uten innlevering) → module_has_certification med tallet, og ingenting er slettet", async () => {
    const id = await archivedModuleWithEverything("sertifisering");
    await addCertificationOnly(id);
    const before = await moduleRows(id);
    const refused = await del(M(id));
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("module_has_certification");
    expect(refused.body.details).toEqual({ count: 1 });
    expect(await moduleRows(id)).toEqual(before);
  });

  it("i et arkivert kurs → content_in_archived_course (uendret)", async () => {
    const id = await apiModule("i arkivert kurs");
    const course = await apiCourse("arkivert med modulen", [{ type: "MODULE", moduleId: id }], true);
    await archiveCourse(course);
    expect((await prisma.module.findUniqueOrThrow({ where: { id }, select: { archivedAt: true } })).archivedAt, "modulen fulgte kurset").not.toBeNull();
    const refused = await del(M(id));
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("content_in_archived_course");
    expect(await prisma.module.count({ where: { id } })).toBe(1);
  });

  it("uten person bak (jobben i 4c): slettet, og revisjonsraden har ingen aktør", async () => {
    const id = await archivedModuleWithEverything("uten aktør");
    await deleteModule(id);
    expect((await moduleRows(id)).modules).toBe(0);
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: id, action: "module_deleted" }, select: { actorId: true } });
    expect(event.actorId).toBeNull();
  });
});

// ── 2. Et kursutkast teller som bruk ────────────────────────────────────────────────────────────────────────────────────────

describe("#1152: et lagret kursutkast holder elementet igjen fra sletting", () => {
  it("modul i utkastet til et annet kurs → delete_blocked_by_course_draft med kursets navn; forkastet utkast → slettet", async () => {
    const id = await archivedModuleWithEverything("i utkast");
    const course = await draftNaming({ type: "MODULE", moduleId: id }, "utkastkurs modul");
    const refused = await del(M(id));
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("delete_blocked_by_course_draft");
    expect(refused.body.details).toMatchObject({ count: 1 });
    expect(refused.body.details.draftCourseTitles[0]).toContain("utkastkurs modul");
    expect((await moduleRows(id)).modules).toBe(1);

    // Kontroll: uten utkastet går slettingen.
    await prisma.courseDraft.deleteMany({ where: { courseId: course } });
    expect((await del(M(id))).status).toBe(200);
    expect((await moduleRows(id)).modules).toBe(0);
  });

  it("seksjon i utkastet til et annet kurs → delete_blocked_by_course_draft; forkastet utkast → slettet", async () => {
    const id = await apiSection("i utkast");
    await ok(post(S(id, "/archive")), "arkiver seksjon");
    const course = await draftNaming({ type: "SECTION", sectionId: id }, "utkastkurs seksjon");
    const refused = await del(S(id));
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("delete_blocked_by_course_draft");
    expect(refused.body.details.draftCourseTitles[0]).toContain("utkastkurs seksjon");
    expect(await prisma.courseSection.count({ where: { id } })).toBe(1);

    await prisma.courseDraft.deleteMany({ where: { courseId: course } });
    expect((await del(S(id))).status).toBe(204);
    expect(await prisma.courseSection.count({ where: { id } })).toBe(0);
  });

  it("KONTROLL: utkastet til et ARKIVERT kurs teller ikke (kjent mangel fra 2.156–2.159, som ved arkivering)", async () => {
    const id = await archivedModuleWithEverything("i utkast til arkivert kurs");
    const course = await draftNaming({ type: "MODULE", moduleId: id }, "arkivert utkastkurs");
    await prisma.course.update({ where: { id: course }, data: { archivedAt: new Date(), publishedAt: null } });
    expect((await del(M(id))).status).toBe(200);
  });
});

// ── 3. Eierradene går med innholdet ─────────────────────────────────────────────────────────────────────────────────────────

describe("#1152: eierradene slettes med kurs, modul og seksjon", () => {
  it("seksjon: eierradene er borte etter slettingen", async () => {
    const id = await apiSection("eiere seksjon");
    await ok(post(S(id, "/archive")), "arkiver");
    await addOwner("SECTION", id);
    expect(await owners("SECTION", id)).toBeGreaterThan(0);
    expect((await del(S(id))).status).toBe(204);
    expect(await owners("SECTION", id)).toBe(0);
  });

  it("kurs: eierradene er borte etter slettingen", async () => {
    const id = await apiCourse("eiere kurs", [{ type: "SECTION", sectionId: await apiSection("i eierkurs") }], false);
    await archiveCourse(id);
    await addOwner("COURSE", id);
    expect(await owners("COURSE", id)).toBeGreaterThan(0);
    expect((await del(K(id))).status).toBe(204);
    expect(await owners("COURSE", id)).toBe(0);
  });

  it("kaskaden: kursets, modulens og seksjonens eierrader er borte; det delte elementet beholder sine", async () => {
    const module = await apiModule("kaskade modul");
    const section = await apiSection("kaskade seksjon");
    const shared = await apiSection("kaskade delt");
    const course = await apiCourse("kaskade", [{ type: "MODULE", moduleId: module }, { type: "SECTION", sectionId: section }, { type: "SECTION", sectionId: shared }], true);
    await apiCourse("bruker den delte", [{ type: "SECTION", sectionId: shared }], false);
    await archiveCourse(course);
    for (const [type, id] of [["COURSE", course], ["MODULE", module], ["SECTION", section], ["SECTION", shared]] as const) await addOwner(type, id);

    await ok(post(K(course, "/cascade-delete"), { expectedDeletedModuleIds: [module], expectedDeletedSectionIds: [section] }), "kaskade");
    expect(await owners("COURSE", course)).toBe(0);
    expect(await owners("MODULE", module)).toBe(0);
    expect(await owners("SECTION", section)).toBe(0);
    // Kontroll: den delte seksjonen står, med eierne sine.
    expect(await prisma.courseSection.count({ where: { id: shared } })).toBe(1);
    expect(await owners("SECTION", shared)).toBeGreaterThan(0);
  });
});

// ── 4. Masseryddingen av upubliserte moduler ────────────────────────────────────────────────────────────────────────────────

describe("#1152: masseryddingen hopper over en modul i et kursutkast, og rydder eierradene", () => {
  async function unpublishedModule(name: string) {
    const created = await ok(post(`${C}/modules`, { title: L(tag(name)), description: L("B"), certificationLevel: "basic" }), "modul");
    const id = created.module.id as string;
    await addOwner("MODULE", id);
    return { id, title: created.module.title as string };
  }

  it("forhåndsvisningen og slettingen er enige: modulen i utkastet står; en vanlig upublisert modul ryddes (kontroll)", async () => {
    const inDraft = await unpublishedModule("upublisert i utkast");
    const plain = await unpublishedModule("upublisert vanlig");
    await draftNaming({ type: "MODULE", moduleId: inDraft.id }, "utkastkurs rydding");

    // Bare forhåndsvisningen gjennom ruta: selve ryddingen tar alle upubliserte moduler i testdatabasen. Slettingen prøves per modul.
    const preview = await ok(get(`${C}/modules/purge-unpublished/preview`), "forhåndsvisning");
    type Candidate = { id: string; courseDrafts: number; reasonSkipped: string | null };
    const candidates = preview.candidates as Candidate[];
    expect(candidates.find((c) => c.id === inDraft.id)).toMatchObject({ courseDrafts: 1 });
    expect(candidates.find((c) => c.id === inDraft.id)?.reasonSkipped).toContain("saved draft of 1 course(s)");
    expect(candidates.find((c) => c.id === plain.id)).toMatchObject({ courseDrafts: 0, reasonSkipped: null });

    // Slettingen under låsen sier det samme, også når kalleren ikke har sett forhåndsvisningen.
    const actor = await user("rydder");
    expect(await purgeUnpublishedModule(inDraft, actor)).toBe(false);
    expect(await prisma.module.count({ where: { id: inDraft.id } })).toBe(1);
    expect(await owners("MODULE", inDraft.id)).toBeGreaterThan(0);

    expect(await purgeUnpublishedModule(plain, actor)).toBe(true);
    expect(await prisma.module.count({ where: { id: plain.id } })).toBe(0);
    expect(await owners("MODULE", plain.id)).toBe(0);
  });
});

describe("#1152 (QA-porten 4a): masseryddingen sletter bare modulene forhåndsvisningen viste", () => {
  async function unpublished(name: string) {
    const created = await ok(post(`${C}/modules`, { title: L(tag(name)), description: L("B"), certificationLevel: "basic" }), "modul");
    return created.module.id as string;
  }
  const PURGE = `${C}/modules/purge-unpublished`;

  it("en modul laget etter forhåndsvisningen slettes ikke; de som ble vist, slettes (kontroll)", async () => {
    const a = await unpublished("vist a");
    const b = await unpublished("vist b");
    const preview = await ok(get(`${PURGE}/preview`), "forhåndsvisning");
    const shown = (preview.candidates as Array<{ id: string; reasonSkipped: string | null }>).filter((c) => [a, b].includes(c.id));
    expect(shown.map((c) => c.reasonSkipped)).toEqual([null, null]);
    // Laget mens dialogen sto åpen.
    const late = await unpublished("laget etterpå");

    const result = await ok(post(PURGE, { confirmation: "SLETT", expectedModuleIds: [a, b] }), "rydding");
    expect((result.deleted as Array<{ id: string }>).map((d) => d.id).sort()).toEqual([a, b].sort());
    expect(await prisma.module.count({ where: { id: { in: [a, b] } } })).toBe(0);
    expect(await prisma.module.count({ where: { id: late } })).toBe(1);
    expect((result.skipped as Array<{ id: string; reason: string }>).find((s) => s.id === late)?.reason).toBe("not in the list that was confirmed");
  });

  it("uten lista (en fane fra før): 409 purge_confirmation_outdated, og ingenting er slettet", async () => {
    const id = await unpublished("gammel fane");
    const refused = await post(PURGE, { confirmation: "SLETT" });
    expect(refused.status, show(refused)).toBe(409);
    expect(refused.body.error).toBe("purge_confirmation_outdated");
    expect(await prisma.module.count({ where: { id } })).toBe(1);
  });
});

// ── 5. Ingenting med deltakerhistorikk forsvinner ───────────────────────────────────────────────────────────────────────────

describe("#1152: slettingene rører ikke innleveringer, sertifiseringer og kursbevis", () => {
  it("tallene er like før og etter en runde med slettinger og avslag", async () => {
    // Fiksturene først (de lager selv innleveringer og sertifiseringer), så tellingen.
    const clean = await archivedModuleWithEverything("telling ren");
    const withSubmission = await archivedModuleWithEverything("telling innlevering");
    await addSubmission(withSubmission);
    const withCertification = await archivedModuleWithEverything("telling sertifisering");
    await addCertificationOnly(withCertification);
    const section = await apiSection("telling seksjon");
    await ok(post(S(section, "/archive")), "arkiver seksjon");
    const course = await apiCourse("telling kurs", [{ type: "SECTION", sectionId: await apiSection("i tellingskurs") }], false);
    await archiveCourse(course);

    const count = async () => ({
      submissions: await prisma.submission.count(),
      certifications: await prisma.certificationStatus.count(),
      completions: await prisma.courseCompletion.count(),
    });
    const before = await count();

    expect((await del(M(clean))).status).toBe(200);
    expect((await del(M(withSubmission))).body.error).toBe("module_has_submissions");
    expect((await del(M(withCertification))).body.error).toBe("module_has_certification");
    expect((await del(S(section))).status).toBe(204);
    expect((await del(K(course))).status).toBe(204);

    expect(await count()).toEqual(before);
    expect(await prisma.module.count({ where: { id: { in: [withSubmission, withCertification] } } })).toBe(2);
  });
});
