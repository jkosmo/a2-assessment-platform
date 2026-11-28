// #1169 skive 4b (doc/design/PLAN_1169_4B_DUPLISER_KURS.md; produkteier 26.11.2026, doc/DECISIONS.md punkt 2): «Dupliser kurs» er
// et NYTT kurs med DE SAMME modulene og seksjonene. Gjennom ruta (supertest):
//   - kopien: samme elementer i samme rekkefølge med samme `discussionsEnabled`, « (kopi)» på hvert språk, begrenset, upublisert,
//     v1.0, ingen slug og ingen fast plass, temaene med, den som kopierer eneste eier, revisjonsloggen sier hvilket kurs;
//   - ikke med: eierne, klasser, påmeldinger, kursbevis, versjonsrader; kilden er urørt;
//   - hvem: en annen produsent kan duplisere (lesing er åpen, #1165); en deltaker kommer ikke inn;
//   - nei: arkivert kilde (400 course_archived), et arkivert element (400 course_item_archived) — og da er INGENTING laget; 404;
//   - idempotens: samme nøkkel gir ett kurs, og samme nøkkel for to ulike kilder gir to kopier (#906).
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
    "x-forwarded-for": `10.116.9.${seq}`,
  };
};
const OWNER = person("1169-eier", "SUBJECT_MATTER_OWNER");
const OTHER = person("1169-annen", "SUBJECT_MATTER_OWNER");
const LEARNER = person("1169-deltaker", "PARTICIPANT");

let moduleA = "";
let moduleB = "";
let section = "";
let themeId = "";
let sourceId = "";

async function userId(headers: Record<string, string>) {
  await request(app).get("/api/me").set(headers);
  return (await prisma.user.findUniqueOrThrow({ where: { externalId: headers["x-user-id"] }, select: { id: true } })).id;
}

async function createCourseRow(extra: Record<string, unknown> = {}) {
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify(L(`1169 kurs ${RUN}-${seq++}`)),
      description: JSON.stringify(L("Beskrivelse")),
      certificationLevel: JSON.stringify(L("basic")),
      enrollmentPolicy: "OPEN",
      discussionsEnabled: false,
      discussionOwnerNotifications: false,
      publishedAt: new Date(),
      slug: `kurs-1169-${RUN}-${seq++}`,
      sortOrder: 3,
      versionMajor: 3,
      versionMinor: 2,
      items: {
        create: [
          { itemType: "SECTION", sectionId: section, sortOrder: 0, discussionsEnabled: true },
          { itemType: "MODULE", moduleId: moduleB, sortOrder: 1, discussionsEnabled: false },
          { itemType: "MODULE", moduleId: moduleA, sortOrder: 2, discussionsEnabled: true },
        ],
      },
      ...extra,
    },
    select: { id: true },
  });
  return course.id;
}

