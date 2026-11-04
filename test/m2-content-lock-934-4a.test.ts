import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { runContentRead, runContentWrite } from "../src/db/contentLock.js";
import { archiveModule } from "../src/modules/adminContent/adminContentCommands.js";
import { courseRepository } from "../src/modules/course/courseRepository.js";
import { getCoursePendingVersions } from "../src/modules/course/coursePublishService.js";
import { readSection } from "./support/participantFlow.js";

// #934 skive 4a (doc/DESIGN_934.md, «4a — innholdslåsen, kursskjemaet og overgangen»):
//   - ÉN lås for alt innhold; alt sjekkes etter den. To samtidige endringer venter på hverandre, og den andre ser
//     det den første gjorde. Ingen 500.
//   - Kursskjemaet lagrer et eksisterende kurs i ÉTT kall med telleren det lastet. Har noen andre lagret siden:
//     409 `course_changed`, og ingenting er skrevet.
//   - En gammel fane (ingen teller) avvises før første skriving.
// Testene går gjennom rutene (supertest), med de feltene klienten sender.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const ADMIN = {
  "x-user-id": "lock-4a-admin",
  "x-user-email": "lock.4a.admin@x.test",
  "x-user-name": "Admin",
  "x-user-roles": "ADMINISTRATOR",
  "x-locale": "nb",
};

let seq = 0;
const tag = (name: string) => `4a ${name} ${RUN}-${seq++}`;

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

/** Et publisert kurs med en modul og en seksjon. */
async function publishedCourse(name: string) {
  const moduleId = await createPublishedModule(tag(`${name} modul`));
  const sectionId = await createPublishedSection(tag(`${name} seksjon`));
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify(L(tag(name))),
      certificationLevel: "basic",
      publishedAt: new Date(),
      slug: `lock-4a-${RUN}-${seq++}`,
      items: {
        create: [
          { itemType: "MODULE", moduleId, sortOrder: 0 },
          { itemType: "SECTION", sectionId, sortOrder: 1 },
        ],
      },
    },
    select: { id: true },
  });
  return { courseId: course.id, moduleId, sectionId };
}

async function detail(courseId: string) {
  const response = await request(app).get(`/api/admin/content/courses/${courseId}`).set(ADMIN);
  expect(response.status).toBe(200);
  return response.body.course as { title: string; contentRevision: number; versionMajor: number; versionMinor: number };
}

async function itemIds(courseId: string) {
  const rows = await prisma.courseItem.findMany({ where: { courseId }, orderBy: { sortOrder: "asc" }, select: { moduleId: true, sectionId: true } });
  return rows.map((row) => row.moduleId ?? row.sectionId);
}

function items(moduleId: string, sectionId: string, extraModuleId?: string) {
  return [
    { type: "MODULE", moduleId },
    { type: "SECTION", sectionId },
    ...(extraModuleId ? [{ type: "MODULE", moduleId: extraModuleId }] : []),
  ];
}

