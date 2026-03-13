import { AppRole, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type SeedQuestion = {
  stem: string;
  options: string[];
  correctAnswer: string;
  rationale: string;
};

type SeedModuleInput = {
  title: string;
  description: string;
  certificationLevel: string;
  taskText: string;
  guidanceText: string;
  promptSystem: string;
  promptTemplate: string;
  promptExample: string;
  mcqTitle: string;
  questions: SeedQuestion[];
};

async function main() {
  const now = new Date();

  const admin = await prisma.user.upsert({
    where: { email: "admin@company.com" },
    update: { name: "Platform Admin", externalId: "admin-1" },
    create: {
      externalId: "admin-1",
      name: "Platform Admin",
      email: "admin@company.com",
      department: "Technology",
    },
  });

  const participant = await prisma.user.upsert({
    where: { email: "participant@company.com" },
    update: { name: "Platform Participant", externalId: "participant-1" },
    create: {
      externalId: "participant-1",
      name: "Platform Participant",
      email: "participant@company.com",
      department: "Consulting",
    },
  });

  const reviewer = await prisma.user.upsert({
    where: { email: "reviewer1@company.com" },
    update: { name: "Platform Reviewer", externalId: "reviewer-user-1" },
    create: {
      externalId: "reviewer-user-1",
      name: "Platform Reviewer",
      email: "reviewer1@company.com",
      department: "Quality",
    },
  });

  const appealHandler = await prisma.user.upsert({
    where: { email: "appeal.handler@company.com" },
    update: { name: "Platform Appeal Handler", externalId: "handler-1" },
    create: {
      externalId: "handler-1",
      name: "Platform Appeal Handler",
      email: "appeal.handler@company.com",
      department: "Quality",
    },
  });

  const seedRoleMap = new Map<string, AppRole[]>([
    [admin.id, [AppRole.ADMINISTRATOR, AppRole.REPORT_READER]],
    [participant.id, [AppRole.PARTICIPANT]],
    [reviewer.id, [AppRole.REVIEWER]],
    [appealHandler.id, [AppRole.APPEAL_HANDLER]],
  ]);

  for (const [userId, expectedRoles] of seedRoleMap.entries()) {
    await prisma.roleAssignment.deleteMany({
      where: { userId },
    });

    for (const appRole of expectedRoles) {
      await prisma.roleAssignment.create({
        data: {
          userId,
          appRole,
          validFrom: now,
          createdBy: "seed",
        },
      });
    }
  }

  const firstModule = await createSeedModuleBundle(admin.id, now, {
    title: "Generative AI Foundations",
    description: "M0 seeded module for development and integration testing.",
    certificationLevel: "foundation",
    taskText: "Submit a practical reflection and complete the MCQ.",
    guidanceText: "Include iteration and quality assurance notes.",
    promptSystem: "You are an assessment assistant. Return strict JSON only.",
    promptTemplate: "Evaluate submission against rubric and provide criterion rationales.",
    promptExample: "Strong response with clear iteration evidence.",
    mcqTitle: "M0 baseline MCQ set",
    questions: [
      {
        stem: "What is the recommended model ownership boundary?",
        options: [
          "LLM owns final decision",
          "Backend owns final decision",
          "Reviewer is optional for all cases",
          "No scoring needed",
        ],
        correctAnswer: "Backend owns final decision",
        rationale:
          "The LLM must provide structured input, while backend owns final scoring and decisions.",
      },
      {
        stem: "What should be configuration-first?",
        options: [
          "Prompt versions and thresholds",
          "Secrets in source code",
          "Deployment keys in UI code",
          "Hardcoded policy values",
        ],
        correctAnswer: "Prompt versions and thresholds",
        rationale: "Frequently changing behavior should be configurable.",
      },
    ],
  });

  const secondModule = await createSeedModuleBundle(admin.id, now, {
    title: "AI Governance and Risk Essentials",
    description: "Second seeded module for multi-module flow testing and UX verification.",
    certificationLevel: "foundation",
    taskText: "Assess governance risks and document a practical mitigation approach.",
    guidanceText: "Describe concrete controls, owners, and follow-up actions.",
    promptSystem: "You are an assessment assistant focused on governance and risk quality.",
    promptTemplate: "Evaluate governance submission against rubric and return strict JSON.",
    promptExample: "Strong response identifies risk, mitigation, owner, and monitoring cadence.",
    mcqTitle: "Governance baseline MCQ set",
    questions: [
      {
        stem: "Which control best supports traceability in AI assessments?",
        options: [
          "Ad hoc reviewer notes without timestamps",
          "Versioned decisions and audit trail",
          "Manual score updates without logs",
          "Deleting historical submissions after scoring",
        ],
        correctAnswer: "Versioned decisions and audit trail",
        rationale: "Traceability requires immutable history and explicit decision lineage.",
      },
      {
        stem: "What is the preferred response when model confidence is low?",
        options: [
          "Auto-pass to avoid queue growth",
          "Route to manual review by policy",
          "Ignore confidence and use total score only",
          "Hide confidence signal from administrators",
        ],
        correctAnswer: "Route to manual review by policy",
        rationale: "Low confidence should trigger human review for control and quality.",
      },
    ],
  });

  await createSeedPendingManualReview({
    now,
    participantId: participant.id,
    reviewerId: reviewer.id,
    moduleId: firstModule.moduleId,
    moduleVersionId: firstModule.moduleVersionId,
    rubricVersionId: firstModule.rubricVersionId,
    promptTemplateVersionId: firstModule.promptTemplateVersionId,
    mcqSetVersionId: firstModule.mcqSetVersionId,
    mcqQuestionIds: firstModule.mcqQuestionIds,
  });

  console.log("Seed completed", {
    adminEmail: admin.email,
    participantEmail: participant.email,
    reviewerEmail: reviewer.email,
    appealHandlerEmail: appealHandler.email,
    modules: [
      { moduleId: firstModule.moduleId, moduleVersionId: firstModule.moduleVersionId },
      { moduleId: secondModule.moduleId, moduleVersionId: secondModule.moduleVersionId },
    ],
  });
}

async function createSeedModuleBundle(adminId: string, now: Date, input: SeedModuleInput) {
  const module = await prisma.module.create({
    data: {
      title: input.title,
      description: input.description,
      certificationLevel: input.certificationLevel,
    },
  });

  const rubric = await prisma.rubricVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      criteriaJson: JSON.stringify({
        relevance_for_case: "0-4",
        quality_and_utility: "0-4",
        iteration_and_improvement: "0-4",
        human_quality_assurance: "0-4",
        responsible_use: "0-4",
      }),
      scalingRuleJson: JSON.stringify({ practical_weight: 70, max_total: 20 }),
      passRuleJson: JSON.stringify({
        total_min: 70,
        practical_min_percent: 50,
        mcq_min_percent: 60,
        no_open_red_flags: true,
      }),
      active: true,
    },
  });

  const prompt = await prisma.promptTemplateVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      systemPrompt: input.promptSystem,
      userPromptTemplate: input.promptTemplate,
      examplesJson: JSON.stringify([{ example: input.promptExample }]),
      active: true,
    },
  });

  const mcqSet = await prisma.mCQSetVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      title: input.mcqTitle,
      active: true,
      questions: {
        create: input.questions.map((question) => ({
          moduleId: module.id,
          stem: question.stem,
          optionsJson: JSON.stringify(question.options),
          correctAnswer: question.correctAnswer,
          rationale: question.rationale,
        })),
      },
    },
    include: { questions: true },
  });

  const moduleVersion = await prisma.moduleVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      taskText: input.taskText,
      guidanceText: input.guidanceText,
      rubricVersionId: rubric.id,
      promptTemplateVersionId: prompt.id,
      mcqSetVersionId: mcqSet.id,
      publishedBy: adminId,
      publishedAt: now,
    },
  });

  await prisma.module.update({
    where: { id: module.id },
    data: { activeVersionId: moduleVersion.id },
  });

  return {
    moduleId: module.id,
    moduleVersionId: moduleVersion.id,
    rubricVersionId: rubric.id,
    promptTemplateVersionId: prompt.id,
    mcqSetVersionId: mcqSet.id,
    mcqQuestionIds: mcqSet.questions.map((question) => question.id),
  };
}

