import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { setCourseItems, updateCourse } from "../src/modules/course/index.js";

// #1140 etappe 2, skive 2a (doc/design/PLAN_1140_E2.md): utkastet til et publisert kurs.
//   - Utkast for kurs er alltid på: det finnes ingen bryter (produkteier 2026-11-12).
//   - «Lagre» på et publisert kurs går til utkastet (`PUT …/draft`), og ingenting deltakerne ser, endres.
//   - Med utkast er den publiserte utgaven låst for alt annet som skriver felt eller liste (`409 course_has_draft`).
//   - Uten utkast lagres et publisert kurs direkte som før.
// Testene går gjennom rutene (supertest), med de feltene klienten sender.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
// En ny administrator per test: fila sender flere enn 120 kall, og grensen for kall per bruker per minutt (`generalApiLimiter`)
// ville ellers gitt 429 i de siste testene.
const ADMIN: Record<string, string> = {
  "x-user-id": "draft-e2-admin",
  "x-user-email": "draft.e2.admin@x.test",
  "x-user-name": "Admin",
  "x-user-roles": "ADMINISTRATOR",
  "x-locale": "nb",
};
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `draft-e2-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `draft.e2.admin.${RUN}.${adminSeq}@x.test`;
});
const smo = (name: string) => ({
  "x-user-id": `draft-e2-${name}-${RUN}`,
  "x-user-email": `draft.e2.${name}.${RUN}@x.test`,
  "x-user-name": name,
  "x-user-roles": "SUBJECT_MATTER_OWNER",
  "x-locale": "nb",
});

let seq = 0;
const tag = (name: string) => `e2 ${name} ${RUN}-${seq++}`;
const base = (courseId: string) => `/api/admin/content/courses/${courseId}`;

afterAll(async () => {
  await prisma.$disconnect();
});

async function createPublishedModule(title: string) {
  const source = await prisma.moduleVersion.findFirst({
    where: { module: { activeVersionId: { not: null } } },
    select: { rubricVersionId: true, promptTemplateVersionId: true, mcqSetVersionId: true },
    orderBy: { createdAt: "asc" },
  });
  expect(source).toBeTruthy();
  const module = await prisma.module.create({ data: { title: JSON.stringify(L(title)) }, select: { id: true } });
  const moduleVersion = await prisma.moduleVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
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
  return module.id;
}

async function createPublishedSection(title: string) {
  const section = await prisma.courseSection.create({ data: { title: JSON.stringify(L(title)) }, select: { id: true } });
  const v1 = await prisma.courseSectionVersion.create({
    data: { sectionId: section.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Tekst.")), publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: v1.id } });
  return section.id;
}

/** Et publisert kurs med en modul og en seksjon, og en beskrivelse (så «utelatt felt = som publisert» kan ses). */
async function publishedCourse(name: string) {
  const moduleTitle = tag(`${name} modul`);
  const sectionTitle = tag(`${name} seksjon`);
  const title = tag(name);
  const moduleId = await createPublishedModule(moduleTitle);
  const sectionId = await createPublishedSection(sectionTitle);
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify(L(title)),
      description: JSON.stringify(L(`${title} beskrivelse`)),
      certificationLevel: "basic",
      publishedAt: new Date(),
      slug: `draft-e2-${RUN}-${seq++}`,
      items: {
        create: [
          { itemType: "MODULE", moduleId, sortOrder: 0 },
          { itemType: "SECTION", sectionId, sortOrder: 1 },
        ],
      },
    },
    select: { id: true },
  });
  return { courseId: course.id, moduleId, sectionId, title, moduleTitle, sectionTitle };
}

type Lifecycle = "draft" | "published" | "published_with_draft" | "archived";
type Detail = { title: string; contentRevision: number; versionMajor: number; versionMinor: number; hasDraft: boolean; lifecycle: Lifecycle };

async function detail(courseId: string) {
  const response = await request(app).get(base(courseId)).set(ADMIN);
  expect(response.status).toBe(200);
  return response.body.course as Detail;
}

/** Det deltakerne ser, bygger på: feltene, lista og tellerne. Brukes til «ingenting er endret». */
async function publishedState(courseId: string) {
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  const rows = await prisma.courseItem.findMany({ where: { courseId }, orderBy: { sortOrder: "asc" }, select: { moduleId: true, sectionId: true } });
  return {
    title: course.title,
    description: course.description,
    sortOrder: course.sortOrder,
    enrollmentPolicy: course.enrollmentPolicy,
    contentRevision: course.contentRevision,
    version: `${course.versionMajor}.${course.versionMinor}`,
    items: rows.map((row) => row.moduleId ?? row.sectionId),
  };
}

const draftRow = (courseId: string) => prisma.courseDraft.findUnique({ where: { courseId } });

/** Forkaster utkastet slik en fane som nettopp lastet det, gjør: med utkastets id og teller. Uten utkast: verdier som ikke finnes. */
async function discard(courseId: string, headers: Record<string, string> = ADMIN, loaded?: { draftId: string; revision: number }) {
  const row = loaded ? null : await draftRow(courseId);
  const sent = loaded ?? { draftId: row?.id ?? "ingen", revision: row?.revision ?? 1 };
  return request(app).delete(`${base(courseId)}/draft`).query(sent).set(headers);
}

/** Publiserer utkastet slik en fane som nettopp lastet det, gjør. */
async function publishDraft(courseId: string, body: Record<string, unknown> = {}, headers: Record<string, string> = ADMIN) {
  const row = await draftRow(courseId);
  return request(app).post(`${base(courseId)}/draft/publish`).set(headers).send({ loaded: { draftId: row?.id ?? "ingen", revision: row?.revision ?? 1 }, ...body });
}

/** Lagrer et utkast slik skjemaet gjør når det ikke så noe utkast. */
async function saveFirstDraft(courseId: string, body: Record<string, unknown>, headers: Record<string, string> = ADMIN) {
  const loaded = (await detail(courseId)).contentRevision;
  return request(app).put(`${base(courseId)}/draft`).set(headers).send({ ...body, loaded: { expectedRevision: loaded } });
}

describe("#1140 etappe 2: lagre, hente og forkaste utkastet", () => {
  it("første lagring lager utkastet, og ingenting i den publiserte utgaven er endret", async () => {
    const c = await publishedCourse("lagre");
    const extra = await createPublishedModule(tag("lagre ekstra"));
    const before = await publishedState(c.courseId);
    expect(await detail(c.courseId)).toMatchObject({ hasDraft: false, lifecycle: "published" });

    const nyttNavn = L(tag("navn i utkastet"));
    const saved = await saveFirstDraft(c.courseId, {
      title: nyttNavn,
      sortOrder: 7,
      enrollmentPolicy: "RESTRICTED",
      items: [{ type: "SECTION", sectionId: c.sectionId }, { type: "MODULE", moduleId: extra, discussionsEnabled: false }],
    });
    expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
    expect(saved.body.draft).toMatchObject({ revision: 1, source: "form" });
    // Telleren utkastet ble laget på, står i raden (ikke lenger i svaret).
    expect((await draftRow(c.courseId))?.baseRevision).toBe(before.contentRevision);

    expect(await publishedState(c.courseId)).toEqual(before);
    expect(await detail(c.courseId)).toMatchObject({ hasDraft: true, lifecycle: "published_with_draft" });

    const audits = await prisma.auditEvent.findMany({ where: { entityId: c.courseId, action: "course_draft_saved" } });
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0].metadataJson ?? "{}")).toMatchObject({ created: true, revision: 1 });
  });

  it("`GET …/draft` gir utkastet flettet med den publiserte utgaven: utelatte felt er «som publisert», og elementene har titler", async () => {
    const c = await publishedCourse("hente");
    const nyttNavn = L(tag("hentet navn"));
    await saveFirstDraft(c.courseId, { title: nyttNavn, sortOrder: 4, items: [{ type: "SECTION", sectionId: c.sectionId }, { type: "MODULE", moduleId: c.moduleId, discussionsEnabled: false }] });
    const published = await prisma.course.findUniqueOrThrow({ where: { id: c.courseId } });

    const got = await request(app).get(`${base(c.courseId)}/draft`).set(ADMIN);
    expect(got.status).toBe(200);
    const draft = got.body.draft;
    expect(JSON.parse(draft.course.title)).toEqual(nyttNavn);
    expect(draft.course.sortOrder).toBe(4);
    // Ikke sendt: som publisert.
    expect(draft.course.description).toBe(published.description);
    expect(draft.course.enrollmentPolicy).toBe(published.enrollmentPolicy);
    expect(draft.course.discussionsEnabled).toBe(published.discussionsEnabled);
    expect(draft.course.themeIds).toEqual([]);
    expect(draft.items).toEqual([
      { type: "SECTION", sortOrder: 0, moduleId: null, sectionId: c.sectionId, title: JSON.stringify(L(c.sectionTitle)), discussionsEnabled: true, archivedAt: null, unpublished: false, missing: false },
      { type: "MODULE", sortOrder: 1, moduleId: c.moduleId, sectionId: null, title: JSON.stringify(L(c.moduleTitle)), discussionsEnabled: false, archivedAt: null, unpublished: false, missing: false },
    ]);
    expect(draft.updatedAt).toEqual(expect.any(String));
  });

  it("`GET …/draft` merker et element som er arkivert eller slettet etter at utkastet ble lagret", async () => {
    const c = await publishedCourse("arkivert-etterpå");
    const extra = await createPublishedModule(tag("arkiveres etterpå"));
    const doomed = await prisma.courseSection.create({ data: { title: JSON.stringify(L(tag("slettes etterpå"))) }, select: { id: true } });
    const saved = await saveFirstDraft(c.courseId, { items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "MODULE", moduleId: extra }, { type: "SECTION", sectionId: doomed.id }] });
    expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
    // De to står bare i utkastet, så ingenting hindrer at de arkiveres eller slettes (kjent mangel, PLAN_1140_E2.md).
    await prisma.module.update({ where: { id: extra }, data: { archivedAt: new Date() } });
    await prisma.courseSection.delete({ where: { id: doomed.id } });
    const got = await request(app).get(`${base(c.courseId)}/draft`).set(ADMIN);
    expect(got.status).toBe(200);
    expect(got.body.draft.items[0]).toMatchObject({ archivedAt: null, missing: false });
    expect(got.body.draft.items[1]).toMatchObject({ archivedAt: expect.any(String), missing: false });
    expect(got.body.draft.items[2]).toMatchObject({ sectionId: doomed.id, title: null, archivedAt: null, missing: true });
  });

  it("neste lagring krever utkastets id og teller; en utdatert teller gir 409 og ingenting er lagret", async () => {
    const c = await publishedCourse("teller");
    const first = await saveFirstDraft(c.courseId, { title: L("første"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    const { id, revision } = first.body.draft;

    const second = await request(app).put(`${base(c.courseId)}/draft`).set(ADMIN).send({
      title: L("andre"), items: [{ type: "MODULE", moduleId: c.moduleId }], loaded: { draftId: id, revision },
    });
    expect(second.status, JSON.stringify(second.body).slice(0, 300)).toBe(200);
    expect(second.body.draft).toMatchObject({ id, revision: 2 });

    // En fane som lastet utkastet før «andre» ble lagret.
    const stale = await request(app).put(`${base(c.courseId)}/draft`).set(ADMIN).send({
      title: L("fra gammel fane"), items: [{ type: "MODULE", moduleId: c.moduleId }], loaded: { draftId: id, revision },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("course_draft_changed");
    const row = await draftRow(c.courseId);
    expect(row?.revision).toBe(2);
    expect(JSON.parse(row!.payloadText).title.nb).toBe("andre");

    const audits = await prisma.auditEvent.findMany({ where: { entityId: c.courseId, action: "course_draft_saved" }, orderBy: { chainSeq: "asc" } });
    expect(audits.map((a) => JSON.parse(a.metadataJson ?? "{}").created)).toEqual([true, false]);
  });

  it("en fane som ikke så noe utkast, skriver ikke over et utkast noen andre har laget", async () => {
    const c = await publishedCourse("ikke-sett");
    const loaded = (await detail(c.courseId)).contentRevision;
    expect((await saveFirstDraft(c.courseId, { title: L("fra A"), items: [{ type: "MODULE", moduleId: c.moduleId }] })).status).toBe(200);
    const b = await request(app).put(`${base(c.courseId)}/draft`).set(ADMIN).send({
      title: L("fra B"), items: [{ type: "SECTION", sectionId: c.sectionId }], loaded: { expectedRevision: loaded },
    });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe("course_draft_changed");
    expect(JSON.parse((await draftRow(c.courseId))!.payloadText).title.nb).toBe("fra A");
  });

  it("et utkast som er forkastet og laget på nytt, er et annet utkast: den gamle id-en gir 409", async () => {
    const c = await publishedCourse("ny-rad");
    const first = await saveFirstDraft(c.courseId, { title: L("første rad"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    expect((await discard(c.courseId)).status).toBe(204);
    const again = await saveFirstDraft(c.courseId, { title: L("andre rad"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    expect(again.body.draft.revision).toBe(1);
    expect(again.body.draft.id).not.toBe(first.body.draft.id);

    // Fana som så den første raden, med samme teller (1) som den nye har.
    const stale = await request(app).put(`${base(c.courseId)}/draft`).set(ADMIN).send({
      title: L("fra fana med første rad"), items: [{ type: "MODULE", moduleId: c.moduleId }], loaded: { draftId: first.body.draft.id, revision: 1 },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("course_draft_changed");
    expect(JSON.parse((await draftRow(c.courseId))!.payloadText).title.nb).toBe("andre rad");
  });

  it("uten utkast og med en teller kurset ikke har lenger: 409 course_changed, og ingen rad", async () => {
    const c = await publishedCourse("gammel-teller");
    await prisma.course.update({ where: { id: c.courseId }, data: { contentRevision: 5 } });
    const saved = await request(app).put(`${base(c.courseId)}/draft`).set(ADMIN).send({
      title: L("på gammelt grunnlag"), items: [{ type: "MODULE", moduleId: c.moduleId }], loaded: { expectedRevision: 4 },
    });
    expect(saved.status).toBe(409);
    expect(saved.body.error).toBe("course_changed");
    expect(await draftRow(c.courseId)).toBeNull();
    // Kontroll: med riktig teller går den samme lagringen gjennom, og utkastet husker telleren skjemaet lastet.
    const ok = await request(app).put(`${base(c.courseId)}/draft`).set(ADMIN).send({
      title: L("på riktig grunnlag"), items: [{ type: "MODULE", moduleId: c.moduleId }], loaded: { expectedRevision: 5 },
    });
    expect(ok.status).toBe(200);
    expect((await draftRow(c.courseId))?.baseRevision).toBe(5);
  });

  it("to samtidige første lagringer: én lager utkastet, den andre får 409 — ingen 500", async () => {
    const c = await publishedCourse("samtidig");
    const loaded = (await detail(c.courseId)).contentRevision;
    const send = (n: number) => request(app).put(`${base(c.courseId)}/draft`).set(ADMIN).send({
      title: L(`samtidig ${n}`), items: [{ type: "MODULE", moduleId: c.moduleId }], loaded: { expectedRevision: loaded },
    });
    const answers = await Promise.all([1, 2, 3].map(send));
    expect(answers.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    for (const lost of answers.filter((r) => r.status === 409)) expect(lost.body.error).toBe("course_draft_changed");
    const winner = answers.findIndex((r) => r.status === 200) + 1;
    expect(JSON.parse((await draftRow(c.courseId))!.payloadText).title.nb).toBe(`samtidig ${winner}`);
  });

  it("bare et publisert kurs har utkast: et kurs som ikke er ute, lagres direkte som før", async () => {
    const c = await publishedCourse("ikke-ute");
    await prisma.course.update({ where: { id: c.courseId }, data: { publishedAt: null } });
    const saved = await saveFirstDraft(c.courseId, { title: L("utkast til upublisert"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    expect(saved.status).toBe(409);
    expect(saved.body.error).toBe("course_draft_requires_published");
    expect(await draftRow(c.courseId)).toBeNull();
    // Kontroll: direkte lagring av det upubliserte kurset virker.
    const nyttNavn = L(tag("direkte på upublisert"));
    const direct = await request(app).put(`${base(c.courseId)}/content`).set(ADMIN).send({
      title: nyttNavn, items: [{ type: "MODULE", moduleId: c.moduleId }], expectedRevision: (await detail(c.courseId)).contentRevision,
    });
    expect(direct.status, JSON.stringify(direct.body).slice(0, 300)).toBe(200);
    expect(JSON.parse((await publishedState(c.courseId)).title)).toEqual(nyttNavn);
  });

  it("lista sjekkes ved lagring av utkastet: dobbel, arkivert og ukjent avvises, og ingen rad lages", async () => {
    const c = await publishedCourse("sjekk");
    const archived = await createPublishedModule(tag("arkivert"));
    await prisma.module.update({ where: { id: archived }, data: { archivedAt: new Date() } });

    const duplicate = await saveFirstDraft(c.courseId, { items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "MODULE", moduleId: c.moduleId }] });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error).toBe("course_duplicate_item");
    const withArchived = await saveFirstDraft(c.courseId, { items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "MODULE", moduleId: archived }] });
    expect(withArchived.status).toBe(400);
    expect(withArchived.body.error).toBe("course_item_archived");
    const unknown = await saveFirstDraft(c.courseId, { items: [{ type: "SECTION", sectionId: "finnes-ikke" }] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe("course_item_not_found");
    expect(await draftRow(c.courseId)).toBeNull();
  });

  it("kroppen valideres som `PUT …/content`, og `loaded` er påkrevd", async () => {
    const c = await publishedCourse("validering");
    const noLoaded = await request(app).put(`${base(c.courseId)}/draft`).set(ADMIN).send({ items: [{ type: "MODULE", moduleId: c.moduleId }] });
    expect(noLoaded.status).toBe(400);
    expect(noLoaded.body.error).toBe("validation_error");
    const noItems = await request(app).put(`${base(c.courseId)}/draft`).set(ADMIN).send({ title: L("uten liste"), loaded: { expectedRevision: 0 } });
    expect(noItems.status).toBe(400);
    const both = await request(app).put(`${base(c.courseId)}/draft`).set(ADMIN).send({
      items: [{ type: "MODULE", moduleId: c.moduleId }], loaded: { expectedRevision: 0, draftId: "x", revision: 1 },
    });
    expect(both.status).toBe(400);
    const badPolicy = await saveFirstDraft(c.courseId, { enrollmentPolicy: "ALLE", items: [{ type: "MODULE", moduleId: c.moduleId }] });
    expect(badPolicy.status).toBe(400);
    expect(await draftRow(c.courseId)).toBeNull();
  });

  it("forkast fjerner utkastet og sporer det; uten utkast svarer hente 404, og forkast 409 (fana viser noe som er borte)", async () => {
    const c = await publishedCourse("forkast");
    expect((await request(app).get(`${base(c.courseId)}/draft`).set(ADMIN)).status).toBe(404);
    const noDraft = await discard(c.courseId);
    expect([noDraft.status, noDraft.body.error]).toEqual([409, "course_draft_changed"]);

    const before = await publishedState(c.courseId);
    await saveFirstDraft(c.courseId, { title: L("forkastes"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    const gone = await discard(c.courseId);
    expect(gone.status).toBe(204);
    expect(await draftRow(c.courseId)).toBeNull();
    expect(await publishedState(c.courseId)).toEqual(before);
    expect(await detail(c.courseId)).toMatchObject({ hasDraft: false, lifecycle: "published" });
    expect(await prisma.auditEvent.count({ where: { entityId: c.courseId, action: "course_draft_discarded" } })).toBe(1);
    const missing = await request(app).get(`${base(c.courseId)}/draft`).set(ADMIN);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("course_draft_not_found");
  });

  it("utkastet følger kurset: avpublisert kurs kan fortsatt forkaste det, og et slettet kurs tar utkastet med seg", async () => {
    const c = await publishedCourse("følger");
    await saveFirstDraft(c.courseId, { title: L("blir stående"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    const unpublished = await request(app).post(`${base(c.courseId)}/unpublish`).set(ADMIN);
    expect(unpublished.status, JSON.stringify(unpublished.body).slice(0, 300)).toBe(200);
    expect((await request(app).get(`${base(c.courseId)}/draft`).set(ADMIN)).status).toBe(200);
    expect((await discard(c.courseId)).status).toBe(204);

    const d = await publishedCourse("slettes");
    await saveFirstDraft(d.courseId, { title: L("slettes med kurset"), items: [{ type: "MODULE", moduleId: d.moduleId }] });
    await prisma.course.delete({ where: { id: d.courseId } });
    expect(await draftRow(d.courseId)).toBeNull();
  });

  it("et avpublisert kurs med en utkastrad liggende igjen: kursdetaljen sier «draft» og `hasDraft: true`", async () => {
    const c = await publishedCourse("avpublisert-detalj");
    expect((await saveFirstDraft(c.courseId, { title: L("ligger igjen"), items: [{ type: "MODULE", moduleId: c.moduleId }] })).status).toBe(200);
    expect(await detail(c.courseId)).toMatchObject({ hasDraft: true, lifecycle: "published_with_draft" });
    expect((await request(app).post(`${base(c.courseId)}/unpublish`).set(ADMIN)).status).toBe(200);
    expect(await draftRow(c.courseId)).not.toBeNull();
    expect(await detail(c.courseId)).toMatchObject({ hasDraft: true, lifecycle: "draft" });
    // Kontroll: uten raden er det samme kurset «draft» uten utkast.
    expect((await discard(c.courseId)).status).toBe(204);
    expect(await detail(c.courseId)).toMatchObject({ hasDraft: false, lifecycle: "draft" });
  });

  it("`updatedByName` er navnet til den som lagret utkastet sist, i svaret på lagringen og på hentingen", async () => {
    const owner = smo("lagrer");
    const moduleId = await createPublishedModule(tag("navn modul"));
    const created = await request(app).post("/api/admin/content/courses").set(owner).send({ title: L(tag("navn")), certificationLevel: L("basic") });
    expect(created.status).toBe(201);
    const courseId = created.body.course.id as string;
    await prisma.courseItem.create({ data: { courseId, itemType: "MODULE", moduleId, sortOrder: 0 } });
    await prisma.course.update({ where: { id: courseId }, data: { publishedAt: new Date() } });

    const saved = await request(app).put(`${base(courseId)}/draft`).set(owner).send({ title: L("fra lagrer"), items: [{ type: "MODULE", moduleId }], loaded: { expectedRevision: 0 } });
    expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
    expect(saved.body.draft.updatedByName).toBe(owner["x-user-name"]);
    // Hentet av en annen (administratoren): navnet er lagrerens, ikke leserens.
    const got = await request(app).get(`${base(courseId)}/draft`).set(ADMIN);
    expect(got.status).toBe(200);
    expect(got.body.draft.updatedByName).toBe("lagrer");
    expect(got.body.draft.updatedById).toBe((await draftRow(courseId))?.updatedById);

    // Administratoren lagrer videre: navnet følger den som lagret sist.
    const next = await request(app).put(`${base(courseId)}/draft`).set(ADMIN).send({ title: L("fra admin"), items: [{ type: "MODULE", moduleId }], loaded: { draftId: saved.body.draft.id, revision: saved.body.draft.revision } });
    expect(next.status, JSON.stringify(next.body).slice(0, 300)).toBe(200);
    expect((await request(app).get(`${base(courseId)}/draft`).set(ADMIN)).body.draft.updatedByName).toBe(ADMIN["x-user-name"]);
  });

  it("kurslista viser «published_with_draft» for et publisert kurs med utkast, og «published» for et uten", async () => {
    const withDraft = await publishedCourse("liste-med-utkast");
    const without = await publishedCourse("liste-uten-utkast");
    expect((await saveFirstDraft(withDraft.courseId, { title: L("i lista"), items: [{ type: "MODULE", moduleId: withDraft.moduleId }] })).status).toBe(200);

    const lifecycles = async () => {
      const list = await request(app).get("/api/admin/content/courses").set(ADMIN);
      expect(list.status).toBe(200);
      const rows = list.body.courses as Array<{ id: string; lifecycle: Lifecycle }>;
      return [withDraft.courseId, without.courseId].map((id) => rows.find((row) => row.id === id)?.lifecycle);
    };
    expect(await lifecycles()).toEqual(["published_with_draft", "published"]);
    // Kontroll: det er utkastet som gir merket. Forkastet, står begge som «published».
    expect((await discard(withDraft.courseId)).status).toBe(204);
    expect(await lifecycles()).toEqual(["published", "published"]);
  });
});

describe("#1140 etappe 2: deltakerne ser den publiserte utgaven mens utkastet finnes", () => {
  it("kurset i «Mine kurs» og kursdetaljen har navnet og innholdet fra den publiserte utgaven", async () => {
    const c = await publishedCourse("deltaker");
    const extra = await createPublishedModule(tag("bare i utkastet"));
    const draftTitle = tag("navn bare i utkastet");
    expect((await saveFirstDraft(c.courseId, { title: L(draftTitle), items: [{ type: "MODULE", moduleId: extra }] })).status).toBe(200);

    const participant = {
      "x-user-id": `draft-e2-p-${RUN}`,
      "x-user-email": `draft.e2.p.${RUN}@x.test`,
      "x-user-name": "Deltaker",
      "x-user-department": "Learning",
      "x-user-roles": "PARTICIPANT",
      "x-locale": "nb",
    };
    const one = await request(app).get(`/api/courses/${c.courseId}`).set(participant);
    expect(one.status).toBe(200);
    const text = JSON.stringify(one.body);
    expect(text).toContain(c.title);
    expect(text).not.toContain(draftTitle);
    const ids = (one.body.course.items as Array<{ moduleId?: string | null; sectionId?: string | null }>).map((i) => i.moduleId ?? i.sectionId);
    expect(ids).toEqual([c.moduleId, c.sectionId]);

    const list = await request(app).get("/api/courses").set(participant);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(draftTitle);
  });
});

describe("#1140 etappe 2: låsen — med utkast skriver ingenting annet i den publiserte utgaven", () => {
  /**
   * De fire rutene som lagrer kursets felt eller liste direkte. Hver sender noe som ville ENDRET den publiserte utgaven
   * (kurset starter som [modul, seksjon]), så «gikk gjennom» og «ingenting skrevet» kan skilles på det som står lagret.
   * `PUT …/modules` beholder seksjonene og legger dem etter modulene.
   */
  function directSaves(c: { courseId: string; moduleId: string; sectionId: string }, extra: string, title: Record<string, string>) {
    const send = (path: string, body: Record<string, unknown>) => async () =>
      request(app).put(`${base(c.courseId)}${path}`).set(ADMIN).send({ ...body, expectedRevision: (await publishedState(c.courseId)).contentRevision });
    return {
      content: send("/content", { title, items: [{ type: "SECTION", sectionId: c.sectionId }, { type: "MODULE", moduleId: c.moduleId }] }),
      fields: send("", { sortOrder: 3 }),
      items: send("/items", { items: [{ type: "MODULE", moduleId: c.moduleId }] }),
      modules: send("/modules", { modules: [{ moduleId: extra, sortOrder: 0 }, { moduleId: c.moduleId, sortOrder: 1 }] }),
    };
  }

  it("UTEN utkast lagres et publisert kurs direkte som før, gjennom alle fire rutene", async () => {
    const c = await publishedCourse("direkte");
    const extra = await createPublishedModule(tag("direkte ekstra"));
    const nyttNavn = L(tag("lagret direkte"));
    const saves = directSaves(c, extra, nyttNavn);
    const start = await publishedState(c.courseId);
    expect(start.items).toEqual([c.moduleId, c.sectionId]);
    expect(start.sortOrder).not.toBe(3);

    const content = await saves.content();
    expect(content.status, JSON.stringify(content.body).slice(0, 300)).toBe(200);
    const afterContent = await publishedState(c.courseId);
    expect(JSON.parse(afterContent.title)).toEqual(nyttNavn);
    expect(afterContent.items).toEqual([c.sectionId, c.moduleId]);

    const fields = await saves.fields();
    expect(fields.status, JSON.stringify(fields.body).slice(0, 300)).toBe(200);
    expect((await publishedState(c.courseId)).sortOrder).toBe(3);

    const items = await saves.items();
    expect(items.status, JSON.stringify(items.body).slice(0, 300)).toBe(204);
    expect((await publishedState(c.courseId)).items).toEqual([c.moduleId]);

    const modules = await saves.modules();
    expect(modules.status, JSON.stringify(modules.body).slice(0, 300)).toBe(204);
    const end = await publishedState(c.courseId);
    expect(end.items).toEqual([extra, c.moduleId]);
    // Hver lagring økte telleren, og ingen av dem laget et utkast.
    expect(end.contentRevision).toBe(start.contentRevision + 4);
    expect(await draftRow(c.courseId)).toBeNull();
    expect(await detail(c.courseId)).toMatchObject({ hasDraft: false, lifecycle: "published" });
  });

  it("MED utkast gir de samme fire rutene 409 course_has_draft, og ingenting i den publiserte utgaven er endret", async () => {
    const c = await publishedCourse("direkte-med-utkast");
    const extra = await createPublishedModule(tag("direkte ekstra"));
    const saves = directSaves(c, extra, L(tag("forbi låsen")));
    expect((await saveFirstDraft(c.courseId, { title: L("låser"), items: [{ type: "MODULE", moduleId: c.moduleId }] })).status).toBe(200);
    const before = await publishedState(c.courseId);
    expect(before.items).toEqual([c.moduleId, c.sectionId]);

    for (const [name, save] of Object.entries(saves)) {
      const answer = await save();
      expect([answer.status, answer.body.error], name).toEqual([409, "course_has_draft"]);
      expect(await publishedState(c.courseId), name).toEqual(before);
    }
    expect((await draftRow(c.courseId))?.revision).toBe(1);
  });

  it("tjenestene som skriver felt og liste, avviser et kurs med utkast (`course_has_draft`), og virker igjen når utkastet er forkastet", async () => {
    const c = await publishedCourse("tjeneste");
    await saveFirstDraft(c.courseId, { title: L("låser"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    const before = await publishedState(c.courseId);
    const list = [{ type: "MODULE" as const, moduleId: c.moduleId }];

    await expect(updateCourse(c.courseId, { sortOrder: 9 }, undefined, { expectedRevision: before.contentRevision })).rejects.toMatchObject({ code: "course_has_draft" });
    await expect(updateCourse(c.courseId, { title: JSON.stringify(L("forbi låsen")) }, undefined, { items: list, expectedRevision: before.contentRevision })).rejects.toMatchObject({ code: "course_has_draft" });
    await expect(setCourseItems(c.courseId, list, { revision: { expected: before.contentRevision } })).rejects.toMatchObject({ code: "course_has_draft" });
    // Importens måte å kalle på: uten teller.
    await expect(setCourseItems(c.courseId, list)).rejects.toMatchObject({ code: "course_has_draft" });
    expect(await publishedState(c.courseId)).toEqual(before);

    // Kontroll: etter at utkastet er forkastet, går de samme skrivingene gjennom.
    expect((await discard(c.courseId)).status).toBe(204);
    await updateCourse(c.courseId, { sortOrder: 9 }, undefined, { expectedRevision: before.contentRevision });
    expect((await publishedState(c.courseId)).sortOrder).toBe(9);
    await setCourseItems(c.courseId, list, { revision: { expected: (await publishedState(c.courseId)).contentRevision } });
    expect((await publishedState(c.courseId)).items).toEqual([c.moduleId]);
  });

  it("et avpublisert kurs med utkast: direkte lagring gir 409 course_has_draft til utkastet er forkastet", async () => {
    const c = await publishedCourse("avpublisert-med-utkast");
    await saveFirstDraft(c.courseId, { title: L("ligger igjen"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    await prisma.course.update({ where: { id: c.courseId }, data: { publishedAt: null } });
    const before = await publishedState(c.courseId);
    const body = { title: L(tag("etter avpublisering")), items: [{ type: "MODULE", moduleId: c.moduleId }], expectedRevision: before.contentRevision };
    const blocked = await request(app).put(`${base(c.courseId)}/content`).set(ADMIN).send(body);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("course_has_draft");
    expect(await publishedState(c.courseId)).toEqual(before);

    expect((await discard(c.courseId)).status).toBe(204);
    const ok = await request(app).put(`${base(c.courseId)}/content`).set(ADMIN).send(body);
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(200);
  });

  // Importen har ingen egen sjekk: låsen i `claimCourseRevision` avviser, og importens ene transaksjon rulles tilbake.
  it("kursimporten inn i et kurs med utkast: 409, og ingen nye seksjoner, moduler eller versjoner står igjen", async () => {
    // Bare seksjoner: testmodulene her har ingen vurderingskriterier og kan ikke eksporteres.
    const s1 = await createPublishedSection(tag("import s1"));
    const s2 = await createPublishedSection(tag("import s2"));
    const c = await prisma.course.create({
      data: {
        title: JSON.stringify(L(tag("import"))),
        certificationLevel: "basic",
        publishedAt: new Date(),
        slug: `draft-e2-import-${RUN}-${seq++}`,
        items: { create: [{ itemType: "SECTION", sectionId: s1, sortOrder: 0 }, { itemType: "SECTION", sectionId: s2, sortOrder: 1 }] },
      },
      select: { id: true },
    }).then((row) => ({ courseId: row.id }));
    const exported = await request(app).get(`${base(c.courseId)}/export-package`).set(ADMIN);
    expect(exported.status, JSON.stringify(exported.body).slice(0, 300)).toBe(200);
    const envelope = exported.body.envelope ?? exported.body;
    await saveFirstDraft(c.courseId, { title: L("låser importen"), items: [{ type: "SECTION", sectionId: s1 }] });
    const before = await publishedState(c.courseId);
    const counts = async () => ({
      sections: await prisma.courseSection.count(),
      sectionVersions: await prisma.courseSectionVersion.count(),
      modules: await prisma.module.count(),
      moduleVersions: await prisma.moduleVersion.count(),
    });
    const countsBefore = await counts();

    for (const mode of ["replaceExisting", "updateExisting"]) {
      const answer = await request(app).post("/api/admin/content/courses/import").set(ADMIN).send({ payload: envelope, mode, targetId: c.courseId });
      expect(answer.status, `${mode}: ${JSON.stringify(answer.body).slice(0, 300)}`).toBe(409);
      expect(answer.body.error).toBe("course_has_draft");
    }
    expect(await publishedState(c.courseId)).toEqual(before);
    expect(await counts()).toEqual(countsBefore);

    // Kontroll: uten utkast går importen gjennom (den skriver rett i kurset til etappe 4).
    expect((await discard(c.courseId)).status).toBe(204);
    const ok = await request(app).post("/api/admin/content/courses/import").set(ADMIN).send({ payload: envelope, mode: "updateExisting", targetId: c.courseId });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(201);
  });

  it("fortsatt lov med utkast: avpublisering og arkivering av kurset", async () => {
    const c = await publishedCourse("fortsatt-lov");
    await saveFirstDraft(c.courseId, { title: L("står"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    expect((await request(app).post(`${base(c.courseId)}/unpublish`).set(ADMIN)).status).toBe(200);
    const archived = await request(app).post(`${base(c.courseId)}/archive`).set(ADMIN);
    expect(archived.status, JSON.stringify(archived.body).slice(0, 300)).toBe(200);
    expect(await draftRow(c.courseId)).not.toBeNull();
  });
});

describe("#1140 etappe 2: hvem som kan lagre og forkaste", () => {
  it("en forfatter som ikke eier kurset, kan lese utkastet, men ikke lagre eller forkaste det", async () => {
    const owner = smo("eier");
    const other = smo("annen");
    const moduleId = await createPublishedModule(tag("eierskap modul"));
    const created = await request(app).post("/api/admin/content/courses").set(owner).send({ title: L(tag("eierskap")), certificationLevel: L("basic") });
    expect(created.status).toBe(201);
    const courseId = created.body.course.id as string;
    await prisma.courseItem.create({ data: { courseId, itemType: "MODULE", moduleId, sortOrder: 0 } });
    await prisma.course.update({ where: { id: courseId }, data: { publishedAt: new Date() } });

    const body = { title: L("fra en annen"), items: [{ type: "MODULE", moduleId }], loaded: { expectedRevision: 0 } };
    const denied = await request(app).put(`${base(courseId)}/draft`).set(other).send(body);
    expect(denied.status).toBe(403);
    expect(await draftRow(courseId)).toBeNull();

    const saved = await request(app).put(`${base(courseId)}/draft`).set(owner).send({ ...body, title: L("fra eieren") });
    expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
    const row = await draftRow(courseId);
    const ownerUser = await prisma.user.findFirstOrThrow({ where: { externalId: owner["x-user-id"] }, select: { id: true } });
    expect(row?.updatedById).toBe(ownerUser.id);

    expect((await request(app).get(`${base(courseId)}/draft`).set(other)).status).toBe(200);
    expect((await discard(courseId, other)).status).toBe(403);
    expect((await publishDraft(courseId, {}, other)).status).toBe(403);
    expect(await draftRow(courseId)).not.toBeNull();
    expect(JSON.parse((await prisma.course.findUniqueOrThrow({ where: { id: courseId } })).title).nb).not.toBe("fra eieren");

    // Eieren publiserer, og kan forkaste et nytt.
    const published = await publishDraft(courseId, {}, owner);
    expect(published.status, JSON.stringify(published.body).slice(0, 300)).toBe(200);
    expect(JSON.parse((await prisma.course.findUniqueOrThrow({ where: { id: courseId } })).title).nb).toBe("fra eieren");
    const again = await request(app).put(`${base(courseId)}/draft`).set(owner).send({ ...body, loaded: { expectedRevision: (await detail(courseId)).contentRevision } });
    expect(again.status, JSON.stringify(again.body).slice(0, 300)).toBe(200);
    expect((await discard(courseId, owner)).status).toBe(204);
  });
});

describe("#1140 etappe 2: forkast, tema og utkast som ikke kan leses (QA-porten for skive 2a)", () => {
  it("forkast krever utkastet fana lastet: har en annen lagret siden, 409, og det nyere arbeidet står", async () => {
    const c = await publishedCourse("forkast-gammel-fane");
    const first = await saveFirstDraft(c.courseId, { title: L("B så dette"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    const seenByB = { draftId: first.body.draft.id as string, revision: first.body.draft.revision as number };
    // A lagrer videre.
    const second = await request(app).put(`${base(c.courseId)}/draft`).set(ADMIN).send({ title: L("A sitt nyere arbeid"), items: [{ type: "MODULE", moduleId: c.moduleId }], loaded: seenByB });
    expect(second.status).toBe(200);

    const stale = await discard(c.courseId, ADMIN, seenByB);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("course_draft_changed");
    expect(JSON.parse((await draftRow(c.courseId))!.payloadText).title.nb).toBe("A sitt nyere arbeid");
    expect(await prisma.auditEvent.count({ where: { entityId: c.courseId, action: "course_draft_discarded" } })).toBe(0);

    // Uten id og teller: 400. Med en annen rads id og riktig teller: 409.
    const none = await request(app).delete(`${base(c.courseId)}/draft`).set(ADMIN);
    expect(none.status).toBe(400);
    expect((await discard(c.courseId, ADMIN, { draftId: "en-annen-rad", revision: 2 })).status).toBe(409);
    expect(await draftRow(c.courseId)).not.toBeNull();
    // Kontroll: med det som ligger nå, går den gjennom.
    expect((await discard(c.courseId)).status).toBe(204);
  });

  it("et tema som ikke finnes, avvises når utkastet lagres, som ved direkte lagring", async () => {
    const c = await publishedCourse("tema-lagring");
    const theme = await prisma.courseTheme.create({ data: { name: JSON.stringify(L(tag("tema"))) }, select: { id: true } });
    const unknown = await saveFirstDraft(c.courseId, { themeIds: [theme.id, "finnes-ikke"], items: [{ type: "MODULE", moduleId: c.moduleId }] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe("course_theme_not_found");
    expect(await draftRow(c.courseId)).toBeNull();
    // Kontroll: med bare temaet som finnes, lagres utkastet, og hentingen gir temaet tilbake.
    const ok = await saveFirstDraft(c.courseId, { themeIds: [theme.id], items: [{ type: "MODULE", moduleId: c.moduleId }] });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(200);
    expect(ok.body.draft.course.themeIds).toEqual([theme.id]);
  });

  it("tellerne sjekkes før lista: en utdatert fane får vite at den er utdatert, ikke at et element er arkivert", async () => {
    const c = await publishedCourse("rekkefølge");
    const archived = await createPublishedModule(tag("arkivert"));
    await prisma.module.update({ where: { id: archived }, data: { archivedAt: new Date() } });
    await prisma.course.update({ where: { id: c.courseId }, data: { contentRevision: 3 } });
    const stale = await request(app).put(`${base(c.courseId)}/draft`).set(ADMIN).send({ items: [{ type: "MODULE", moduleId: archived }], loaded: { expectedRevision: 2 } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("course_changed");
  });

  it("et utkast som ikke passer skjemaet lenger: 409 med id og teller (ikke 500), og det kan forkastes", async () => {
    const c = await publishedCourse("uleselig");
    const saved = await saveFirstDraft(c.courseId, { title: L("blir uleselig"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    for (const payloadText of ['{"items":"ikke en liste"}', "ikke json"]) {
      await prisma.courseDraft.update({ where: { courseId: c.courseId }, data: { payloadText } });
      const got = await request(app).get(`${base(c.courseId)}/draft`).set(ADMIN);
      expect(got.status).toBe(409);
      expect(got.body.error).toBe("course_draft_unreadable");
      expect(got.body.details).toMatchObject({ draftId: saved.body.draft.id, revision: 1 });
      const published = await publishDraft(c.courseId);
      expect(published.status).toBe(409);
      expect(published.body.error).toBe("course_draft_unreadable");
    }
    expect(await draftRow(c.courseId)).not.toBeNull();
    expect((await detail(c.courseId)).hasDraft).toBe(true);
    expect((await discard(c.courseId, ADMIN, { draftId: saved.body.draft.id, revision: 1 })).status).toBe(204);
  });

  it("låsen gjelder også den gamle veien for modullista (`setCourseModules`)", async () => {
    const c = await publishedCourse("moduler-lås");
    await saveFirstDraft(c.courseId, { title: L("låser"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    await prisma.course.update({ where: { id: c.courseId }, data: { publishedAt: null } });
    const before = await publishedState(c.courseId);
    const blocked = await request(app).put(`${base(c.courseId)}/modules`).set(ADMIN).send({ modules: [{ moduleId: c.moduleId, sortOrder: 0 }], expectedRevision: before.contentRevision });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("course_has_draft");
    expect(await publishedState(c.courseId)).toEqual(before);
  });
});

describe("#1140 etappe 2 skive 2b: «Publiser utkastet»", () => {
  async function users(name: string, count: number) {
    const data = Array.from({ length: count }, (_, i) => ({ externalId: `draft-e2-${name}-${RUN}-${seq++}-${i}`, email: `draft.e2.${name}.${RUN}.${seq++}.${i}@company.com`, name: `Deltaker ${i}` }));
    await prisma.user.createMany({ data });
    return (await prisma.user.findMany({ where: { externalId: { in: data.map((d) => d.externalId) } }, select: { id: true } })).map((u) => u.id);
  }
  async function giveCertificates(courseId: string, userIds: string[]) {
    await prisma.courseCompletion.createMany({ data: userIds.map((userId) => ({ userId, courseId, moduleSnapshotJson: "[]", sectionSnapshotJson: "[]", versionMajor: 1 })) });
  }

  it("bare tittelen endret: publiseres som mindre versjon uten spørsmål, utkastet er borte, og låsen er opphevet", async () => {
    const c = await publishedCourse("pub-tittel");
    await giveCertificates(c.courseId, await users("tittel", 1));
    const before = await publishedState(c.courseId);
    const nyttNavn = L(tag("publisert navn"));
    await saveFirstDraft(c.courseId, { title: nyttNavn, items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "SECTION", sectionId: c.sectionId }] });

    const published = await publishDraft(c.courseId);
    expect(published.status, JSON.stringify(published.body).slice(0, 300)).toBe(200);
    expect(JSON.parse(published.body.course.title)).toEqual(nyttNavn);
    const after = await publishedState(c.courseId);
    expect(JSON.parse(after.title)).toEqual(nyttNavn);
    expect(after.version).toBe("1.1");
    expect(after.items).toEqual(before.items);
    expect(after.contentRevision).toBe(before.contentRevision + 1);
    expect(await draftRow(c.courseId)).toBeNull();
    expect(await detail(c.courseId)).toMatchObject({ hasDraft: false, lifecycle: "published" });
    expect(await prisma.courseVersionNotice.count({ where: { courseId: c.courseId } })).toBe(0);

    // Revisjonssporet: utkastet publisert, og kurset oppdatert, i samme transaksjon.
    expect(await prisma.auditEvent.count({ where: { entityId: c.courseId, action: "course_draft_published" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: c.courseId, action: "course_updated" } })).toBe(1);
    // Låsen er borte: et nytt utkast kan lages på den nye telleren.
    const next = await saveFirstDraft(c.courseId, { title: L("neste utkast"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    expect(next.status, JSON.stringify(next.body).slice(0, 300)).toBe(200);
    expect((await draftRow(c.courseId))?.baseRevision).toBe(after.contentRevision);
  });

  it("bare innstillinger endret: ingen ny versjon", async () => {
    const c = await publishedCourse("pub-innstillinger");
    const theme = await prisma.courseTheme.create({ data: { name: JSON.stringify(L(tag("tema"))) }, select: { id: true } });
    await saveFirstDraft(c.courseId, {
      sortOrder: 12, enrollmentPolicy: "RESTRICTED", discussionsEnabled: false, themeIds: [theme.id],
      items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "SECTION", sectionId: c.sectionId }],
    });
    const published = await publishDraft(c.courseId);
    expect(published.status, JSON.stringify(published.body).slice(0, 300)).toBe(200);
    const course = await prisma.course.findUniqueOrThrow({ where: { id: c.courseId } });
    expect({ sortOrder: course.sortOrder, enrollmentPolicy: course.enrollmentPolicy, discussionsEnabled: course.discussionsEnabled }).toEqual({ sortOrder: 12, enrollmentPolicy: "RESTRICTED", discussionsEnabled: false });
    expect(`${course.versionMajor}.${course.versionMinor}`).toBe("1.0");
    expect((await prisma.courseThemeAssignment.findMany({ where: { courseId: c.courseId } })).map((row) => row.themeId)).toEqual([theme.id]);
    // Tittelen og beskrivelsen var ikke med i utkastet: de står som publisert.
    expect(JSON.parse(course.title).nb).toBe(c.title);
    expect(JSON.parse(course.description!).nb).toBe(`${c.title} beskrivelse`);
  });

  it("lista endret og noen har kursbevis: svaret kreves; uten det er ingenting publisert og utkastet står", async () => {
    const c = await publishedCourse("pub-svar");
    const holders = await users("svar", 2);
    await giveCertificates(c.courseId, holders);
    const extra = await createPublishedModule(tag("ny modul"));
    await saveFirstDraft(c.courseId, { title: L(tag("med ny modul")), items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "SECTION", sectionId: c.sectionId }, { type: "MODULE", moduleId: extra }] });
    const before = await publishedState(c.courseId);

    const unanswered = await publishDraft(c.courseId);
    expect(unanswered.status).toBe(400);
    expect(unanswered.body.error).toBe("course_version_required");
    expect(await publishedState(c.courseId)).toEqual(before);
    expect((await draftRow(c.courseId))?.revision).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: c.courseId, action: "course_draft_published" } })).toBe(0);

    // Hovedversjon: ny versjon, e-postrader til dem med kursbevis, og utkastet er borte.
    const major = await publishDraft(c.courseId, { version: "major" });
    expect(major.status, JSON.stringify(major.body).slice(0, 300)).toBe(200);
    const after = await publishedState(c.courseId);
    expect(after.version).toBe("2.0");
    expect(after.items).toEqual([c.moduleId, c.sectionId, extra]);
    expect((await prisma.courseVersionNotice.findMany({ where: { courseId: c.courseId } })).map((n) => n.userId).sort()).toEqual([...holders].sort());
    expect(await draftRow(c.courseId)).toBeNull();
  });

  it("lista endret, svaret «minor»: mindre versjon, ingen e-postrader", async () => {
    const c = await publishedCourse("pub-minor");
    await giveCertificates(c.courseId, await users("minor", 1));
    await saveFirstDraft(c.courseId, { items: [{ type: "SECTION", sectionId: c.sectionId }, { type: "MODULE", moduleId: c.moduleId }] });
    const minor = await publishDraft(c.courseId, { version: "minor" });
    expect(minor.status, JSON.stringify(minor.body).slice(0, 300)).toBe(200);
    const after = await publishedState(c.courseId);
    expect(after.version).toBe("1.1");
    expect(after.items).toEqual([c.sectionId, c.moduleId]);
    expect(await prisma.courseVersionNotice.count({ where: { courseId: c.courseId } })).toBe(0);
  });

  it("publiseringen krever utkastet fana lastet: en annen har lagret siden → 409, og ingenting er publisert", async () => {
    const c = await publishedCourse("pub-gammel-fane");
    const first = await saveFirstDraft(c.courseId, { title: L("det B så"), items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "SECTION", sectionId: c.sectionId }] });
    const seenByB = { draftId: first.body.draft.id as string, revision: 1 };
    await request(app).put(`${base(c.courseId)}/draft`).set(ADMIN).send({ title: L("det A la til"), items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "SECTION", sectionId: c.sectionId }], loaded: seenByB });
    const before = await publishedState(c.courseId);

    const stale = await request(app).post(`${base(c.courseId)}/draft/publish`).set(ADMIN).send({ loaded: seenByB });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("course_draft_changed");
    expect(await publishedState(c.courseId)).toEqual(before);
    expect((await draftRow(c.courseId))?.revision).toBe(2);

    const wrongId = await request(app).post(`${base(c.courseId)}/draft/publish`).set(ADMIN).send({ loaded: { draftId: "en-annen-rad", revision: 2 } });
    expect(wrongId.status).toBe(409);
    expect(await publishedState(c.courseId)).toEqual(before);
    // Kroppen er streng: uten `loaded`, eller med ukjente felt, 400.
    expect((await request(app).post(`${base(c.courseId)}/draft/publish`).set(ADMIN).send({})).status).toBe(400);
    expect((await request(app).post(`${base(c.courseId)}/draft/publish`).set(ADMIN).send({ loaded: { draftId: first.body.draft.id, revision: 2 }, title: L("smugles inn") })).status).toBe(400);
    expect(await publishedState(c.courseId)).toEqual(before);
  });

  it("to samtidige publiseringer av samme utkast: én vinner, de andre får 409, og versjonen øker én gang", async () => {
    const c = await publishedCourse("pub-samtidig");
    const saved = await saveFirstDraft(c.courseId, { title: L(tag("samtidig publisert")), items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "SECTION", sectionId: c.sectionId }] });
    const loaded = { draftId: saved.body.draft.id as string, revision: 1 };
    const send = () => request(app).post(`${base(c.courseId)}/draft/publish`).set(ADMIN).send({ loaded });
    const answers = await Promise.all([send(), send(), send()]);
    expect(answers.filter((r) => r.status === 200)).toHaveLength(1);
    for (const lost of answers.filter((r) => r.status !== 200)) expect([lost.status, lost.body.error]).toEqual([409, "course_draft_changed"]);
    expect((await publishedState(c.courseId)).version).toBe("1.1");
    expect(await prisma.auditEvent.count({ where: { entityId: c.courseId, action: "course_draft_published" } })).toBe(1);
  });

  it("et tema som er slettet siden utkastet ble lagret, tas bort ved publisering", async () => {
    const c = await publishedCourse("pub-tema");
    const kept = await prisma.courseTheme.create({ data: { name: JSON.stringify(L(tag("beholdes"))) }, select: { id: true } });
    const deleted = await prisma.courseTheme.create({ data: { name: JSON.stringify(L(tag("slettes"))) }, select: { id: true } });
    await saveFirstDraft(c.courseId, { themeIds: [kept.id, deleted.id], items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "SECTION", sectionId: c.sectionId }] });
    await prisma.courseTheme.delete({ where: { id: deleted.id } });
    const published = await publishDraft(c.courseId);
    expect(published.status, JSON.stringify(published.body).slice(0, 300)).toBe(200);
    expect((await prisma.courseThemeAssignment.findMany({ where: { courseId: c.courseId } })).map((row) => row.themeId)).toEqual([kept.id]);
  });

  it("et element som er arkivert eller slettet siden utkastet ble lagret: avvist med navn, ingenting publisert", async () => {
    const c = await publishedCourse("pub-arkivert");
    const archivedTitle = tag("arkiveres før publisering");
    const archived = await createPublishedModule(archivedTitle);
    const doomed = await prisma.courseSection.create({ data: { title: JSON.stringify(L(tag("slettes før publisering"))) }, select: { id: true } });
    await saveFirstDraft(c.courseId, { title: L(tag("skal ikke ut")), items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "MODULE", moduleId: archived }, { type: "SECTION", sectionId: doomed.id }] });
    await prisma.module.update({ where: { id: archived }, data: { archivedAt: new Date() } });
    await prisma.courseSection.delete({ where: { id: doomed.id } });
    const before = await publishedState(c.courseId);

    const rejected = await publishDraft(c.courseId, { version: "minor" });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe("course_draft_item_unusable");
    expect(rejected.body.details.items).toEqual([
      { type: "MODULE", id: archived, title: JSON.stringify(L(archivedTitle)), reason: "archived" },
      { type: "SECTION", id: doomed.id, title: null, reason: "missing" },
    ]);
    expect(await publishedState(c.courseId)).toEqual(before);
    expect(await draftRow(c.courseId)).not.toBeNull();
  });

  it("et element som er AVPUBLISERT siden utkastet ble lagret: merket i utkastet, og publiseringen avvises med navn", async () => {
    const c = await publishedCourse("pub-avpublisert-element");
    const title = tag("avpubliseres før publisering");
    const extra = await createPublishedModule(title);
    await saveFirstDraft(c.courseId, { items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "MODULE", moduleId: extra }] });
    // Modulen står bare i utkastet, så ingenting hindrer eieren i å avpublisere den.
    await prisma.module.update({ where: { id: extra }, data: { activeVersionId: null } });
    const before = await publishedState(c.courseId);

    const got = await request(app).get(`${base(c.courseId)}/draft`).set(ADMIN);
    expect(got.body.draft.items.map((i: { unpublished: boolean }) => i.unpublished)).toEqual([false, true]);
    const rejected = await publishDraft(c.courseId);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe("course_draft_item_unusable");
    expect(rejected.body.details.items).toEqual([{ type: "MODULE", id: extra, title: JSON.stringify(L(title)), reason: "unpublished" }]);
    expect(await publishedState(c.courseId)).toEqual(before);
    expect(await draftRow(c.courseId)).not.toBeNull();
  });

  it("kurset er avpublisert: 409, ingenting skrevet, og utkastet kan forkastes", async () => {
    const c = await publishedCourse("pub-avpublisert");
    await saveFirstDraft(c.courseId, { title: L("venter"), items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "SECTION", sectionId: c.sectionId }] });

    expect((await request(app).post(`${base(c.courseId)}/unpublish`).set(ADMIN)).status).toBe(200);
    const before = await publishedState(c.courseId);
    const unpublished = await publishDraft(c.courseId);
    expect(unpublished.status).toBe(409);
    expect(unpublished.body.error).toBe("course_draft_requires_published");
    expect(await publishedState(c.courseId)).toEqual(before);
    expect(await draftRow(c.courseId)).not.toBeNull();
    expect((await discard(c.courseId)).status).toBe(204);
    // Uten utkast: samme svar som når en annen har lagret, publisert eller forkastet. Fana må laste på nytt.
    const none = await publishDraft(c.courseId);
    expect([none.status, none.body.error]).toEqual([409, "course_draft_changed"]);
  });

  it("deltakeren ser den nye utgaven først når utkastet er publisert", async () => {
    const c = await publishedCourse("pub-deltaker");
    const extra = await createPublishedModule(tag("kommer med publiseringen"));
    const draftTitle = tag("navn etter publisering");
    await saveFirstDraft(c.courseId, { title: L(draftTitle), items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "MODULE", moduleId: extra }] });
    const participant = { "x-user-id": `draft-e2-p3-${RUN}`, "x-user-email": `draft.e2.p3.${RUN}@x.test`, "x-user-name": "Deltaker", "x-user-department": "Learning", "x-user-roles": "PARTICIPANT", "x-locale": "nb" };
    const seen = async () => {
      const one = await request(app).get(`/api/courses/${c.courseId}`).set(participant);
      expect(one.status).toBe(200);
      return { text: JSON.stringify(one.body), ids: (one.body.course.items as Array<{ moduleId?: string | null; sectionId?: string | null }>).map((i) => i.moduleId ?? i.sectionId) };
    };
    const before = await seen();
    expect(before.text).not.toContain(draftTitle);
    expect(before.ids).toEqual([c.moduleId, c.sectionId]);

    expect((await publishDraft(c.courseId)).status).toBe(200);
    const after = await seen();
    expect(after.text).toContain(draftTitle);
    expect(after.ids).toEqual([c.moduleId, extra]);
  });
});
