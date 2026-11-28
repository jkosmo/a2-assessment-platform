// #1169 skive 4c (doc/design/PLAN_1169_4B_DUPLISER_KURS.md, § 6; produkteier 28.11.2026, doc/DECISIONS.md punkt 8): «Døp om» i
// kurslista, gjennom ruta (`PATCH /api/admin/content/courses/:courseId/title`):
//   - ikke publisert: navnet rett i kurset, telleren økt, intet utkast;
//   - publisert uten utkast: et utkast med bare tittelen og kursets elementer (MED `discussionsEnabled`); kurset er urørt; når
//     utkastet publiseres, endres bare navnet (mindre versjon, diskusjonen der den var av, står av);
//   - publisert med utkast: tittelen byttes, resten av utkastet står; lista viser utkastets tittel (`draftTitle`);
//   - samme navn: ingenting skrives (intet utkast lages); feil `expectedTitle`: 409, ingenting skrevet; arkivert: 400;
//   - en annen produsent og en deltaker: 403.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const C = "/api/admin/content/courses";
const L = (text: string) => ({ "en-GB": `${text} EN`, nb: text, nn: `${text} NN` });
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 300);
let seq = 0;
const person = (id: string, role: string) => {
  seq += 1;
  return {
    "x-user-id": `${id}-${RUN}`,
    "x-user-email": `${id}.${RUN}@x.test`,
    "x-user-name": id,
    "x-user-roles": role,
    "x-forwarded-for": `10.117.9.${seq}`,
  };
};
const OWNER = person("4c-eier", "SUBJECT_MATTER_OWNER");
const OTHER = person("4c-annen", "SUBJECT_MATTER_OWNER");
const LEARNER = person("4c-deltaker", "PARTICIPANT");

let ownerId = "";
let moduleId = "";
let sectionId = "";

async function userId(headers: Record<string, string>) {
  await request(app).get("/api/me").set(headers);
  return (await prisma.user.findUniqueOrThrow({ where: { externalId: headers["x-user-id"] }, select: { id: true } })).id;
}

async function ownedCourse(options: { published?: boolean; archivedAt?: Date; title?: string } = {}) {
  const published = options.published ?? true;
  const course = await prisma.course.create({
    data: {
      title: options.title ?? JSON.stringify(L(`4c kurs ${RUN}-${seq++}`)),
      description: JSON.stringify(L("Beskrivelse")),
      certificationLevel: JSON.stringify(L("basic")),
      publishedAt: published && !options.archivedAt ? new Date() : null,
      slug: published ? `kurs-4c-${RUN}-${seq++}` : null,
      archivedAt: options.archivedAt ?? null,
      versionMajor: 2,
      versionMinor: 1,
      items: {
        create: [
          { itemType: "SECTION", sectionId, sortOrder: 0, discussionsEnabled: false },
          { itemType: "MODULE", moduleId, sortOrder: 1, discussionsEnabled: true },
        ],
      },
    },
    select: { id: true },
  });
  await prisma.courseModuleRequirement.create({ data: { courseId: course.id, moduleId, minModuleMajor: 1 } });
  await prisma.contentOwner.create({ data: { contentType: "COURSE", contentId: course.id, userId: ownerId } });
  return course.id;
}

const rename = (courseId: string, body: Record<string, unknown>, who = OWNER) => request(app).patch(`${C}/${courseId}/title`).set(who).send(body);
const itemsOf = (courseId: string) =>
  prisma.courseItem.findMany({ where: { courseId }, orderBy: { sortOrder: "asc" }, select: { itemType: true, moduleId: true, sectionId: true, discussionsEnabled: true } });

