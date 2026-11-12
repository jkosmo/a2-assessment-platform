import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { setCourseItems, updateCourse } from "../src/modules/course/index.js";
import { COURSE_DRAFTS_SWITCH_KEY } from "../src/modules/course/courseDraft.js";

// #1140 etappe 2, skive 2a (doc/design/PLAN_1140_E2.md): utkastet til et publisert kurs.
//   - Bryteren `course_drafts` styrer alt. Av: som før, og en utkastrad låser ingenting.
//   - På: «Lagre» på et publisert kurs går til utkastet (`PUT …/draft`), og ingenting deltakerne ser, endres.
//   - Med utkast og bryteren på er den publiserte utgaven låst for alt annet som skriver felt eller liste.
// Testene går gjennom rutene (supertest), med de feltene klienten sender. Integrasjonstestene kjører én fil om gangen, så
// bryteren kan settes her uten å treffe andre filer; den fjernes etter hver test.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const ADMIN = {
  "x-user-id": "draft-e2-admin",
  "x-user-email": "draft.e2.admin@x.test",
  "x-user-name": "Admin",
  "x-user-roles": "ADMINISTRATOR",
  "x-locale": "nb",
};
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

async function setSwitch(on: boolean) {
  if (on) {
    await prisma.platformConfig.upsert({
      where: { key: COURSE_DRAFTS_SWITCH_KEY },
      create: { key: COURSE_DRAFTS_SWITCH_KEY, value: "on", updatedBy: "test" },
      update: { value: "on", updatedBy: "test" },
    });
  } else {
    await prisma.platformConfig.deleteMany({ where: { key: COURSE_DRAFTS_SWITCH_KEY } });
  }
}

afterEach(async () => {
  await setSwitch(false);
});

