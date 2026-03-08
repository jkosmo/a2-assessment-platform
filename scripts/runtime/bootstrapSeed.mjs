import prismaClientModule from "@prisma/client";

const { PrismaClient, AppRole } = prismaClientModule;
const prisma = new PrismaClient();

const seedEnabled = (process.env.BOOTSTRAP_SEED ?? "false").toLowerCase() === "true";
const isProduction = (process.env.NODE_ENV ?? "").toLowerCase() === "production";

const IDS = {
  module: "seed_module_genai_foundations",
  rubric: "seed_rubric_genai_foundations_v1",
  prompt: "seed_prompt_genai_foundations_v1",
  mcqSet: "seed_mcq_set_genai_foundations_v1",
  mcqQ1: "seed_mcq_q1_genai_foundations",
  mcqQ2: "seed_mcq_q2_genai_foundations",
  moduleVersion: "seed_module_version_genai_foundations_v1",
};

async function upsertUsersAndRoles(now) {
  const admin = await prisma.user.upsert({
    where: { email: "admin@company.com" },
    update: { name: "Platform Admin", externalId: "admin-1", activeStatus: true },
    create: {
      externalId: "admin-1",
      name: "Platform Admin",
      email: "admin@company.com",
      department: "Technology",
      activeStatus: true,
    },
  });

  const participant = await prisma.user.upsert({
    where: { email: "participant@company.com" },
    update: { name: "Platform Participant", externalId: "participant-1", activeStatus: true },
    create: {
      externalId: "participant-1",
      name: "Platform Participant",
      email: "participant@company.com",
      department: "Consulting",
      activeStatus: true,
    },
  });

  for (const [userId, appRole] of [
    [admin.id, AppRole.ADMINISTRATOR],
    [admin.id, AppRole.REPORT_READER],
    [participant.id, AppRole.PARTICIPANT],
  ]) {
    await prisma.roleAssignment.deleteMany({ where: { userId, appRole } });
    await prisma.roleAssignment.create({
      data: {
        userId,
        appRole,
        validFrom: now,
        createdBy: "bootstrap-seed",
      },
    });
  }

  return { admin, participant };
}

async function upsertModuleGraph(adminId, now) {
  const module = await prisma.module.upsert({
    where: { id: IDS.module },
    update: {
      title: "Generative AI Foundations",
      description: "Bootstrap seeded module for non-production environments.",
      certificationLevel: "foundation",
    },
    create: {
      id: IDS.module,
      title: "Generative AI Foundations",
      description: "Bootstrap seeded module for non-production environments.",
      certificationLevel: "foundation",
    },
  });

  const rubric = await prisma.rubricVersion.upsert({
    where: { id: IDS.rubric },
    update: {
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
    create: {
      id: IDS.rubric,
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

  const prompt = await prisma.promptTemplateVersion.upsert({
    where: { id: IDS.prompt },
    update: {
      moduleId: module.id,
      versionNo: 1,
      systemPrompt: "You are an assessment assistant. Return strict JSON only.",
      userPromptTemplate:
        "Evaluate submission against rubric and provide criterion rationales.",
      examplesJson: JSON.stringify([{ example: "Strong response with clear iteration evidence." }]),
      active: true,
    },
    create: {
      id: IDS.prompt,
      moduleId: module.id,
      versionNo: 1,
      systemPrompt: "You are an assessment assistant. Return strict JSON only.",
      userPromptTemplate:
        "Evaluate submission against rubric and provide criterion rationales.",
      examplesJson: JSON.stringify([{ example: "Strong response with clear iteration evidence." }]),
      active: true,
    },
  });

  const mcqSet = await prisma.mCQSetVersion.upsert({
    where: { id: IDS.mcqSet },
    update: {
      moduleId: module.id,
      versionNo: 1,
      title: "Bootstrap MCQ set",
      active: true,
    },
    create: {
      id: IDS.mcqSet,
      moduleId: module.id,
      versionNo: 1,
      title: "Bootstrap MCQ set",
      active: true,
    },
  });

  await prisma.mCQQuestion.upsert({
    where: { id: IDS.mcqQ1 },
    update: {
      mcqSetVersionId: mcqSet.id,
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
      active: true,
    },
    create: {
      id: IDS.mcqQ1,
      mcqSetVersionId: mcqSet.id,
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
      active: true,
    },
  });

  await prisma.mCQQuestion.upsert({
    where: { id: IDS.mcqQ2 },
    update: {
      mcqSetVersionId: mcqSet.id,
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
      active: true,
    },
    create: {
      id: IDS.mcqQ2,
      mcqSetVersionId: mcqSet.id,
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
      active: true,
    },
  });

  const moduleVersion = await prisma.moduleVersion.upsert({
    where: { id: IDS.moduleVersion },
    update: {
      moduleId: module.id,
      versionNo: 1,
      taskText: "Submit a practical reflection and complete the MCQ.",
      guidanceText: "Include iteration and quality assurance notes.",
      rubricVersionId: rubric.id,
      promptTemplateVersionId: prompt.id,
      mcqSetVersionId: mcqSet.id,
      publishedBy: adminId,
      publishedAt: now,
    },
    create: {
      id: IDS.moduleVersion,
      moduleId: module.id,
      versionNo: 1,
      taskText: "Submit a practical reflection and complete the MCQ.",
      guidanceText: "Include iteration and quality assurance notes.",
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

  return { module, moduleVersion };
}

async function main() {
  if (!seedEnabled) {
    console.log("Bootstrap seed disabled (BOOTSTRAP_SEED!=true), skipping.");
    return;
  }

  if (isProduction) {
    console.log("Production environment detected, skipping bootstrap seed.");
    return;
  }

  const now = new Date();
  const { admin, participant } = await upsertUsersAndRoles(now);
  const { module, moduleVersion } = await upsertModuleGraph(admin.id, now);

  console.log("Bootstrap seed ensured", {
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