beforeAll(async () => {
  ownerId = await userId(OWNER);
  const m = await prisma.module.create({ data: { title: JSON.stringify(L(`4c modul ${RUN}`)) }, select: { id: true } });
  const v = await prisma.moduleVersion.create({
    data: { moduleId: m.id, versionNo: 1, versionMajor: 1, versionMinor: 0, assessmentMode: "MCQ_ONLY", publishedAt: new Date(), taskText: JSON.stringify(L("Oppgave")) },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: m.id }, data: { activeVersionId: v.id } });
  moduleId = m.id;
  const s = await prisma.courseSection.create({ data: { title: JSON.stringify(L(`4c seksjon ${RUN}`)) }, select: { id: true } });
  const sv = await prisma.courseSectionVersion.create({ data: { sectionId: s.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Tekst.")), publishedAt: new Date() }, select: { id: true } });
  await prisma.courseSection.update({ where: { id: s.id }, data: { activeVersionId: sv.id } });
  sectionId = s.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("#1169 skive 4c — «Døp om» for kurs", () => {
  it("ikke publisert: navnet rett i kurset, telleren økt, intet utkast", async () => {
    const id = await ownedCourse({ published: false });
    const before = await prisma.course.findUniqueOrThrow({ where: { id } });
    const res = await rename(id, { title: { ...JSON.parse(before.title), nb: "Nytt navn" }, expectedTitle: before.title });
    expect(res.status, show(res)).toBe(200);
    expect(res.body).toEqual({ renamedIn: "course" });
    const after = await prisma.course.findUniqueOrThrow({ where: { id } });
    expect(JSON.parse(after.title).nb).toBe("Nytt navn");
    expect(JSON.parse(after.title).nn).toBe(JSON.parse(before.title).nn);
    expect(after.contentRevision).toBe(before.contentRevision + 1);
    expect(await prisma.courseDraft.count({ where: { courseId: id } })).toBe(0);
  });

  it("publisert uten utkast: utkast med bare tittelen og elementene; kurset urørt; publisert utkast endrer bare navnet", async () => {
    const id = await ownedCourse();
    const before = await prisma.course.findUniqueOrThrow({ where: { id } });
    const itemsBefore = await itemsOf(id);
    const res = await rename(id, { title: { ...JSON.parse(before.title), nb: "Publisert nytt navn" }, expectedTitle: before.title });
    expect(res.status, show(res)).toBe(200);
    expect(res.body).toEqual({ renamedIn: "draft" });
    expect(await prisma.course.findUniqueOrThrow({ where: { id } })).toEqual(before);

    const draft = await prisma.courseDraft.findUniqueOrThrow({ where: { courseId: id } });
    const payload = JSON.parse(draft.payloadText);
    expect(Object.keys(payload).sort()).toEqual(["items", "title"]);
    expect(payload.title.nb).toBe("Publisert nytt navn");
    expect(payload.items).toEqual([
      { type: "SECTION", sectionId, discussionsEnabled: false },
      { type: "MODULE", moduleId, discussionsEnabled: true },
    ]);

    // Lista viser utkastets tittel, så neste «Døp om» starter fra den.
    const list = await request(app).get(C).set(OWNER);
    const row = (list.body.courses as Array<{ id: string; draftTitle?: string; lifecycle: string }>).find((c) => c.id === id);
    expect(row?.lifecycle).toBe("published_with_draft");
    expect(JSON.parse(row!.draftTitle!).nb).toBe("Publisert nytt navn");

    const published = await request(app).post(`${C}/${id}/draft/publish`).set(OWNER).send({ loaded: { draftId: draft.id, revision: draft.revision } });
    expect(published.status, show(published)).toBe(200);
    const after = await prisma.course.findUniqueOrThrow({ where: { id } });
    expect(JSON.parse(after.title).nb).toBe("Publisert nytt navn");
    expect(after.description).toBe(before.description);
    expect(after.enrollmentPolicy).toBe(before.enrollmentPolicy);
    expect({ major: after.versionMajor, minor: after.versionMinor }).toEqual({ major: 2, minor: 2 });
    expect(await itemsOf(id)).toEqual(itemsBefore);
  });

  it("trådene beholder seksjonen og modulen sin når utkastet publiseres og når lista endres (QA-porten 2.192.0); KONTROLL: en tråd på et element som tas ut, havner på kursets tavle", async () => {
    const id = await ownedCourse();
    const items = await prisma.courseItem.findMany({ where: { courseId: id }, orderBy: { sortOrder: "asc" }, select: { id: true, itemType: true } });
    const sectionItem = items.find((i) => i.itemType === "SECTION")!.id;
    const moduleItem = items.find((i) => i.itemType === "MODULE")!.id;
    const thread = (courseItemId: string, title: string) =>
      prisma.discussionThread.create({ data: { courseId: id, courseItemId, authorId: ownerId, title, bodyMarkdown: "Spørsmål.", updatedAt: new Date("2026-10-01T08:00:00.000Z") }, select: { id: true } });
    const onSection = await thread(sectionItem, "På seksjonen");
    const onModule = await thread(moduleItem, "På modulen");
    const linkOf = async (threadId: string) => {
      const row = await prisma.discussionThread.findUniqueOrThrow({ where: { id: threadId }, select: { courseItemId: true, updatedAt: true } });
      const item = row.courseItemId ? await prisma.courseItem.findUnique({ where: { id: row.courseItemId }, select: { sectionId: true, moduleId: true } }) : null;
      return { item, updatedAt: row.updatedAt.toISOString() };
    };

    // «Døp om» og publiser utkastet: elementene skrives på nytt, trådene står.
    const before = await prisma.course.findUniqueOrThrow({ where: { id } });
    expect((await rename(id, { title: { ...JSON.parse(before.title), nb: "Med tråder" }, expectedTitle: before.title })).status).toBe(200);
    const draft = await prisma.courseDraft.findUniqueOrThrow({ where: { courseId: id } });
    const published = await request(app).post(`${C}/${id}/draft/publish`).set(OWNER).send({ loaded: { draftId: draft.id, revision: draft.revision } });
    expect(published.status, show(published)).toBe(200);
    expect(await linkOf(onSection.id)).toEqual({ item: { sectionId, moduleId: null }, updatedAt: "2026-10-01T08:00:00.000Z" });
    expect(await linkOf(onModule.id)).toEqual({ item: { sectionId: null, moduleId }, updatedAt: "2026-10-01T08:00:00.000Z" });

    // KONTROLL: modulen tas ut av kurset (direkte gjennom elementene, som et upublisert kurs ville lagret) — tråden på den havner på
    // kursets tavle; tråden på seksjonen står.
    await prisma.course.update({ where: { id }, data: { publishedAt: null } });
    const course = await prisma.course.findUniqueOrThrow({ where: { id } });
    const saved = await request(app).put(`${C}/${id}/items`).set(OWNER).send({ items: [{ type: "SECTION", sectionId, discussionsEnabled: false }], expectedRevision: course.contentRevision });
    expect(saved.status, show(saved)).toBe(204);
    expect((await linkOf(onSection.id)).item).toEqual({ sectionId, moduleId: null });
    expect((await linkOf(onModule.id)).item).toBeNull();
  });

  it("den gamle `PUT …/modules` (`setCourseModules`) gir også trådene elementet tilbake", async () => {
    const id = await ownedCourse({ published: false });
    const items = await prisma.courseItem.findMany({ where: { courseId: id }, select: { id: true, itemType: true } });
    const make = (courseItemId: string) =>
      prisma.discussionThread.create({ data: { courseId: id, courseItemId, authorId: ownerId, title: "Tråd", bodyMarkdown: "Spørsmål." }, select: { id: true } });
    const onSection = await make(items.find((i) => i.itemType === "SECTION")!.id);
    const onModule = await make(items.find((i) => i.itemType === "MODULE")!.id);
    const course = await prisma.course.findUniqueOrThrow({ where: { id } });
    const res = await request(app).put(`${C}/${id}/modules`).set(OWNER).send({ modules: [{ moduleId, sortOrder: 0 }], expectedRevision: course.contentRevision });
    expect(res.status, show(res)).toBe(204);
    const itemOf = async (threadId: string) => {
      const row = await prisma.discussionThread.findUniqueOrThrow({ where: { id: threadId }, select: { courseItemId: true } });
      return row.courseItemId ? prisma.courseItem.findUnique({ where: { id: row.courseItemId }, select: { sectionId: true, moduleId: true } }) : null;
    };
    expect(await itemOf(onSection.id)).toEqual({ sectionId, moduleId: null });
    expect(await itemOf(onModule.id)).toEqual({ sectionId: null, moduleId });
  });

  it("publisert med utkast: tittelen byttes, resten av utkastet står", async () => {
    const id = await ownedCourse();
    const course = await prisma.course.findUniqueOrThrow({ where: { id } });
    const saved = await request(app).put(`${C}/${id}/draft`).set(OWNER).send({
      description: L("Ny beskrivelse i utkastet"),
      items: [{ type: "MODULE", moduleId, discussionsEnabled: true }],
      loaded: { expectedRevision: course.contentRevision },
    });
    expect(saved.status, show(saved)).toBe(200);
    const res = await rename(id, { title: { ...JSON.parse(course.title), nb: "Navn i utkastet" }, expectedTitle: course.title });
    expect(res.status, show(res)).toBe(200);
    expect(res.body).toEqual({ renamedIn: "draft" });
    const payload = JSON.parse((await prisma.courseDraft.findUniqueOrThrow({ where: { courseId: id } })).payloadText);
    expect(payload.title.nb).toBe("Navn i utkastet");
    expect(payload.description.nb).toBe("Ny beskrivelse i utkastet");
    expect(payload.items).toEqual([{ type: "MODULE", moduleId, discussionsEnabled: true }]);
  });

  it("samme navn: ingenting skrives, og intet utkast lages", async () => {
    const id = await ownedCourse();
    const before = await prisma.course.findUniqueOrThrow({ where: { id } });
    const res = await rename(id, { title: JSON.parse(before.title), expectedTitle: before.title });
    expect(res.status, show(res)).toBe(200);
    expect(res.body).toEqual({ renamedIn: "unchanged" });
    expect(await prisma.courseDraft.count({ where: { courseId: id } })).toBe(0);
  });

  it("samme tittel i en annen rekkefølge (en API-kaller som bygger teksten selv) gir ingen falsk 409", async () => {
    const stored = JSON.stringify({ nn: `4c rekkefølge ${RUN} NN`, nb: `4c rekkefølge ${RUN}`, "en-GB": `4c rekkefølge ${RUN} EN` });
    const reordered = JSON.stringify({ "en-GB": `4c rekkefølge ${RUN} EN`, nb: `4c rekkefølge ${RUN}`, nn: `4c rekkefølge ${RUN} NN` });
    expect(reordered).not.toBe(stored);
    const id = await ownedCourse({ published: false, title: stored });
    const res = await rename(id, { title: { ...JSON.parse(stored), nb: "Ny rekkefølge" }, expectedTitle: reordered });
    expect(res.status, show(res)).toBe(200);
    expect(res.body).toEqual({ renamedIn: "course" });
  });

  it("feil `expectedTitle`: 409 course_changed, ingenting skrevet", async () => {
    const id = await ownedCourse();
    const before = await prisma.course.findUniqueOrThrow({ where: { id } });
    const res = await rename(id, { title: L("Kapret"), expectedTitle: JSON.stringify(L("Noe annet")) });
    expect(res.status, show(res)).toBe(409);
    expect(res.body.error).toBe("course_changed");
    expect(await prisma.course.findUniqueOrThrow({ where: { id } })).toEqual(before);
    expect(await prisma.courseDraft.count({ where: { courseId: id } })).toBe(0);
  });

  it("uten `expectedTitle`: 400", async () => {
    const id = await ownedCourse();
    const res = await rename(id, { title: L("Uten forventning") });
    expect(res.status, show(res)).toBe(400);
  });

  it("arkivert: 400 course_archived", async () => {
    const id = await ownedCourse({ archivedAt: new Date() });
    const before = await prisma.course.findUniqueOrThrow({ where: { id } });
    const res = await rename(id, { title: L("Arkivert navn"), expectedTitle: before.title });
    expect(res.status, show(res)).toBe(400);
    expect(res.body.error).toBe("course_archived");
  });

  it("en annen produsent og en deltaker: 403", async () => {
    const id = await ownedCourse();
    const before = await prisma.course.findUniqueOrThrow({ where: { id } });
    expect((await rename(id, { title: L("Annen"), expectedTitle: before.title }, OTHER)).status).toBe(403);
    expect((await rename(id, { title: L("Deltaker"), expectedTitle: before.title }, LEARNER)).status).toBe(403);
    expect(await prisma.courseDraft.count({ where: { courseId: id } })).toBe(0);
  });
});