/** Revisjonssporet krever en ekte bruker som aktør. */
async function actorId() {
  const user = await prisma.user.upsert({ where: { externalId: "lock-4a-actor" }, update: {}, create: { externalId: "lock-4a-actor", email: "lock.4a.actor@x.test", name: "Aktør" }, select: { id: true } });
  return user.id;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("#934 skive 4a: telleren — en fane som har stått åpen, skriver ikke over en annens lagring", () => {
  it("kursdetaljen sender telleren, og en lagring øker den", async () => {
    const { courseId, moduleId, sectionId } = await publishedCourse("teller");
    const before = await detail(courseId);
    expect(before.contentRevision).toBe(0);
    const saved = await request(app).put(`/api/admin/content/courses/${courseId}/content`).set(ADMIN).send({
      title: L(tag("teller nytt navn")),
      items: items(moduleId, sectionId),
      expectedRevision: before.contentRevision,
    });
    expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
    expect((await detail(courseId)).contentRevision).toBeGreaterThan(before.contentRevision);
  });

  it("to faner, elementene UENDRET: A lagrer, B får 409 course_changed, og ingenting av B er skrevet", async () => {
    const { courseId, moduleId, sectionId } = await publishedCourse("tofaner-uendret");
    const loaded = (await detail(courseId)).contentRevision;
    const titleA = L(tag("navn fra A"));
    const a = await request(app).put(`/api/admin/content/courses/${courseId}/content`).set(ADMIN).send({
      title: titleA, items: items(moduleId, sectionId), expectedRevision: loaded,
    });
    expect(a.status, JSON.stringify(a.body).slice(0, 300)).toBe(200);
    const afterA = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });

    const b = await request(app).put(`/api/admin/content/courses/${courseId}/content`).set(ADMIN).send({
      title: L(tag("navn fra B")), sortOrder: 7, items: items(moduleId, sectionId), expectedRevision: loaded,
    });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe("course_changed");
    const afterB = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(JSON.parse(afterB.title)).toEqual(titleA);
    expect(afterB.sortOrder).toBe(afterA.sortOrder);
    expect(afterB.contentRevision).toBe(afterA.contentRevision);
    expect({ major: afterB.versionMajor, minor: afterB.versionMinor }).toEqual({ major: afterA.versionMajor, minor: afterA.versionMinor });
  });

  it("to faner, elementene ENDRET: A legger til en modul, B (som ikke så den) får 409, og A sin modul står", async () => {
    const { courseId, moduleId, sectionId } = await publishedCourse("tofaner-endret");
    const extra = await createPublishedModule(tag("ekstra"));
    const loaded = (await detail(courseId)).contentRevision;
    const a = await request(app).put(`/api/admin/content/courses/${courseId}/content`).set(ADMIN).send({
      items: items(moduleId, sectionId, extra), expectedRevision: loaded,
    });
    expect(a.status, JSON.stringify(a.body).slice(0, 300)).toBe(200);
    // B tar ut seksjonen, i en fane som aldri så modulen A la til.
    const b = await request(app).put(`/api/admin/content/courses/${courseId}/content`).set(ADMIN).send({
      items: [{ type: "MODULE", moduleId }], expectedRevision: loaded,
    });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe("course_changed");
    expect(await itemIds(courseId)).toEqual([moduleId, sectionId, extra]);
  });

  it("samtidige lagringer fra samme lastede teller: én vinner, resten får 409 — ingen 500, ingen blanding", async () => {
    const { courseId, moduleId, sectionId } = await publishedCourse("samtidig");
    const loaded = (await detail(courseId)).contentRevision;
    const send = (n: number) => request(app).put(`/api/admin/content/courses/${courseId}/content`).set(ADMIN).send({
      title: L(`samtidig ${n} ${RUN}`), items: items(moduleId, sectionId), expectedRevision: loaded,
    });
    const answers = await Promise.all([1, 2, 3, 4].map(send));
    const statuses = answers.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409]);
    const winner = answers.findIndex((r) => r.status === 200) + 1;
    expect(JSON.parse((await prisma.course.findUniqueOrThrow({ where: { id: courseId } })).title).nb).toBe(`samtidig ${winner} ${RUN}`);
  });
});

