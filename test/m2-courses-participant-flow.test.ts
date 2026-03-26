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
      guidanceText: `${title} guidance text`,
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

    await prisma.courseModule.create({
      data: {
        courseId: startedOnlyCourse.id,
        moduleId: startedModule.module.id,
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

    await prisma.courseModule.createMany({
      data: [
        { courseId: mixedCourse.id, moduleId: startedModule.module.id, sortOrder: 1 },
        { courseId: mixedCourse.id, moduleId: passedModule.module.id, sortOrder: 2 },
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