afterAll(async () => {
  await setSwitch(false);
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

type Detail = { title: string; contentRevision: number; versionMajor: number; versionMinor: number; drafts: { enabled: boolean; hasDraft: boolean } };

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

/** Lagrer et utkast slik skjemaet gjør når det ikke så noe utkast. */
async function saveFirstDraft(courseId: string, body: Record<string, unknown>, headers: Record<string, string> = ADMIN) {
  const loaded = (await detail(courseId)).contentRevision;
  return request(app).put(`${base(courseId)}/draft`).set(headers).send({ ...body, loaded: { expectedRevision: loaded } });
}

describe("#1140 etappe 2: bryteren av — alt er som før", () => {
  it("kursdetaljen sier at utkast er av, og `PUT …/draft` avvises uten å skrive noe", async () => {
    const c = await publishedCourse("av");
    expect((await detail(c.courseId)).drafts).toEqual({ enabled: false, hasDraft: false });
    const saved = await saveFirstDraft(c.courseId, { title: L(tag("nytt navn")), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    expect(saved.status).toBe(409);
    expect(saved.body.error).toBe("course_drafts_off");
    expect(await draftRow(c.courseId)).toBeNull();
  });

  it("bare verdien «on» slår bryteren på: en rad med en annen verdi er av", async () => {
    const c = await publishedCourse("av-verdi");
    await prisma.platformConfig.upsert({
      where: { key: COURSE_DRAFTS_SWITCH_KEY },
      create: { key: COURSE_DRAFTS_SWITCH_KEY, value: "off", updatedBy: "test" },
      update: { value: "off", updatedBy: "test" },
    });
    expect((await detail(c.courseId)).drafts.enabled).toBe(false);
    const saved = await saveFirstDraft(c.courseId, { items: [{ type: "MODULE", moduleId: c.moduleId }] });
    expect(saved.status).toBe(409);
    expect(saved.body.error).toBe("course_drafts_off");
  });

  it("en utkastrad som finnes, låser ingenting: direkte lagring går gjennom, og utkastet kan hentes og forkastes", async () => {
    const c = await publishedCourse("av-med-rad");
    await setSwitch(true);
    expect((await saveFirstDraft(c.courseId, { title: L(tag("i utkastet")), items: [{ type: "MODULE", moduleId: c.moduleId }] })).status).toBe(200);
    await setSwitch(false);

    const d = await detail(c.courseId);
    expect(d.drafts).toEqual({ enabled: false, hasDraft: true });
    const nyttNavn = L(tag("lagret direkte"));
    const direct = await request(app).put(`${base(c.courseId)}/content`).set(ADMIN).send({
      title: nyttNavn, items: [{ type: "MODULE", moduleId: c.moduleId }, { type: "SECTION", sectionId: c.sectionId }], expectedRevision: d.contentRevision,
    });
    expect(direct.status, JSON.stringify(direct.body).slice(0, 300)).toBe(200);
    expect(JSON.parse((await publishedState(c.courseId)).title)).toEqual(nyttNavn);

    expect((await request(app).get(`${base(c.courseId)}/draft`).set(ADMIN)).status).toBe(200);
    expect((await request(app).delete(`${base(c.courseId)}/draft`).set(ADMIN)).status).toBe(204);
    expect(await draftRow(c.courseId)).toBeNull();
  });
});

describe("#1140 etappe 2: bryteren på — lagre, hente og forkaste utkastet", () => {
  beforeEach(async () => {
    await setSwitch(true);
  });

  it("første lagring lager utkastet, og ingenting i den publiserte utgaven er endret", async () => {
    const c = await publishedCourse("lagre");
    const extra = await createPublishedModule(tag("lagre ekstra"));
    const before = await publishedState(c.courseId);
    expect((await detail(c.courseId)).drafts).toEqual({ enabled: true, hasDraft: false });

    const nyttNavn = L(tag("navn i utkastet"));
    const saved = await saveFirstDraft(c.courseId, {
      title: nyttNavn,
      sortOrder: 7,
      enrollmentPolicy: "RESTRICTED",
      items: [{ type: "SECTION", sectionId: c.sectionId }, { type: "MODULE", moduleId: extra, discussionsEnabled: false }],
    });
    expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
    expect(saved.body.draft).toMatchObject({ revision: 1, baseRevision: before.contentRevision, source: "form" });

    expect(await publishedState(c.courseId)).toEqual(before);
    expect((await detail(c.courseId)).drafts).toEqual({ enabled: true, hasDraft: true });

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
      { type: "SECTION", sortOrder: 0, moduleId: null, sectionId: c.sectionId, title: JSON.stringify(L(c.sectionTitle)), discussionsEnabled: true, archivedAt: null, missing: false },
      { type: "MODULE", sortOrder: 1, moduleId: c.moduleId, sectionId: null, title: JSON.stringify(L(c.moduleTitle)), discussionsEnabled: false, archivedAt: null, missing: false },
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
    expect((await request(app).delete(`${base(c.courseId)}/draft`).set(ADMIN)).status).toBe(204);
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
    expect(ok.body.draft.baseRevision).toBe(5);
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
    // Kontroll: direkte lagring av det upubliserte kurset virker med bryteren på.
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

  it("forkast fjerner utkastet og sporer det; uten utkast svarer hente og forkaste 404", async () => {
    const c = await publishedCourse("forkast");
    expect((await request(app).get(`${base(c.courseId)}/draft`).set(ADMIN)).status).toBe(404);
    expect((await request(app).delete(`${base(c.courseId)}/draft`).set(ADMIN)).status).toBe(404);

    const before = await publishedState(c.courseId);
    await saveFirstDraft(c.courseId, { title: L("forkastes"), items: [{ type: "MODULE", moduleId: c.moduleId }] });
    const gone = await request(app).delete(`${base(c.courseId)}/draft`).set(ADMIN);
    expect(gone.status).toBe(204);
    expect(await draftRow(c.courseId)).toBeNull();
    expect(await publishedState(c.courseId)).toEqual(before);
    expect((await detail(c.courseId)).drafts.hasDraft).toBe(false);
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
    expect((await request(app).delete(`${base(c.courseId)}/draft`).set(ADMIN)).status).toBe(204);

    const d = await publishedCourse("slettes");
    await saveFirstDraft(d.courseId, { title: L("slettes med kurset"), items: [{ type: "MODULE", moduleId: d.moduleId }] });
    await prisma.course.delete({ where: { id: d.courseId } });
    expect(await draftRow(d.courseId)).toBeNull();
  });
});

describe("#1140 etappe 2: deltakerne ser den publiserte utgaven mens utkastet finnes", () => {
  it("kurset i «Mine kurs» og kursdetaljen har navnet og innholdet fra den publiserte utgaven", async () => {
    await setSwitch(true);
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

describe("#1140 etappe 2: låsen — med utkast og bryteren på skriver ingenting annet i den publiserte utgaven", () => {
  beforeEach(async () => {
    await setSwitch(true);
  });

  it("med bryteren på avvises direkte lagring av et publisert kurs, også uten utkast (en fane fra før)", async () => {
    const c = await publishedCourse("direkte");
    const before = await publishedState(c.courseId);
    const loaded = before.contentRevision;
    const list = [{ type: "MODULE", moduleId: c.moduleId }];
    const answers = [
      await request(app).put(`${base(c.courseId)}/content`).set(ADMIN).send({ title: L("direkte"), items: list, expectedRevision: loaded }),
      await request(app).put(base(c.courseId)).set(ADMIN).send({ sortOrder: 3, expectedRevision: loaded }),
      await request(app).put(`${base(c.courseId)}/items`).set(ADMIN).send({ items: list, expectedRevision: loaded }),
      await request(app).put(`${base(c.courseId)}/modules`).set(ADMIN).send({ modules: [{ moduleId: c.moduleId, sortOrder: 0 }], expectedRevision: loaded }),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(409);
      expect(answer.body.error).toBe("course_form_outdated");
    }
    expect(await publishedState(c.courseId)).toEqual(before);
  });

  it("KONTROLL: med bryteren av går de samme fire lagringene gjennom", async () => {
    await setSwitch(false);
    const c = await publishedCourse("direkte-av");
    const list = [{ type: "MODULE", moduleId: c.moduleId }, { type: "SECTION", sectionId: c.sectionId }];
    const rev = async () => (await detail(c.courseId)).contentRevision;
    expect((await request(app).put(`${base(c.courseId)}/content`).set(ADMIN).send({ title: L(tag("direkte av")), items: list, expectedRevision: await rev() })).status).toBe(200);
    expect((await request(app).put(base(c.courseId)).set(ADMIN).send({ sortOrder: 3, expectedRevision: await rev() })).status).toBe(200);
    expect((await request(app).put(`${base(c.courseId)}/items`).set(ADMIN).send({ items: list, expectedRevision: await rev() })).status).toBe(204);
    expect((await request(app).put(`${base(c.courseId)}/modules`).set(ADMIN).send({ modules: [{ moduleId: c.moduleId, sortOrder: 0 }], expectedRevision: await rev() })).status).toBe(204);
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

    // Kontroll: bryteren av, og den samme skrivingen går gjennom med utkastet liggende.
    await setSwitch(false);
    await updateCourse(c.courseId, { sortOrder: 9 }, undefined, { expectedRevision: before.contentRevision });
    expect((await publishedState(c.courseId)).sortOrder).toBe(9);
    // Og med bryteren på igjen, etter at utkastet er forkastet.
    await setSwitch(true);
    expect((await request(app).delete(`${base(c.courseId)}/draft`).set(ADMIN)).status).toBe(204);
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

    expect((await request(app).delete(`${base(c.courseId)}/draft`).set(ADMIN)).status).toBe(204);
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

    // Kontroll: uten utkast går importen gjennom med bryteren på (den skriver rett i kurset til etappe 4).
    expect((await request(app).delete(`${base(c.courseId)}/draft`).set(ADMIN)).status).toBe(204);
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
    await setSwitch(true);
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
    expect((await request(app).delete(`${base(courseId)}/draft`).set(other)).status).toBe(403);
    expect(await draftRow(courseId)).not.toBeNull();
    expect((await request(app).delete(`${base(courseId)}/draft`).set(owner)).status).toBe(204);
  });

  it("en deltaker når ingen av rutene", async () => {
    await setSwitch(true);
    const c = await publishedCourse("deltaker-ruter");
    const participant = { "x-user-id": `draft-e2-p2-${RUN}`, "x-user-email": `draft.e2.p2.${RUN}@x.test`, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT", "x-locale": "nb" };
    expect((await request(app).get(`${base(c.courseId)}/draft`).set(participant)).status).toBe(403);
    expect((await request(app).put(`${base(c.courseId)}/draft`).set(participant).send({ items: [], loaded: { expectedRevision: 0 } })).status).toBe(403);
    expect((await request(app).delete(`${base(c.courseId)}/draft`).set(participant)).status).toBe(403);
  });
});
