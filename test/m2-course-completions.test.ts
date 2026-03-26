import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { checkAndIssueCourseCompletions } from "../src/modules/course/index.js";
import { auditActions, auditEntityTypes } from "../src/observability/auditEvents.js";

describe("Course completion issuance", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("issues one course completion when the final course module is passed and keeps issuance idempotent", async () => {
    const suffix = Date.now();
    const participantHeaders = {
      "x-user-id": `course-completion-user-${suffix}`,
      "x-user-email": `course.completion.${suffix}@company.com`,
      "x-user-name": "Course Completion User",
      "x-user-department": "Learning",
      "x-user-roles": "PARTICIPANT",
      "x-locale": "nb",
    };

    const participant = await prisma.user.create({
      data: {
        externalId: participantHeaders["x-user-id"],
        email: participantHeaders["x-user-email"],
        name: participantHeaders["x-user-name"],
        department: participantHeaders["x-user-department"],
      },
      select: { id: true },
    });

    const moduleA = await createPublishedModule(`Course Completion Module A ${suffix}`);
    const moduleB = await createPublishedModule(`Course Completion Module B ${suffix}`);

    const course = await prisma.course.create({
      data: {
        title: JSON.stringify({
          "en-GB": `Completion Course ${suffix}`,
          nb: `Fullføringskurs ${suffix}`,
          nn: `Fullføringskurs ${suffix}`,
        }),
        description: JSON.stringify({
          "en-GB": "Course completion issuance test.",
          nb: "Test av kursbevis-utstedelse.",
          nn: "Test av kursbevis-utferding.",
        }),
        publishedAt: new Date(),
        modules: {
          create: [
            { moduleId: moduleA.module.id, sortOrder: 1 },
            { moduleId: moduleB.module.id, sortOrder: 2 },
          ],
        },
      },
      select: { id: true },
    });

    await createPassedCertification(participant.id, moduleA);
    await checkAndIssueCourseCompletions({ userId: participant.id, moduleId: moduleA.module.id });

    expect(
      await prisma.courseCompletion.count({
        where: { userId: participant.id, courseId: course.id },
      }),
    ).toBe(0);

    await createPassedCertification(participant.id, moduleB);
    await checkAndIssueCourseCompletions({ userId: participant.id, moduleId: moduleB.module.id });
    await checkAndIssueCourseCompletions({ userId: participant.id, moduleId: moduleB.module.id });

    const completions = await prisma.courseCompletion.findMany({
      where: { userId: participant.id, courseId: course.id },
      orderBy: { completedAt: "asc" },
    });
    expect(completions).toHaveLength(1);
    expect(completions[0].moduleSnapshotJson).toBe(
      JSON.stringify([moduleA.module.id, moduleB.module.id]),
    );

    const completionAuditEvents = await prisma.auditEvent.findMany({
      where: {
        entityType: auditEntityTypes.course,
        entityId: course.id,
        action: auditActions.course.completionIssued,
      },
      select: { id: true },
    });
    expect(completionAuditEvents).toHaveLength(1);

    const completionsResponse = await request(app)
      .get("/api/courses/completions")
      .set(participantHeaders);
    expect(completionsResponse.status).toBe(200);
    expect(completionsResponse.body.completions).toEqual([
      expect.objectContaining({
        courseId: course.id,
        certificateId: completions[0].certificateId,
        courseTitle: `Fullføringskurs ${suffix}`,
      }),
    ]);
  });
});

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

async function createPassedCertification(
  userId: string,
  moduleFixture: Awaited<ReturnType<typeof createPublishedModule>>,
) {
  const submission = await prisma.submission.create({
    data: {
      userId,
      moduleId: moduleFixture.module.id,
      moduleVersionId: moduleFixture.moduleVersion.id,
      deliveryType: "text",
      responseJson: JSON.stringify({
        response: "Course completion certification submission.",
        reflection: "Course completion certification reflection.",
        promptExcerpt: "Course completion certification prompt excerpt.",
      }),
      submissionStatus: "COMPLETED",
    },
    select: { id: true },
  });

  const decision = await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id,
      moduleVersionId: moduleFixture.moduleVersion.id,
      rubricVersionId: moduleFixture.moduleVersion.rubricVersionId,
      promptTemplateVersionId: moduleFixture.moduleVersion.promptTemplateVersionId,
      mcqScaledScore: 84,
      practicalScaledScore: 14,
      totalScore: 98,
      redFlagsJson: "[]",
      passFailTotal: true,
      decisionType: "AUTOMATIC",
      decisionReason: "Passed course completion module.",
      finalisedById: userId,
    },
    select: { id: true },
  });

  await prisma.certificationStatus.create({
    data: {
      userId,
      moduleId: moduleFixture.module.id,
      latestDecisionId: decision.id,
      status: "ACTIVE",
      passedAt: new Date(),
    },
  });
}
