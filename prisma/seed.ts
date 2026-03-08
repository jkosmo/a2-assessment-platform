import { AppRole, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

  for (const [userId, appRole] of [
    [admin.id, AppRole.ADMINISTRATOR],
    [admin.id, AppRole.REPORT_READER],
    [participant.id, AppRole.PARTICIPANT],
  ] as const) {
    await prisma.roleAssignment.deleteMany({
      where: { userId, appRole },
    });

    await prisma.roleAssignment.create({
      data: {
        userId,
        appRole,
        validFrom: now,
        createdBy: "seed",
      },
    });
  }

  const module = await prisma.module.create({
    data: {
      title: "Generative AI Foundations",
      description: "M0 seeded module for development and integration testing.",
      certificationLevel: "foundation",
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
      systemPrompt: "You are an assessment assistant. Return strict JSON only.",
      userPromptTemplate:
        "Evaluate submission against rubric and provide criterion rationales.",
      examplesJson: JSON.stringify([
        { example: "Strong response with clear iteration evidence." },
      ]),
      active: true,
    },
  });

  const mcqSet = await prisma.mCQSetVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      title: "M0 baseline MCQ set",
      active: true,
      questions: {
        create: [
          {
            moduleId: module.id,
            stem: "What is the recommended model ownership boundary?",
            optionsJson: JSON.stringify([
              "LLM owns final decision",
              "Backend owns final decision",
              "Reviewer is optional for all cases",
              "No scoring needed",
            ]),
            correctAnswer: "Backend owns final decision",
            rationale:
              "The LLM must provide structured input, while backend owns final scoring and decisions.",
          },
          {
            moduleId: module.id,
            stem: "What should be configuration-first?",
            optionsJson: JSON.stringify([
              "Prompt versions and thresholds",
              "Secrets in source code",
              "Deployment keys in UI code",
              "Hardcoded policy values",
            ]),
            correctAnswer: "Prompt versions and thresholds",
            rationale: "Frequently changing behavior should be configurable.",
          },
        ],
      },
    },
    include: { questions: true },
  });

  const moduleVersion = await prisma.moduleVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      taskText: "Submit a practical reflection and complete the MCQ.",
      guidanceText: "Include iteration and quality assurance notes.",
      rubricVersionId: rubric.id,
      promptTemplateVersionId: prompt.id,
      mcqSetVersionId: mcqSet.id,
      publishedBy: admin.id,
      publishedAt: now,
    },
  });

  await prisma.module.update({
    where: { id: module.id },
    data: { activeVersionId: moduleVersion.id },
  });

  console.log("Seed completed", {
    adminEmail: admin.email,
    participantEmail: participant.email,
    moduleId: module.id,
    moduleVersionId: moduleVersion.id,
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
