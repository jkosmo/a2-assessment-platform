import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
  "x-user-roles": "PARTICIPANT",
};

const reportReaderHeaders = {
  "x-user-id": "report-reader-1",
  "x-user-email": "report.reader@company.com",
  "x-user-name": "Report Reader",
  "x-user-roles": "REPORT_READER",
};

// #966 (produkteier 2026-08-25): «alle seksjoner må være lest».
//
// SMO-rapporten var den ene av fem flatene som stilte et annet krav enn bevisporten: den telte bare
// moduler. En deltaker med alle moduler bestått, men uleste seksjoner, sto som «Fullført» i
// rapporten — uten bevis, og uten å være ferdig.
//
// ⚠️ Hvorfor dette er en EGEN testfil, og ikke en påstand i m2-reporting.test.ts:
// fikstur-kurset der har ÉN modul og NULL seksjoner. En påstand lagt dit ville vært grønn uansett
// hva regelen gjorde — den kunne ikke måle seksjonskravet, fordi det ikke fantes en seksjon å måle.
//
// ⚠️ Og hvorfor fiksturen under har en BESTÅTT modul, ikke bare en seksjon: første utgave av denne
// testen hadde null moduler og én seksjon. Den var grønn — og forble grønn da regelen ble reversert
// til kun-moduler. To grunner, begge stille:
//   - `computeCourseStatus(0, 0, …)` returnerer NOT_STARTED uansett regel, så «ikke COMPLETED» var
//     oppfylt av at kurset var tomt, ikke av seksjonskravet.
//   - etter lesing utstedes et kursbevis, og `learner.completion` kortslutter til COMPLETED FØR
//     regelen i det hele tatt kalles.
// Mutasjonstesten avslørte det. Skal påstanden kunne bli rød, må den muterte regelen kunne si
// COMPLETED — og det krever minst én modul som faktisk er bestått.
describe("Kursrapporten krever leste seksjoner (#966)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("holder en deltaker med alle moduler bestått som IKKE fullført så lenge en seksjon er ulest", async () => {
    const participant = await prisma.user.findUnique({
      where: { externalId: participantHeaders["x-user-id"] },
      select: { id: true },
    });
    expect(participant).toBeTruthy();

    const course = await prisma.course.create({
      data: { title: `Seksjonskrav ${Date.now()}`, publishedAt: new Date() },
      select: { id: true },
    });

    // En modul deltakeren HAR bestått. Uten den kan ikke den muterte regelen si COMPLETED, og
    // påstanden lenger nede kan ikke bli rød.
    const module = await prisma.module.create({
      data: { title: `Seksjonskrav-modul ${Date.now()}` },
      select: { id: true },
    });
    const moduleVersion = await prisma.moduleVersion.create({
      data: { moduleId: module.id, versionNo: 1, assessmentMode: "MCQ_ONLY", publishedAt: new Date() },
      select: { id: true },
    });
    await prisma.module.update({
      where: { id: module.id },
      data: { activeVersionId: moduleVersion.id },
    });
    await prisma.courseItem.create({
      data: { courseId: course.id, moduleId: module.id, itemType: "MODULE", sortOrder: 0 },
    });

    const submission = await prisma.submission.create({
      data: {
        userId: participant!.id,
        moduleId: module.id,
        moduleVersionId: moduleVersion.id,
        deliveryType: "text",
        submissionStatus: "COMPLETED",
      },
      select: { id: true },
    });
    await prisma.assessmentDecision.create({
      data: {
        submissionId: submission.id,
        moduleVersionId: moduleVersion.id,
        mcqScaledScore: 1,
        practicalScaledScore: 1,
        totalScore: 1,
        redFlagsJson: "[]",
        passFailTotal: true,
        decisionType: "AUTOMATIC",
        decisionReason: "Fikstur for #966.",
      },
    });

    const section = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "Les meg" }) },
      select: { id: true },
    });
    const version = await prisma.courseSectionVersion.create({
      data: {
        sectionId: section.id,
        versionNo: 1,
        bodyMarkdown: JSON.stringify({ "en-GB": "Innhold." }),
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    await prisma.courseSection.update({
      where: { id: section.id },
      data: { activeVersionId: version.id },
    });
    await prisma.courseItem.create({
      data: { courseId: course.id, itemType: "SECTION", sectionId: section.id, sortOrder: 1 },
    });

    await prisma.courseEnrollment.create({
      data: { userId: participant!.id, courseId: course.id, source: "INDIVIDUAL" },
    });

    const readRow = async (query = "") => {
      const response = await request(app)
        .get(`/api/reports/courses/details?selectedCourseId=${encodeURIComponent(course.id)}${query}`)
        .set(reportReaderHeaders);
      expect(response.status).toBe(200);
      return (response.body.rows as Array<{
        participantEmail: string;
        status: string;
        passedModules: number;
        totalModules: number;
        readSections: number;
        totalSections: number;
      }>).find((r) => r.participantEmail === participantHeaders["x-user-email"]);
    };

    // Alle moduler bestått (1/1), seksjonen ulest (0/1). Dette er NØYAKTIG tilstanden der den gamle
    // regelen sa «Fullført» mens bevisporten nektet å utstede bevis.
    const beforeRead = await readRow();
    expect(beforeRead).toBeDefined();
    expect(beforeRead?.passedModules).toBe(1);
    expect(beforeRead?.totalModules).toBe(1);
    expect(beforeRead?.totalSections).toBe(1);
    expect(beforeRead?.readSections).toBe(0);
    expect(beforeRead?.status).toBe("IN_PROGRESS");

    // KONTROLLCASE. Uten dette ville testen over vært like grønn om regelen alltid sa «ikke
    // fullført» — den ville målt at noe er strengt, ikke at det er RIKTIG strengt.
    const markRead = await request(app)
      .post(`/api/courses/${course.id}/sections/${section.id}/read`)
      .set(participantHeaders);
    expect(markRead.status).toBe(204);

    const afterRead = await readRow();
    expect(afterRead?.readSections).toBe(1);
    expect(afterRead?.status).toBe("COMPLETED");

    // #966, QA-funn 1: seksjonslesing må ligge i SAMME datovindu som innleveringene og
    // fullføringene. Var den ufiltrert, blandet raden to vinduer — «0/1 moduler» fra vinduet ved
    // siden av «1/1 seksjoner» all-time — og statusen ble regnet av begge.
    const farFuture = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const outsideWindow = await readRow(`&dateFrom=${farFuture}`);
    expect(outsideWindow?.passedModules).toBe(0);
    expect(outsideWindow?.readSections).toBe(0);

    await prisma.courseCompletion.deleteMany({ where: { courseId: course.id } });
    await prisma.courseSectionRead.deleteMany({ where: { courseId: course.id } });
    await prisma.courseEnrollment.deleteMany({ where: { courseId: course.id } });
    await prisma.courseItem.deleteMany({ where: { courseId: course.id } });
    await prisma.course.delete({ where: { id: course.id } });
    await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: null } });
    await prisma.courseSectionVersion.deleteMany({ where: { sectionId: section.id } });
    await prisma.courseSection.delete({ where: { id: section.id } });
    await prisma.assessmentDecision.deleteMany({ where: { submissionId: submission.id } });
    await prisma.submission.delete({ where: { id: submission.id } });
    await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: null } });
    await prisma.moduleVersion.deleteMany({ where: { moduleId: module.id } });
    await prisma.module.delete({ where: { id: module.id } });
  });
});
