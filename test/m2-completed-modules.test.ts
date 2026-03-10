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

describe("Participant completed modules and available list filtering", () => {
  it("hides completed modules from available list by default and exposes them in completed endpoint", async () => {
    const participant = await prisma.user.findUnique({
      where: { externalId: "participant-1" },
      select: { id: true },
    });
    expect(participant).toBeTruthy();

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
      data: {
        title: `Completed Modules Test ${Date.now()}`,
      },
      select: { id: true },
    });

    const moduleVersion = await prisma.moduleVersion.create({
      data: {
        moduleId: module.id,
        versionNo: 1,
        taskText: "Completed module test task.",
        guidanceText: "Completed module test guidance.",
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
      data: {
        activeVersionId: moduleVersion.id,
      },
    });

    const submission = await prisma.submission.create({
      data: {
        userId: participant!.id,
        moduleId: module.id,
        moduleVersionId: moduleVersion.id,
        deliveryType: "text",
        rawText: "Completed module test submission.",
        reflectionText: "Completed module test reflection.",
        promptExcerpt: "Completed module test prompt excerpt.",
        responsibilityAcknowledged: true,
        submissionStatus: "COMPLETED",
      },
      select: { id: true, submittedAt: true },
    });

    await prisma.assessmentDecision.create({
      data: {
        submissionId: submission.id,
        moduleVersionId: moduleVersion.id,
        rubricVersionId: moduleVersion.rubricVersionId,
        promptTemplateVersionId: moduleVersion.promptTemplateVersionId,
        mcqScaledScore: 78,
        practicalScaledScore: 16,
        totalScore: 94,
        redFlagsJson: "[]",
        passFailTotal: true,
        decisionType: "AUTOMATIC",
        decisionReason: "Completed test decision.",
        finalisedById: participant!.id,
      },
    });

    const availableResponse = await request(app).get("/api/modules").set(participantHeaders);
    expect(availableResponse.status).toBe(200);
    const availableModuleIds = (availableResponse.body.modules as Array<{ id: string }>).map((entry) => entry.id);
    expect(availableModuleIds).not.toContain(module.id);
    expect(availableResponse.body.filters).toMatchObject({
      includeCompleted: false,
      completedSubmissionStatuses: ["COMPLETED"],
    });

    const includeCompletedResponse = await request(app)
      .get("/api/modules?includeCompleted=true")
      .set(participantHeaders);
    expect(includeCompletedResponse.status).toBe(200);
    const includeCompletedIds = (includeCompletedResponse.body.modules as Array<{ id: string }>).map((entry) => entry.id);
    expect(includeCompletedIds).toContain(module.id);

    const completedResponse = await request(app)
      .get("/api/modules/completed?limit=20")
      .set(participantHeaders);
    expect(completedResponse.status).toBe(200);
    const completedEntry = (completedResponse.body.modules as Array<Record<string, unknown>>).find(
      (entry) => entry.moduleId === module.id,
    );
    expect(completedEntry).toBeTruthy();
    expect(completedEntry?.latestStatus).toBe("COMPLETED");
    expect(completedEntry?.latestDecision).toMatchObject({
      totalScore: 94,
      passFailTotal: true,
      decisionType: "AUTOMATIC",
    });
    expect(completedResponse.body.filters).toMatchObject({
      limit: 20,
      completedSubmissionStatuses: ["COMPLETED"],
    });
  });
});
