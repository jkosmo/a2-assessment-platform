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
  it("lists a completed module with its latest decision, and exposes it in the completed endpoint", async () => {
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
        assessorExpectedContent: "Completed module test guidance.",
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
        responseJson: JSON.stringify({
          response: "Completed module test submission.",
          reflection: "Completed module test reflection.",
          promptExcerpt: "Completed module test prompt excerpt.",
        }),
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

    // ⚠️ #952: testen påsto tidligere at en fullført modul SKJULES fra lista, og at
    // `filters.includeCompleted` var `false`. Begge deler er fjernet sammen med den frittstående
    // modul-lista de tjente — deltakeren når moduler gjennom «Mine kurs», og lista returnerer alt.
    //
    // Det som fortsatt betyr noe, og som testen nå måler: modulen er MED i lista, og
    // `participantStatus` bærer det siste vedtaket slik flatene trenger.
    const availableResponse = await request(app).get("/api/modules").set(participantHeaders);
    expect(availableResponse.status).toBe(200);
    const availableModules = availableResponse.body.modules as Array<Record<string, unknown>>;
    expect(availableModules.map((entry) => entry.id as string)).toContain(module.id);
    expect(availableResponse.body.filters).toMatchObject({
      completedSubmissionStatuses: ["COMPLETED"],
    });

    const includedModule = availableModules.find((entry) => entry.id === module.id);
    expect(includedModule?.participantStatus).toMatchObject({
      latestStatus: "COMPLETED",
      latestSubmissionId: submission.id,
      latestDecision: {
        totalScore: 94,
        passFailTotal: true,
        decisionType: "AUTOMATIC",
      },
    });

    const retakeSubmissionResponse = await request(app)
      .post("/api/submissions")
      .set(participantHeaders)
      .send({
        moduleId: module.id,
        deliveryType: "text",
        responseJson: {
          response: "Retake submission after completed result.",
          reflection: "Retake reflection after completed result.",
          promptExcerpt: "Retake prompt excerpt.",
        },
      });
    expect(retakeSubmissionResponse.status).toBe(201);

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