describe("#934 skive 4a: gamle faner avvises før første skriving", () => {
  it("den gamle klientens rekkefølge (PUT /:courseId, så PUT …/items med versionAware): første kall gir 409, navnet er uendret", async () => {
    const { courseId, moduleId, sectionId } = await publishedCourse("gammel-fane");
    const before = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    const first = await request(app).put(`/api/admin/content/courses/${courseId}`).set(ADMIN).send({ title: L(tag("gammelt navn")) });
    expect(first.status).toBe(409);
    expect(first.body.error).toBe("course_form_outdated");
    const second = await request(app).put(`/api/admin/content/courses/${courseId}/items`).set(ADMIN).send({
      items: [{ type: "MODULE", moduleId }], versionAware: true,
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("course_form_outdated");
    const after = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(after.title).toBe(before.title);
    expect(after.contentRevision).toBe(before.contentRevision);
    expect({ major: after.versionMajor, minor: after.versionMinor }).toEqual({ major: before.versionMajor, minor: before.versionMinor });
    expect(await itemIds(courseId)).toEqual([moduleId, sectionId]);
  });

  it("PUT …/content uten teller: 409 course_form_outdated, ingenting skrevet", async () => {
    const { courseId, moduleId } = await publishedCourse("content-uten");
    const before = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    const response = await request(app).put(`/api/admin/content/courses/${courseId}/content`).set(ADMIN).send({
      title: L(tag("uten teller")), items: [{ type: "MODULE", moduleId }],
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("course_form_outdated");
    const after = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(after.title).toBe(before.title);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("PUT …/items og legacy PUT …/modules uten teller: avvist for et kurs som har vært ute, også avpublisert", async () => {
    const { courseId, moduleId, sectionId } = await publishedCourse("items-uten");
    await prisma.course.update({ where: { id: courseId }, data: { publishedAt: null } }); // avpublisert, men har delingslenke
    const viaItems = await request(app).put(`/api/admin/content/courses/${courseId}/items`).set(ADMIN).send({ items: [{ type: "MODULE", moduleId }] });
    expect(viaItems.status).toBe(409);
    expect(viaItems.body.error).toBe("course_form_outdated");
    const viaModules = await request(app).put(`/api/admin/content/courses/${courseId}/modules`).set(ADMIN).send({ modules: [{ moduleId, sortOrder: 0 }] });
    expect(viaModules.status).toBe(409);
    expect(viaModules.body.error).toBe("course_form_outdated");
    expect(await itemIds(courseId)).toEqual([moduleId, sectionId]);
  });

  it("PUT …/items uten teller på et utkast som aldri har vært ute (agent-tokenet, nytt kurs fra skjemaet) virker som før", async () => {
    const create = await request(app).post("/api/admin/content/courses").set(ADMIN).send({ title: L(tag("nytt utkast")), certificationLevel: L("basic") });
    expect(create.status).toBe(201);
    const courseId = create.body.course.id as string;
    const moduleId = await createPublishedModule(tag("utkastmodul"));
    const viaItems = await request(app).put(`/api/admin/content/courses/${courseId}/items`).set(ADMIN).send({ items: [{ type: "MODULE", moduleId }] });
    expect(viaItems.status, JSON.stringify(viaItems.body).slice(0, 300)).toBe(204);
    expect(await itemIds(courseId)).toEqual([moduleId]);
    const viaModules = await request(app).put(`/api/admin/content/courses/${courseId}/modules`).set(ADMIN).send({ modules: [{ moduleId, sortOrder: 0 }] });
    expect(viaModules.status).toBe(204);
    expect((await detail(courseId)).contentRevision).toBe(2);
  });

  it("med teller går PUT …/items og PUT /:courseId gjennom også på et publisert kurs, og en utdatert teller gir 409", async () => {
    const { courseId, moduleId, sectionId } = await publishedCourse("items-med");
    const loaded = (await detail(courseId)).contentRevision;
    const ok = await request(app).put(`/api/admin/content/courses/${courseId}/items`).set(ADMIN).send({
      items: [{ type: "SECTION", sectionId }, { type: "MODULE", moduleId }], expectedRevision: loaded,
    });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(204);
    const stale = await request(app).put(`/api/admin/content/courses/${courseId}`).set(ADMIN).send({ sortOrder: 3, expectedRevision: loaded });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("course_changed");
    const fresh = await request(app).put(`/api/admin/content/courses/${courseId}`).set(ADMIN).send({ sortOrder: 3, expectedRevision: loaded + 1 });
    expect(fresh.status, JSON.stringify(fresh.body).slice(0, 300)).toBe(200);
    expect((await prisma.course.findUniqueOrThrow({ where: { id: courseId } })).sortOrder).toBe(3);
  });

  it("versionAware betyr ingenting lenger: uten svar avvises endringen når noen har kursbevis", async () => {
    const { courseId, moduleId, sectionId } = await publishedCourse("overgang-borte");
    const user = await prisma.user.create({ data: { externalId: `lock-4a-${RUN}-${seq++}`, email: `lock.4a.${RUN}.${seq++}@x.test`, name: "Bevis" }, select: { id: true } });
    await prisma.courseCompletion.create({ data: { userId: user.id, courseId, moduleSnapshotJson: JSON.stringify([moduleId]) } });
    const loaded = (await detail(courseId)).contentRevision;
    const response = await request(app).put(`/api/admin/content/courses/${courseId}/items`).set(ADMIN).send({
      items: [{ type: "MODULE", moduleId }], versionAware: true, expectedRevision: loaded,
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("course_version_required");
    expect(await itemIds(courseId)).toEqual([moduleId, sectionId]);
  });
});

describe("#934 skive 4a: innholdslåsen — samtidige endringer venter på hverandre", () => {
  it("arkivering mot innlegging: den ene venter på den andre, og en arkivert modul havner aldri i et kurs", async () => {
    const { courseId, moduleId, sectionId } = await publishedCourse("arkiv-mot-innlegg");
    const target = await createPublishedModule(tag("arkiveres eller legges inn"));
    const loaded = (await detail(courseId)).contentRevision;
    // Hold låsen litt, så begge står i kø bak den og kommer etter hverandre.
    const holder = runContentWrite(() => pause(400));
    await pause(50);
    const archive = archiveModule(target, await actorId()).then(() => "ok", (error: unknown) => (error as Error).message);
    await pause(20);
    const attach = request(app).put(`/api/admin/content/courses/${courseId}/content`).set(ADMIN).send({
      items: items(moduleId, sectionId, target), expectedRevision: loaded,
    });
    const [, archived, attached] = await Promise.all([holder, archive, attach]);
    expect(attached.status).not.toBe(500);
    const module = await prisma.module.findUniqueOrThrow({ where: { id: target }, select: { archivedAt: true } });
    const inCourse = (await itemIds(courseId)).includes(target);
    // Arkiveringen kom først (den sto først i køen): innleggingen ser at modulen er arkivert og avvises.
    expect(archived).toBe("ok");
    expect(module.archivedAt).not.toBeNull();
    expect(attached.status).toBe(400);
    expect(attached.body.error).toBe("course_item_archived");
    expect(inCourse).toBe(false);
  });

  it("innlegging mot arkivering, motsatt rekkefølge: modulen ligger i kurset, og arkiveringen avvises (G2)", async () => {
    const { courseId, moduleId, sectionId } = await publishedCourse("innlegg-mot-arkiv");
    const target = await createPublishedModule(tag("legges inn først"));
    const loaded = (await detail(courseId)).contentRevision;
    const holder = runContentWrite(() => pause(400));
    await pause(50);
    const attach = request(app).put(`/api/admin/content/courses/${courseId}/content`).set(ADMIN).send({
      items: items(moduleId, sectionId, target), expectedRevision: loaded,
    }).then((r) => r);
    await pause(150);
    const archive = archiveModule(target, await actorId()).then(() => "ok", (error: unknown) => (error as { code?: string }).code ?? (error as Error).message);
    const [, attached, archived] = await Promise.all([holder, attach, archive]);
    expect(attached.status, JSON.stringify(attached.body).slice(0, 300)).toBe(200);
    expect(archived).toBe("content_in_use");
    expect((await itemIds(courseId)).includes(target)).toBe(true);
    expect((await prisma.module.findUniqueOrThrow({ where: { id: target }, select: { archivedAt: true } })).archivedAt).toBeNull();
  });

  it("sletting med alt innhold etter en utdatert forhåndsvisning: en delt seksjon som nå bare er i kurset, slettes ikke (409)", async () => {
    const a = await publishedCourse("kaskade-a");
    const b = await publishedCourse("kaskade-b");
    // Seksjonen til A ligger også i B, så forhåndsvisningen sier «spares».
    await prisma.courseItem.create({ data: { courseId: b.courseId, itemType: "SECTION", sectionId: a.sectionId, sortOrder: 5 } });
    await prisma.course.update({ where: { id: a.courseId }, data: { publishedAt: null } });
    const preview = await request(app).get(`/api/admin/content/courses/${a.courseId}/cascade-delete-preview`).set(ADMIN);
    expect(preview.status).toBe(200);
    expect(preview.body.sparedSections.map((s: { id: string }) => s.id)).toContain(a.sectionId);
    const expected = {
      expectedDeletedModuleIds: preview.body.deletableModules.map((m: { id: string }) => m.id),
      expectedDeletedSectionIds: preview.body.deletableSections.map((s: { id: string }) => s.id),
    };
    // Så tas seksjonen ut av B. Nå ville kaskaden slettet den.
    const bLoaded = (await detail(b.courseId)).contentRevision;
    const detach = await request(app).put(`/api/admin/content/courses/${b.courseId}/content`).set(ADMIN).send({
      items: items(b.moduleId, b.sectionId), expectedRevision: bLoaded,
    });
    expect(detach.status, JSON.stringify(detach.body).slice(0, 300)).toBe(200);

    const run = await request(app).post(`/api/admin/content/courses/${a.courseId}/cascade-delete`).set(ADMIN).send(expected);
    expect(run.status).toBe(409);
    expect(run.body.error).toBe("course_cascade_changed");
    expect(await prisma.course.findUnique({ where: { id: a.courseId } })).not.toBeNull();
    expect(await prisma.courseSection.findUnique({ where: { id: a.sectionId } })).not.toBeNull();
  });

  it("sletting med alt innhold mot at seksjonen tas ut av det andre kurset, samtidig: ingen 500, og utfallet er et av de to rekkefølgene", async () => {
    const a = await publishedCourse("kaskade-samtidig-a");
    const b = await publishedCourse("kaskade-samtidig-b");
    await prisma.courseItem.create({ data: { courseId: b.courseId, itemType: "SECTION", sectionId: a.sectionId, sortOrder: 5 } });
    await prisma.course.update({ where: { id: a.courseId }, data: { publishedAt: null } });
    const bLoaded = (await detail(b.courseId)).contentRevision;
    // Det administratoren så: seksjonen spares (den er delt).
    const preview = await request(app).get(`/api/admin/content/courses/${a.courseId}/cascade-delete-preview`).set(ADMIN);
    const expected = {
      expectedDeletedModuleIds: preview.body.deletableModules.map((m: { id: string }) => m.id),
      expectedDeletedSectionIds: preview.body.deletableSections.map((s: { id: string }) => s.id),
    };
    const holder = runContentWrite(() => pause(300));
    await pause(50);
    const run = request(app).post(`/api/admin/content/courses/${a.courseId}/cascade-delete`).set(ADMIN).send(expected);
    const detach = request(app).put(`/api/admin/content/courses/${b.courseId}/content`).set(ADMIN).send({
      items: items(b.moduleId, b.sectionId), expectedRevision: bLoaded,
    });
    const [, ran, detached] = await Promise.all([holder, run, detach]);
    expect(detached.status).toBe(200);
    // Hvem som fikk låsen først, er ikke gitt. Utfallet skal være det ene av de to rekkefølgene, helt:
    //   - kaskaden først: seksjonen var delt og ble spart, kurset A er slettet; så tok B den ut. Seksjonen står;
    //   - uttaket først: seksjonen ble eksklusiv for A, så forhåndsvisningen stemmer ikke lenger — 409, ingenting
    //     slettet. Ingen av rekkefølgene sletter en seksjon administratoren så som «spares».
    expect(await prisma.courseSection.findUnique({ where: { id: a.sectionId } })).not.toBeNull();
    if (ran.status === 200) {
      expect(ran.body.sparedSectionIds).toContain(a.sectionId);
      expect(await prisma.course.findUnique({ where: { id: a.courseId } })).toBeNull();
    } else {
      expect(ran.status).toBe(409);
      expect(ran.body.error).toBe("course_cascade_changed");
      expect(await prisma.course.findUnique({ where: { id: a.courseId } })).not.toBeNull();
    }
  });

  it("sletting med alt innhold uten det forhåndsvisningen viste (eldre fane): 409 course_form_outdated, ingenting slettet", async () => {
    const a = await publishedCourse("kaskade-uten");
    await prisma.course.update({ where: { id: a.courseId }, data: { publishedAt: null } });
    const run = await request(app).post(`/api/admin/content/courses/${a.courseId}/cascade-delete`).set(ADMIN).send({});
    expect(run.status).toBe(409);
    expect(run.body.error).toBe("course_form_outdated");
    expect(await prisma.course.findUnique({ where: { id: a.courseId } })).not.toBeNull();
    expect(await prisma.courseSection.findUnique({ where: { id: a.sectionId } })).not.toBeNull();
  });

  it("to «Publiser kurs» av to kurs som deler et upublisert element: ingen 500 (kjent hull 3 etter 2.129.0)", async () => {
    const shared = await prisma.courseSection.create({ data: { title: JSON.stringify(L(tag("delt utkast"))) }, select: { id: true } });
    await prisma.courseSectionVersion.create({ data: { sectionId: shared.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Utkast.")) } });
    const courses: string[] = [];
    for (const name of ["pub-a", "pub-b"]) {
      const moduleId = await createPublishedModule(tag(`${name} modul`));
      const course = await prisma.course.create({
        data: {
          title: JSON.stringify(L(tag(name))),
          certificationLevel: "basic",
          items: { create: [{ itemType: "MODULE", moduleId, sortOrder: 0 }, { itemType: "SECTION", sectionId: shared.id, sortOrder: 1 }] },
        },
        select: { id: true },
      });
      courses.push(course.id);
    }
    const answers = await Promise.all(courses.map((id) => request(app).post(`/api/admin/content/courses/${id}/publish`).set(ADMIN).send({ publishItems: true })));
    for (const answer of answers) expect([200, 409], JSON.stringify(answer.body).slice(0, 300)).toContain(answer.status);
    expect(answers.some((answer) => answer.status === 200)).toBe(true);
    const section = await prisma.courseSection.findUniqueOrThrow({ where: { id: shared.id }, select: { activeVersionId: true } });
    expect(section.activeVersionId).not.toBeNull();
    // Et kurs som svarte 409, er ikke publisert halvveis.
    for (const [index, id] of courses.entries()) {
      const row = await prisma.course.findUniqueOrThrow({ where: { id }, select: { publishedAt: true } });
      expect(row.publishedAt != null).toBe(answers[index].status === 200);
    }
  });

  it("«Publiser kurs» med utkast: en ny versjon lagret mens publiseringen venter på låsen, publiseres ikke (409)", async () => {
    const moduleId = await createPublishedModule(tag("kaskade-versjon modul"));
    const draft = await prisma.courseSection.create({ data: { title: JSON.stringify(L(tag("kaskade-versjon utkast"))) }, select: { id: true } });
    await prisma.courseSectionVersion.create({ data: { sectionId: draft.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Det forfatteren så.")) } });
    const course = await prisma.course.create({
      data: {
        title: JSON.stringify(L(tag("kaskade-versjon"))),
        certificationLevel: "basic",
        items: { create: [{ itemType: "MODULE", moduleId, sortOrder: 0 }, { itemType: "SECTION", sectionId: draft.id, sortOrder: 1 }] },
      },
      select: { id: true },
    });
    const holder = runContentWrite(async (tx) => {
      await pause(400);
      await tx.courseSectionVersion.create({ data: { sectionId: draft.id, versionNo: 2, bodyMarkdown: JSON.stringify(L("Noe ingen har sett.")) } });
    });
    await pause(50);
    const publish = request(app).post(`/api/admin/content/courses/${course.id}/publish`).set(ADMIN).send({ publishItems: true });
    const [, answer] = await Promise.all([holder, publish]);
    expect(answer.status, JSON.stringify(answer.body).slice(0, 300)).toBe(409);
    expect(answer.body.error).toBe("course_publish_items_changed");
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: draft.id } })).activeVersionId).toBeNull();
    expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).publishedAt).toBeNull();
  });

  it("«Publiser kurs» uten upubliserte elementer ser etter på nytt etter låsen: et utkast lagt inn i mellomtiden gir 409 og spørsmålet", async () => {
    const moduleId = await createPublishedModule(tag("plain modul"));
    const course = await prisma.course.create({
      data: { title: JSON.stringify(L(tag("plain"))), certificationLevel: "basic", items: { create: [{ itemType: "MODULE", moduleId, sortOrder: 0 }] } },
      select: { id: true },
    });
    const draft = await prisma.courseSection.create({ data: { title: JSON.stringify(L(tag("plain utkast"))) }, select: { id: true } });
    await prisma.courseSectionVersion.create({ data: { sectionId: draft.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Utkast.")) } });
    // Låsen holdes; publiseringen beregner forhåndsvisningen (alt publisert) og står så i kø. Mens den står, legges
    // utkastet inn — av en skriver som var først i køen.
    const holder = runContentWrite(async (tx) => {
      await pause(300);
      await tx.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: draft.id, sortOrder: 1 } });
    });
    await pause(50);
    const publish = request(app).post(`/api/admin/content/courses/${course.id}/publish`).set(ADMIN).send({});
    const [, answer] = await Promise.all([holder, publish]);
    expect(answer.status, JSON.stringify(answer.body).slice(0, 300)).toBe(409);
    expect(answer.body.error).toBe("course_has_unpublished_items");
    expect(answer.body.unpublishedItems.map((i: { id: string }) => i.id)).toEqual([draft.id]);
    expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).publishedAt).toBeNull();
  });

  it("kalibrering mot en ny versjon: kalibreringen kloner versjonen som er aktiv ETTER låsen, ikke den den så før", async () => {
    const { courseId, moduleId } = await publishedCourse("kalibrering");
    const active = await prisma.module.findUniqueOrThrow({ where: { id: moduleId }, select: { activeVersionId: true } });
    const base = await prisma.moduleVersion.findUniqueOrThrow({ where: { id: active.activeVersionId! } });
    // En ny versjon publiseres mens kalibreringen står i kø.
    const holder = runContentWrite(async (tx) => {
      await pause(300);
      const v2 = await tx.moduleVersion.create({
        data: {
          moduleId, versionNo: 2, taskText: JSON.stringify(L("Ny oppgave")), assessorExpectedContent: base.assessorExpectedContent,
          rubricVersionId: base.rubricVersionId, promptTemplateVersionId: base.promptTemplateVersionId, mcqSetVersionId: base.mcqSetVersionId,
          publishedAt: new Date(),
        },
        select: { id: true },
      });
      await tx.module.update({ where: { id: moduleId }, data: { activeVersionId: v2.id } });
    });
    await pause(50);
    const calibrate = request(app).post("/api/calibration/workspace/publish-thresholds").set(ADMIN).send({ moduleId, totalMin: 55 });
    const [, answer] = await Promise.all([holder, calibrate]);
    expect(answer.status, JSON.stringify(answer.body).slice(0, 300)).toBe(200);
    const newest = await prisma.moduleVersion.findFirstOrThrow({ where: { moduleId }, orderBy: { versionNo: "desc" } });
    expect(newest.versionNo).toBe(3);
    expect(JSON.parse(newest.taskText!).nb).toBe("Ny oppgave");
    expect((await prisma.module.findUniqueOrThrow({ where: { id: moduleId } })).activeVersionId).toBe(newest.id);
    expect(courseId).toBeTruthy();
  });

  it("en lesing venter høyst noen sekunder på en som skriver innhold, og svarer så 503 content_busy (ikke 500)", async () => {
    const { courseId, sectionId } = await publishedCourse("lesing-venter");
    const suffix = `${RUN}-${seq++}`;
    const headers = {
      "x-user-id": `lock-4a-p-${suffix}`,
      "x-user-email": `lock.4a.p.${suffix}@x.test`,
      "x-user-name": "Deltaker",
      "x-user-department": "Learning",
      "x-user-roles": "PARTICIPANT",
      "x-locale": "nb",
    };
    const holder = runContentWrite(() => pause(4_500), { timeout: 10_000 });
    await pause(100);
    const read = await readSection(app, headers, courseId, sectionId);
    await holder;
    expect(read.status).toBe(503);
    expect(read.body.error).toBe("content_busy");
    // Etterpå går den gjennom.
    const again = await readSection(app, headers, courseId, sectionId);
    expect(again.status).toBe(204);
  }, 20_000);

  it("«Oppdater dette kurset» (import) mot en lagring som kom mens fila ble forberedt: 409, og den andres element står", async () => {
    const s1 = await createPublishedSection(tag("import s1"));
    const s2 = await createPublishedSection(tag("import s2"));
    const s3 = await createPublishedSection(tag("import s3"));
    const course = await prisma.course.create({
      data: {
        title: JSON.stringify(L(tag("import-kurs"))),
        certificationLevel: "basic",
        publishedAt: new Date(),
        slug: `lock-4a-import-${RUN}-${seq++}`,
        items: { create: [{ itemType: "SECTION", sectionId: s1, sortOrder: 0 }, { itemType: "SECTION", sectionId: s2, sortOrder: 1 }] },
      },
      select: { id: true },
    });
    const exported = await request(app).get(`/api/admin/content/courses/${course.id}/export-package`).set(ADMIN);
    expect(exported.status, JSON.stringify(exported.body).slice(0, 300)).toBe(200);
    const envelope = exported.body.envelope ?? exported.body;
    // En annen forfatter legger inn en seksjon mens importen planlegger (planen ser bare s1 og s2).
    const holder = runContentWrite(async (tx) => {
      await pause(700);
      await tx.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: s3, sortOrder: 2 } });
    });
    await pause(50);
    const imported = request(app).post("/api/admin/content/courses/import").set(ADMIN).send({ payload: envelope, mode: "updateExisting", targetId: course.id });
    const [, answer] = await Promise.all([holder, imported]);
    expect(answer.status, JSON.stringify(answer.body).slice(0, 300)).toBe(409);
    expect(answer.body.error).toBe("import_target_changed");
    // Planen ville tatt ut s3 (fila kjenner den ikke). Den står.
    expect(await itemIds(course.id)).toEqual([s1, s2, s3]);
  });

  it("«Oppdater dette kurset»: en lagring rett etter at planen leste elementene, gir 409, og ingenting tas ut (QA-porten runde 3)", async () => {
    const s1 = await createPublishedSection(tag("plan s1"));
    const s2 = await createPublishedSection(tag("plan s2"));
    const course = await prisma.course.create({
      data: {
        title: JSON.stringify(L(tag("plan-kurs"))),
        certificationLevel: "basic",
        publishedAt: new Date(),
        slug: `lock-4a-plan-${RUN}-${seq++}`,
        items: { create: [{ itemType: "SECTION", sectionId: s1, sortOrder: 0 }] },
      },
      select: { id: true },
    });
    const exported = await request(app).get(`/api/admin/content/courses/${course.id}/export-package`).set(ADMIN);
    expect(exported.status, JSON.stringify(exported.body).slice(0, 300)).toBe(200);
    const envelope = exported.body.envelope ?? exported.body;
    // Akkurat i åpningen: planen har lest elementene (bare s1), og så legger noen inn s2.
    const original = courseRepository.findAllCourseItems.bind(courseRepository);
    const spy = vi.spyOn(courseRepository, "findAllCourseItems").mockImplementationOnce((async (courseId: string) => {
      const seen = await original(courseId);
      await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: s2, sortOrder: 1 } });
      return seen;
    }) as never);
    const answer = await request(app).post("/api/admin/content/courses/import").set(ADMIN).send({ payload: envelope, mode: "updateExisting", targetId: course.id });
    spy.mockRestore();
    expect(answer.status, JSON.stringify(answer.body).slice(0, 300)).toBe(409);
    expect(answer.body.error).toBe("import_target_changed");
    expect(await itemIds(course.id)).toEqual([s1, s2]);
  });

  it("«nye versjoner» inne i låsen slår opp eierskapet på transaksjonen, ikke på en egen tilkobling (QA-porten runde 3)", async () => {
    const s1 = await createPublishedSection(tag("eier s1"));
    const course = await prisma.course.create({
      data: {
        title: JSON.stringify(L(tag("eier-kurs"))),
        certificationLevel: "basic",
        publishedAt: new Date(),
        slug: `lock-4a-eier-${RUN}-${seq++}`,
        items: { create: [{ itemType: "SECTION", sectionId: s1, sortOrder: 0 }] },
      },
      select: { id: true },
    });
    // Ingen `mockRestore`: på en Prisma-modell fjerner den funksjonen. Spionen går rett gjennom.
    const spy = vi.spyOn(prisma.contentOwner, "findMany");
    const before = spy.mock.calls.length;
    await runContentRead((tx) => getCoursePendingVersions(course.id, { userId: "lock-4a-forfatter", roles: ["SUBJECT_MATTER_OWNER"] }, tx));
    expect(spy.mock.calls.length - before).toBe(0);
  });

  it("«Oppdater dette kurset» mot en lagring som bare endret navnet: 409, og navnet fra skjemaet står (QA-porten runde 2)", async () => {
    const s1 = await createPublishedSection(tag("import-navn s1"));
    const course = await prisma.course.create({
      data: {
        title: JSON.stringify(L(tag("import-navn"))),
        certificationLevel: "basic",
        publishedAt: new Date(),
        slug: `lock-4a-import-navn-${RUN}-${seq++}`,
        items: { create: [{ itemType: "SECTION", sectionId: s1, sortOrder: 0 }] },
      },
      select: { id: true },
    });
    const exported = await request(app).get(`/api/admin/content/courses/${course.id}/export-package`).set(ADMIN);
    expect(exported.status, JSON.stringify(exported.body).slice(0, 300)).toBe(200);
    const envelope = exported.body.envelope ?? exported.body;
    const nyttNavn = L(tag("navn fra skjemaet"));
    const loaded = (await detail(course.id)).contentRevision;
    // Skjemaets lagring står i kø bak en annen skriver; importen planlegger i mellomtiden.
    const holder = runContentWrite(() => pause(500));
    await pause(50);
    // Skjemaet står først i køen; importen planlegger mens begge venter (planen ser navnet fra før).
    const saved = request(app).put(`/api/admin/content/courses/${course.id}/content`).set(ADMIN).send({
      title: nyttNavn, items: [{ type: "SECTION", sectionId: s1 }], expectedRevision: loaded,
    }).then((r) => r);
    await pause(100);
    const imported = request(app).post("/api/admin/content/courses/import").set(ADMIN).send({ payload: envelope, mode: "updateExisting", targetId: course.id });
    const [, saveAnswer, importAnswer] = await Promise.all([holder, saved, imported]);
    // Hvem som fikk låsen først, er ikke gitt; ingen skriver over den andre.
    const title = JSON.parse((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).title);
    if (saveAnswer.status === 200) {
      expect(importAnswer.status, JSON.stringify(importAnswer.body).slice(0, 300)).toBe(409);
      expect(importAnswer.body.error).toBe("import_target_changed");
      expect(title).toEqual(nyttNavn);
    } else {
      expect(importAnswer.status).toBe(201);
      expect(saveAnswer.status).toBe(409);
      expect(saveAnswer.body.error).toBe("course_changed");
    }
  });

  it("en skriver som gir opp bak låsen, får 503 content_busy gjennom modulrutene — ikke en valideringsfeil", async () => {
    const holder = runContentWrite(() => pause(16_500), { timeout: 30_000 });
    await pause(100);
    const create = await request(app).post("/api/admin/content/modules").set(ADMIN).send({ title: L(tag("venter")), certificationLevel: L("basic") });
    await holder;
    expect(create.status, JSON.stringify(create.body).slice(0, 300)).toBe(503);
    expect(create.body.error).toBe("content_busy");
  }, 40_000);

  it("en innholdstransaksjon inne i en annen stopper med én gang (ellers ville den ventet på sin egen lås)", async () => {
    const started = Date.now();
    await expect(runContentWrite(() => runContentWrite(async () => "inne"))).rejects.toThrow(/inside another/);
    await expect(runContentWrite(() => runContentRead(async () => "inne"))).rejects.toThrow(/inside another/);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
