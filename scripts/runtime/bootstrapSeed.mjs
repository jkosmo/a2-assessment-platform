import prismaClientModule from "@prisma/client";

const { PrismaClient, AppRole } = prismaClientModule;
const prisma = new PrismaClient();

const seedEnabled = (process.env.BOOTSTRAP_SEED ?? "false").toLowerCase() === "true";
const isProduction = (process.env.NODE_ENV ?? "").toLowerCase() === "production";

const MODULE_SEEDS = [
  {
    ids: {
      module: "seed_module_genai_foundations",
      rubric: "seed_rubric_genai_foundations_v1",
      prompt: "seed_prompt_genai_foundations_v1",
      mcqSet: "seed_mcq_set_genai_foundations_v1",
      mcqQ1: "seed_mcq_q1_genai_foundations",
      mcqQ2: "seed_mcq_q2_genai_foundations",
      moduleVersion: "seed_module_version_genai_foundations_v1",
    },
    title: "Generative AI Foundations",
    description: "Bootstrap seeded module for non-production environments.",
    taskText: "Submit a practical reflection and complete the MCQ.",
    guidanceText: "Include iteration and quality assurance notes.",
    promptSystem: "You are an assessment assistant. Return strict JSON only.",
    promptTemplate: "Evaluate submission against rubric and provide criterion rationales.",
    promptExample: "Strong response with clear iteration evidence.",
    mcqSetTitle: "Bootstrap MCQ set",
    question1: {
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
    question2: {
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
  },
  {
    ids: {
      module: "seed_module_ai_governance_risk",
      rubric: "seed_rubric_ai_governance_risk_v1",
      prompt: "seed_prompt_ai_governance_risk_v1",
      mcqSet: "seed_mcq_set_ai_governance_risk_v1",
      mcqQ1: "seed_mcq_q1_ai_governance_risk",
      mcqQ2: "seed_mcq_q2_ai_governance_risk",
      moduleVersion: "seed_module_version_ai_governance_risk_v1",
    },
    title: "AI Governance and Risk Essentials",
    description: "Bootstrap seeded second module for multi-module flow testing.",
    taskText: "Assess governance risks and document a practical mitigation approach.",
    guidanceText: "Describe concrete controls, owners, and follow-up actions.",
    promptSystem: "You are an assessment assistant focused on governance and risk quality.",
    promptTemplate: "Evaluate governance submission against rubric and return strict JSON.",
    promptExample: "Strong response identifies risk, mitigation, owner, and monitoring cadence.",
    mcqSetTitle: "Bootstrap governance MCQ set",
    question1: {
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
    question2: {
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
  },
];

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

async function upsertModuleGraph(adminId, now, seed) {
  const module = await prisma.module.upsert({
    where: { id: seed.ids.module },
    update: {
      title: seed.title,
      description: seed.description,
      certificationLevel: "foundation",
    },
    create: {
      id: seed.ids.module,
      title: seed.title,
      description: seed.description,
      certificationLevel: "foundation",
    },
  });

  const rubric = await prisma.rubricVersion.upsert({
    where: { id: seed.ids.rubric },
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
      id: seed.ids.rubric,
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
    where: { id: seed.ids.prompt },
    update: {
      moduleId: module.id,
      versionNo: 1,
      systemPrompt: seed.promptSystem,
      userPromptTemplate: seed.promptTemplate,
      examplesJson: JSON.stringify([{ example: seed.promptExample }]),
      active: true,
    },
    create: {
      id: seed.ids.prompt,
      moduleId: module.id,
      versionNo: 1,
      systemPrompt: seed.promptSystem,
      userPromptTemplate: seed.promptTemplate,
      examplesJson: JSON.stringify([{ example: seed.promptExample }]),
      active: true,
    },
  });

  const mcqSet = await prisma.mCQSetVersion.upsert({
    where: { id: seed.ids.mcqSet },
    update: {
      moduleId: module.id,
      versionNo: 1,
      title: seed.mcqSetTitle,
      active: true,
    },
    create: {
      id: seed.ids.mcqSet,
      moduleId: module.id,
      versionNo: 1,
      title: seed.mcqSetTitle,
      active: true,
    },
  });

  await prisma.mCQQuestion.upsert({
    where: { id: seed.ids.mcqQ1 },
    update: {
      mcqSetVersionId: mcqSet.id,
      moduleId: module.id,
      stem: seed.question1.stem,
      optionsJson: JSON.stringify(seed.question1.options),
      correctAnswer: seed.question1.correctAnswer,
      rationale: seed.question1.rationale,
      active: true,
    },
    create: {
      id: seed.ids.mcqQ1,
      mcqSetVersionId: mcqSet.id,
      moduleId: module.id,
      stem: seed.question1.stem,
      optionsJson: JSON.stringify(seed.question1.options),
      correctAnswer: seed.question1.correctAnswer,
      rationale: seed.question1.rationale,
      active: true,
    },
  });

  await prisma.mCQQuestion.upsert({
    where: { id: seed.ids.mcqQ2 },
    update: {
      mcqSetVersionId: mcqSet.id,
      moduleId: module.id,
      stem: seed.question2.stem,
      optionsJson: JSON.stringify(seed.question2.options),
      correctAnswer: seed.question2.correctAnswer,
      rationale: seed.question2.rationale,
      active: true,
    },
    create: {
      id: seed.ids.mcqQ2,
      mcqSetVersionId: mcqSet.id,
      moduleId: module.id,
      stem: seed.question2.stem,
      optionsJson: JSON.stringify(seed.question2.options),
      correctAnswer: seed.question2.correctAnswer,
      rationale: seed.question2.rationale,
      active: true,
    },
  });

  const moduleVersion = await prisma.moduleVersion.upsert({
    where: { id: seed.ids.moduleVersion },
    update: {
      moduleId: module.id,
      versionNo: 1,
      taskText: seed.taskText,
      guidanceText: seed.guidanceText,
      rubricVersionId: rubric.id,
      promptTemplateVersionId: prompt.id,
      mcqSetVersionId: mcqSet.id,
      publishedBy: adminId,
      publishedAt: now,
    },
    create: {
      id: seed.ids.moduleVersion,
      moduleId: module.id,
      versionNo: 1,
      taskText: seed.taskText,
      guidanceText: seed.guidanceText,
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
  const modules = [];
  for (const seed of MODULE_SEEDS) {
    const result = await upsertModuleGraph(admin.id, now, seed);
    modules.push({ moduleId: result.module.id, moduleVersionId: result.moduleVersion.id });
  }

  console.log("Bootstrap seed ensured", {
    adminEmail: admin.email,
    participantEmail: participant.email,
    modules,
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