async function createSeedPendingManualReview(input: {
  now: Date;
  participantId: string;
  reviewerId: string;
  moduleId: string;
  moduleVersionId: string;
  rubricVersionId: string;
  promptTemplateVersionId: string;
  mcqSetVersionId: string;
  mcqQuestionIds: string[];
}) {
  const submittedAt = new Date(input.now.getTime() - 3 * 60 * 60 * 1000);
  const completedAt = new Date(input.now.getTime() - 2 * 60 * 60 * 1000);
  const evaluatedAt = new Date(input.now.getTime() - 110 * 60 * 1000);
  const decisionAt = new Date(input.now.getTime() - 105 * 60 * 1000);
  const reviewCreatedAt = new Date(input.now.getTime() - 100 * 60 * 1000);

  const submission = await prisma.submission.create({
    data: {
      userId: input.participantId,
      moduleId: input.moduleId,
      moduleVersionId: input.moduleVersionId,
      locale: "nb",
      deliveryType: "text",
      rawText:
        "Seeded response for manual review queue visibility. The answer is useful, but contains enough ambiguity to require a human decision.",
      reflectionText:
        "I iterated several times and documented quality checks, but I am not fully confident in the governance section.",
      promptExcerpt: "Assess governance quality, risk handling, and human oversight.",
      responsibilityAcknowledged: true,
      submittedAt,
      submissionStatus: "UNDER_REVIEW",
    },
  });

  const attempt = await prisma.mCQAttempt.create({
    data: {
      submissionId: submission.id,
      mcqSetVersionId: input.mcqSetVersionId,
      startedAt: new Date(submittedAt.getTime() + 2 * 60 * 1000),
      completedAt,
      rawScore: input.mcqQuestionIds.length,
      scaledScore: 100,
      percentScore: 100,
      passFailMcq: true,
    },
  });

  await prisma.mCQResponse.createMany({
    data: input.mcqQuestionIds.map((questionId) => ({
      mcqAttemptId: attempt.id,
      questionId,
      selectedAnswer: "Seeded correct answer",
      isCorrect: true,
    })),
  });

  await prisma.lLMEvaluation.create({
    data: {
      submissionId: submission.id,
      moduleVersionId: input.moduleVersionId,
      modelName: "seed-manual-review-model",
      promptTemplateVersionId: input.promptTemplateVersionId,
      requestPayloadHash: "seed-pending-manual-review",
      responseJson: JSON.stringify({
        criterion_rationales: {
          relevance_for_case: "Relevant, but governance controls are only partially evidenced.",
          quality_and_utility: "Useful answer with uneven depth.",
          iteration_and_improvement: "Some iteration is visible.",
          human_quality_assurance: "Manual checks are described, but not fully evidenced.",
          responsible_use: "Responsible-use section is ambiguous and needs a human reviewer.",
        },
        improvement_advice: [
          "Clarify who approves the final output before release.",
          "Explain the concrete human quality gate and escalation path.",
        ],
        manual_review_recommended: true,
      }),
      rubricTotal: 13,
      practicalScoreScaled: 62,
      passFailPractical: true,
      manualReviewRecommended: true,
      confidenceNote: "Medium confidence due to ambiguous human oversight evidence.",
      evaluatedAt,
      createdAt: evaluatedAt,
    },
  });

  await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id,
      moduleVersionId: input.moduleVersionId,
      rubricVersionId: input.rubricVersionId,
      promptTemplateVersionId: input.promptTemplateVersionId,
      mcqScaledScore: 100,
      practicalScaledScore: 62,
      totalScore: 74,
      redFlagsJson: JSON.stringify([
        {
          code: "ambiguous_human_oversight",
          severity: "medium",
          message: "Human quality gate is not described clearly enough for automatic approval.",
        },
      ]),
      passFailTotal: true,
      decisionType: "AUTOMATIC",
      decisionReason:
        "Seeded automatic decision created before manual review. Final result is pending human review.",
      finalisedAt: decisionAt,
    },
  });

  await prisma.manualReview.create({
    data: {
      submissionId: submission.id,
      reviewerId: input.reviewerId,
      reviewStatus: "OPEN",
      createdAt: reviewCreatedAt,
      triggerReason:
        "Seeded pending review for workspace visibility. Human review is required because governance and oversight evidence is ambiguous.",
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
