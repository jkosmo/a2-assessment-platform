import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
  "x-user-department": "Consulting",
  "x-user-roles": "PARTICIPANT",
};

async function createPublishedModule(title: string) {
  const sourceModuleVersion = await prisma.moduleVersion.findFirst({
    where: {
      module: { activeVersionId: { not: null } },
    },
    select: {
      rubricVersionId: true,
      promptTemplateVersionId: true,
      mcqSetVersionId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  expect(sourceModuleVersion).toBeTruthy();

  const module = await prisma.module.create({
    data: { title },
    select: { id: true },
  });

  const moduleVersion = await prisma.moduleVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      taskText: `${title} task text`,
      assessorExpectedContent: `${title} guidance text`,
      rubricVersionId: sourceModuleVersion!.rubricVersionId,
      promptTemplateVersionId: sourceModuleVersion!.promptTemplateVersionId,
      mcqSetVersionId: sourceModuleVersion!.mcqSetVersionId,
      publishedAt: new Date(),
    },
    select: {
      id: true,
      rubricVersionId: true,
      promptTemplateVersionId: true,
    },
  });

  await prisma.module.update({
    where: { id: module.id },
    data: { activeVersionId: moduleVersion.id },
  });

  return { module, moduleVersion };
}

describe("Participant courses API", () => {
  it("surfaces in-progress course status and actionable module state for started modules", async () => {
    const participant = await prisma.user.findUnique({
      where: { externalId: "participant-1" },
      select: { id: true },
    });
    expect(participant).toBeTruthy();

    const startedModule = await createPublishedModule(`Course Started Module ${Date.now()}`);
    const passedModule = await createPublishedModule(`Course Passed Module ${Date.now()}`);

    const startedSubmission = await prisma.submission.create({
      data: {
        userId: participant!.id,
        moduleId: startedModule.module.id,
        moduleVersionId: startedModule.moduleVersion.id,
        deliveryType: "text",
        responseJson: JSON.stringify({
          response: "Started course module response.",
          reflection: "Started course module reflection.",
          promptExcerpt: "Started course module prompt excerpt.",
        }),
        submissionStatus: "SUBMITTED",
      },
      select: { id: true },
    });
    expect(startedSubmission.id).toBeTruthy();

    const passedSubmission = await prisma.submission.create({
      data: {
        userId: participant!.id,
        moduleId: passedModule.module.id,
        moduleVersionId: passedModule.moduleVersion.id,
        deliveryType: "text",
        responseJson: JSON.stringify({
          response: "Passed course module response.",
          reflection: "Passed course module reflection.",
          promptExcerpt: "Passed course module prompt excerpt.",
        }),
        submissionStatus: "COMPLETED",
      },
      select: { id: true },
    });

    const passedDecision = await prisma.assessmentDecision.create({
      data: {
        submissionId: passedSubmission.id,
        moduleVersionId: passedModule.moduleVersion.id,
        rubricVersionId: passedModule.moduleVersion.rubricVersionId,
        promptTemplateVersionId: passedModule.moduleVersion.promptTemplateVersionId,
        mcqScaledScore: 82,
        practicalScaledScore: 14,
        totalScore: 96,
        redFlagsJson: "[]",
        passFailTotal: true,
        decisionType: "AUTOMATIC",
        decisionReason: "Passed course module decision.",
        finalisedById: participant!.id,
      },
      select: { id: true },
    });

    await prisma.certificationStatus.create({
      data: {
        userId: participant!.id,
        moduleId: passedModule.module.id,
        latestDecisionId: passedDecision.id,
        status: "ACTIVE",
        passedAt: new Date(),
      },
    });

    const startedOnlyCourse = await prisma.course.create({
      data: {
        title: `Started Course ${Date.now()}`,
        description: "Started course description",
        publishedAt: new Date(),
      },
      select: { id: true },
    });

    await prisma.courseItem.create({
      data: {
        courseId: startedOnlyCourse.id,
        moduleId: startedModule.module.id,
        itemType: "MODULE",
        sortOrder: 1,
      },
    });

    const mixedCourse = await prisma.course.create({
      data: {
        title: `Mixed Course ${Date.now()}`,
        description: "Mixed course description",
        publishedAt: new Date(),
      },
      select: { id: true },
    });

    await prisma.courseItem.createMany({
      data: [
        { courseId: mixedCourse.id, moduleId: startedModule.module.id, itemType: "MODULE", sortOrder: 1 },
        { courseId: mixedCourse.id, moduleId: passedModule.module.id, itemType: "MODULE", sortOrder: 2 },
      ],
    });

    const listResponse = await request(app).get("/api/courses").set(participantHeaders);
    expect(listResponse.status).toBe(200);

    const startedListEntry = (listResponse.body.courses as Array<Record<string, unknown>>).find(
      (entry) => entry.id === startedOnlyCourse.id,
    );
    expect(startedListEntry?.progress).toMatchObject({
      completed: 0,
      total: 1,
      courseStatus: "IN_PROGRESS",
    });

    const mixedListEntry = (listResponse.body.courses as Array<Record<string, unknown>>).find(
      (entry) => entry.id === mixedCourse.id,
    );
    expect(mixedListEntry?.progress).toMatchObject({
      completed: 1,
      total: 2,
      courseStatus: "IN_PROGRESS",
    });

    const detailResponse = await request(app).get(`/api/courses/${mixedCourse.id}`).set(participantHeaders);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.course.progress).toMatchObject({
      completed: 1,
      total: 2,
      courseStatus: "IN_PROGRESS",
    });
    expect(detailResponse.body.course.modules).toEqual([
      expect.objectContaining({
        moduleId: startedModule.module.id,
        moduleStatus: "IN_PROGRESS",
      }),
      expect.objectContaining({
        moduleId: passedModule.module.id,
        moduleStatus: "PASSED",
      }),
    ]);
  });
});