beforeAll(async () => {
  moduleA = (await prisma.module.create({ data: { title: JSON.stringify(L(`1169 modul A ${RUN}`)) }, select: { id: true } })).id;
  moduleB = (await prisma.module.create({ data: { title: JSON.stringify(L(`1169 modul B ${RUN}`)) }, select: { id: true } })).id;
  section = (await prisma.courseSection.create({ data: { title: JSON.stringify(L(`1169 seksjon ${RUN}`)) }, select: { id: true } })).id;
  themeId = (await prisma.courseTheme.create({ data: { name: JSON.stringify(L(`1169 tema ${RUN}`)) }, select: { id: true } })).id;
  sourceId = await createCourseRow();
  await prisma.courseThemeAssignment.create({ data: { courseId: sourceId, themeId } });
  await prisma.contentOwner.create({ data: { contentType: "COURSE", contentId: sourceId, userId: await userId(OWNER) } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function itemsOf(courseId: string) {
  return prisma.courseItem.findMany({ where: { courseId }, orderBy: { sortOrder: "asc" }, select: { itemType: true, moduleId: true, sectionId: true, sortOrder: true, discussionsEnabled: true } });
}

describe("#1169 skive 4b — «Dupliser kurs»", () => {
  it("kopien har de samme elementene i samme rekkefølge, « (kopi)», og er et nytt, upublisert, begrenset kurs eid av den som kopierte", async () => {
    const before = await prisma.course.findUniqueOrThrow({ where: { id: sourceId } });
    const sourceItems = await itemsOf(sourceId);
    const res = await request(app).post(`${C}/${sourceId}/duplicate`).set(OTHER);
    expect(res.status, show(res)).toBe(201);
    const copyId: string = res.body.course.id;
    expect(copyId).not.toBe(sourceId);
    expect(res.body.links).toBeTruthy();

    const copy = await prisma.course.findUniqueOrThrow({ where: { id: copyId } });
    expect(JSON.parse(copy.title)).toEqual({ "en-GB": `${JSON.parse(before.title)["en-GB"]} (kopi)`, nb: `${JSON.parse(before.title).nb} (kopi)`, nn: `${JSON.parse(before.title).nn} (kopi)` });
    expect(copy.description).toBe(before.description);
    expect(copy.certificationLevel).toBe(before.certificationLevel);
    expect(copy.discussionsEnabled).toBe(false);
    expect(copy.discussionOwnerNotifications).toBe(false);
    expect(copy).toMatchObject({ enrollmentPolicy: "RESTRICTED", publishedAt: null, archivedAt: null, slug: null, sortOrder: null, versionMajor: 1, versionMinor: 0 });
    // Telleren er økt én gang, da elementene ble skrevet.
    expect(copy.contentRevision).toBe(1);
    expect(res.body.course.contentRevision).toBe(1);

    // De SAMME modulene og seksjonene, samme rekkefølge og `discussionsEnabled`.
    expect(await itemsOf(copyId)).toEqual(sourceItems);
    // Temaene er med.
    expect((await prisma.courseThemeAssignment.findMany({ where: { courseId: copyId }, select: { themeId: true } })).map((r) => r.themeId)).toEqual([themeId]);
    // Eneste eier: den som kopierte. Kildens eier er ikke med.
    const owners = await prisma.contentOwner.findMany({ where: { contentType: "COURSE", contentId: copyId }, select: { userId: true } });
    expect(owners).toEqual([{ userId: await userId(OTHER) }]);
    // Ingenting annet følger med.
    expect(await prisma.courseGroupAssignment.count({ where: { courseId: copyId } })).toBe(0);
    expect(await prisma.courseEnrollment.count({ where: { courseId: copyId } })).toBe(0);
    expect(await prisma.courseCompletion.count({ where: { courseId: copyId } })).toBe(0);
    expect(await prisma.courseVersion.count({ where: { courseId: copyId } })).toBe(0);
    // Revisjonsloggen sier hvilket kurs det er en kopi av.
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: copyId, action: "course_duplicated" } });
    expect(audit, "course_duplicated mangler").toBeTruthy();
    expect(JSON.parse(audit!.metadataJson)).toMatchObject({ courseId: copyId, sourceCourseId: sourceId, itemCount: 3 });

    // Kilden er urørt.
    const after = await prisma.course.findUniqueOrThrow({ where: { id: sourceId } });
    expect(after).toEqual(before);
    expect(await itemsOf(sourceId)).toEqual(sourceItems);
  });

  it("en deltaker kommer ikke inn, og et kurs som ikke finnes, gir 404", async () => {
    expect((await request(app).post(`${C}/${sourceId}/duplicate`).set(LEARNER)).status).toBe(403);
    expect((await request(app).post(`${C}/finnes-ikke-${RUN}/duplicate`).set(OTHER)).status).toBe(404);
  });

  it("arkivert kilde: 400 course_archived, og ingen kopi er laget", async () => {
    const archived = await createCourseRow({ archivedAt: new Date(), publishedAt: null, slug: null });
    // Telles bare det denne fila lager: de parallelle integrasjonskjøringene lager kurs samtidig.
    const mine = () => prisma.course.count({ where: { title: { contains: RUN } } });
    const coursesBefore = await mine();
    const res = await request(app).post(`${C}/${archived}/duplicate`).set(OWNER);
    expect(res.status, show(res)).toBe(400);
    expect(res.body.error).toBe("course_archived");
    expect(await mine()).toBe(coursesBefore);
  });

  it("et arkivert element: 400 course_item_archived, og ingenting er laget (én transaksjon)", async () => {
    const archivedModule = (await prisma.module.create({ data: { title: JSON.stringify(L(`1169 arkivert modul ${RUN}`)), archivedAt: new Date() }, select: { id: true } })).id;
    const withArchivedItem = await createCourseRow({
      slug: null,
      publishedAt: null,
      items: { create: [{ itemType: "MODULE", moduleId: moduleA, sortOrder: 0 }, { itemType: "MODULE", moduleId: archivedModule, sortOrder: 1 }] },
    });
    const mine = () => prisma.course.count({ where: { title: { contains: RUN } } });
    const ownerId = await userId(OWNER);
    const myOwnerships = () => prisma.contentOwner.count({ where: { userId: ownerId } });
    const coursesBefore = await mine();
    const ownersBefore = await myOwnerships();
    const res = await request(app).post(`${C}/${withArchivedItem}/duplicate`).set(OWNER);
    expect(res.status, show(res)).toBe(400);
    expect(res.body.error).toBe("course_item_archived");
    expect(await mine()).toBe(coursesBefore);
    expect(await myOwnerships()).toBe(ownersBefore);
  });

  it("idempotens: samme nøkkel gir ett kurs; samme nøkkel for to ulike kilder gir to kopier", async () => {
    const key = `dup-1169-${RUN}`;
    const first = await request(app).post(`${C}/${sourceId}/duplicate`).set({ ...OWNER, "Idempotency-Key": key });
    const again = await request(app).post(`${C}/${sourceId}/duplicate`).set({ ...OWNER, "Idempotency-Key": key });
    expect(first.status, show(first)).toBe(201);
    expect(again.body.course.id).toBe(first.body.course.id);
    const otherSource = await createCourseRow();
    const second = await request(app).post(`${C}/${otherSource}/duplicate`).set({ ...OWNER, "Idempotency-Key": key });
    expect(second.status, show(second)).toBe(201);
    expect(second.body.course.id).not.toBe(first.body.course.id);
    expect(await itemsOf(second.body.course.id)).toEqual(await itemsOf(otherSource));
  });
});