// #1093: rekkefølgen i «Mine kurs» — alfabetisk på tittelen i deltakerens språk, kurs med satt
// plassering først. Før lå kursene i publiseringsrekkefølge, eldst først.
describe("«Mine kurs»: rekkefølge (#1093)", () => {
  const stempel = Date.now();
  const admin = { "x-user-id": "admin-1093", "x-user-email": "admin1093@company.com", "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR" };
  const deltaker = { "x-user-id": "deltaker-1093", "x-user-email": "deltaker1093@company.com", "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT" };
  const tittel = (nb: string, en: string) => JSON.stringify({ nb, nn: nb, "en-GB": en });

  it("alfabetisk på tittelen i deltakerens språk, tallbevisst; satt plassering kommer først", async () => {
    const lag = (nb: string, en: string, sortOrder: number | null = null) =>
      prisma.course.create({ data: { title: tittel(`${nb} ${stempel}`, `${en} ${stempel}`), publishedAt: new Date(), sortOrder }, select: { id: true } });
    const modul10 = await lag("Modul 10 Oppsummering", "Module 10 Summary");
    const modul2 = await lag("Modul 2 Tilbud", "Module 2 Bids");
    const velkommen = await lag("Velkommen", "Welcome", 1);
    // «Økonomi» heter det samme på engelsk; «Zebra» skiller språkene: norsk sorterer Ø etter Z, engelsk Ø som O.
    const zebra = await lag("Zebra-kurs", "Zebra course");
    const okonomi = await lag("Økonomi", "Økonomi");
    const egne = new Set([modul10.id, modul2.id, velkommen.id, zebra.id, okonomi.id]);

    const nb = await request(app).get("/api/courses").set({ ...deltaker, "accept-language": "nb" });
    expect(nb.status).toBe(200);
    const nbRekke = (nb.body.courses as Array<{ id: string; title: string }>).filter((c) => egne.has(c.id)).map((c) => c.id);
    expect(nbRekke).toEqual([velkommen.id, modul2.id, modul10.id, zebra.id, okonomi.id]);

    // På engelsk kommer «Økonomi» før «Zebra course»: det er tittelen i deltakerens språk som avgjør.
    const en = await request(app).get("/api/courses").set({ ...deltaker, "accept-language": "en-GB" });
    const enRekke = (en.body.courses as Array<{ id: string; title: string }>).filter((c) => egne.has(c.id)).map((c) => c.id);
    expect(enRekke).toEqual([velkommen.id, modul2.id, modul10.id, okonomi.id, zebra.id]);
  });

  it("plasseringen settes og tømmes gjennom admin-API-et, og vises i kursdetaljen", async () => {
    const opprettet = await request(app).post("/api/admin/content/courses").set(admin).send({ title: { nb: `Rekkefølge ${stempel}`, nn: `Rekkefølge ${stempel}`, "en-GB": `Order ${stempel}` }, sortOrder: 3 });
    expect(opprettet.status, JSON.stringify(opprettet.body).slice(0, 300)).toBe(201);
    const id = opprettet.body.course.id as string;
    const detalj = await request(app).get(`/api/admin/content/courses/${id}`).set(admin);
    expect(detalj.body.course.sortOrder).toBe(3);

    const nullet = await request(app).put(`/api/admin/content/courses/${id}`).set(admin).send({ sortOrder: null });
    expect(nullet.status).toBe(200);
    expect((await request(app).get(`/api/admin/content/courses/${id}`).set(admin)).body.course.sortOrder).toBeNull();

    const ugyldig = await request(app).put(`/api/admin/content/courses/${id}`).set(admin).send({ sortOrder: -1 });
    expect(ugyldig.status).toBe(400);
  });

  it("plasseringen følger med gjennom eksport og import", async () => {
    const opprettet = await request(app).post("/api/admin/content/courses").set(admin).send({ title: { nb: `Rundtur ${stempel}`, nn: `Rundtur ${stempel}`, "en-GB": `Round trip ${stempel}` }, sortOrder: 7 });
    expect(opprettet.status).toBe(201);
    const id = opprettet.body.course.id as string;
    // Eksporten krever minst ett element i kurset.
    const seksjon = await request(app).post("/api/admin/content/sections").set(admin).send({ title: { nb: `Seksjon ${stempel}`, nn: `Seksjon ${stempel}`, "en-GB": `Section ${stempel}` }, bodyMarkdown: { nb: "Tekst.", nn: "Tekst.", "en-GB": "Text." } });
    expect(seksjon.status, JSON.stringify(seksjon.body).slice(0, 300)).toBe(201);
    const elementer = await request(app).put(`/api/admin/content/courses/${id}/items`).set(admin).send({ items: [{ type: "SECTION", sectionId: seksjon.body.section.id }] });
    expect(elementer.status, JSON.stringify(elementer.body).slice(0, 300)).toBe(204);
    const eksport = await request(app).get(`/api/admin/content/courses/${id}/export-package`).set(admin);
    expect(eksport.status, JSON.stringify(eksport.body).slice(0, 300)).toBe(200);
    const konvolutt = eksport.body.envelope ?? eksport.body;
    expect(konvolutt.course.course.sortOrder).toBe(7);
    const importert = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: konvolutt, mode: "createNew" });
    expect(importert.status, JSON.stringify(importert.body).slice(0, 300)).toBe(201);
    const detalj = await request(app).get(`/api/admin/content/courses/${importert.body.courseId}`).set(admin);
    expect(detalj.body.course.sortOrder).toBe(7);
  });
});
