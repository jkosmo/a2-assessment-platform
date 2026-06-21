import { adminContentRepository, createAdminContentRepository } from "./adminContentRepository.js";
import { runInTransaction } from "../../db/transaction.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { getBenchmarkExamplesConfig } from "../../config/benchmarkExamples.js";
import { assessmentPolicyCodec, type ModuleAssessmentPolicy } from "../../codecs/assessmentPolicyCodec.js";
import type { AssessmentMode } from "@prisma/client";
import { localizedTextCodec, type LocalizedText, type LocalizedTextObject } from "../../codecs/localizedTextCodec.js";
import { NotFoundError } from "../../errors/AppError.js";
import {
  generateModuleRubric,
  type AssessmentBlueprint,
  type CertificationLevel,
  type GenerationLocale,
  type ModuleRubric,
} from "./llmContentGenerationService.js";
import { hashBlueprint } from "./blueprintHash.js";

type CreateRubricVersionInput = {
  moduleId: string;
  criteria: Record<string, unknown>;
  scalingRule: Record<string, unknown>;
  active: boolean;
};

type CreatePromptTemplateVersionInput = {
  moduleId: string;
  systemPrompt: string;
  userPromptTemplate: string;
  examples: Array<Record<string, unknown>>;
  active?: boolean;
};

type CreateMcqSetVersionInput = {
  moduleId: string;
  title: string;
  active?: boolean;
  questions: Array<{
    stem: string;
    options: string[];
    correctAnswer: string;
    rationale?: string;
  }>;
};

type CreateModuleVersionInput = {
  moduleId: string;
  // #525: for MCQ_ONLY modules taskText/rubric/prompt are absent.
  assessmentMode?: AssessmentMode;
  taskText?: string | null;
  assessorExpectedContent?: string;
  candidateTaskConstraints?: string;
  assessmentBlueprint?: string;
  rubricVersionId?: string | null;
  promptTemplateVersionId?: string | null;
  // #578: absent for FREETEXT_ONLY modules.
  mcqSetVersionId?: string | null;
  submissionSchemaJson?: string;
  assessmentPolicyJson?: string;
};

type CreateModuleInput = {
  title: string;
  description?: string;
  certificationLevel?: string;
  validFrom?: Date;
  validTo?: Date;
  actorId?: string;
};

type CreateBenchmarkExampleVersionInput = {
  moduleId: string;
  basePromptTemplateVersionId: string;
  linkedModuleVersionId?: string;
  examples: Array<Record<string, unknown>>;
  active: boolean;
  actorId?: string;
};

async function ensureModuleExists(moduleId: string) {
  const module = await adminContentRepository.findModuleSummary(moduleId);

  if (!module) {
    throw new Error("Module not found.");
  }

  return module;
}

export async function createModule(input: CreateModuleInput) {
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) {
    throw new Error("validTo must be on or after validFrom.");
  }

  const module = await adminContentRepository.createModule({
    title: input.title,
    description: input.description,
    certificationLevel: input.certificationLevel,
    validFrom: input.validFrom,
    validTo: input.validTo,
    createdById: input.actorId,
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.module,
    entityId: module.id,
    action: auditActions.adminContent.moduleCreated,
    actorId: input.actorId,
    metadata: {
      moduleId: module.id,
      title: module.title,
      certificationLevel: module.certificationLevel ?? null,
      validFrom: module.validFrom?.toISOString() ?? null,
      validTo: module.validTo?.toISOString() ?? null,
    },
  });

  return module;
}

function normalizeLocalizedTitleSeed(title: string | null | undefined): LocalizedTextObject {
  const parsed = localizedTextCodec.parse(title);
  if (parsed && typeof parsed === "object") {
    return { ...parsed };
  }

  const fallback = typeof parsed === "string" ? parsed.trim() : "";
  if (!fallback) {
    return {};
  }

  return {
    "en-GB": fallback,
    nb: fallback,
    nn: fallback,
  };
}

function normalizeLocalizedTitlePatch(titlePatch: LocalizedText): LocalizedTextObject {
  if (typeof titlePatch === "string") {
    const normalized = titlePatch.trim();
    if (!normalized) {
      return {};
    }
    return {
      "en-GB": normalized,
      nb: normalized,
      nn: normalized,
    };
  }

  const normalizedEntries = Object.entries(titlePatch).filter(
    ([, value]) => typeof value === "string" && value.trim().length > 0,
  );
  return Object.fromEntries(normalizedEntries) as LocalizedTextObject;
}

export async function updateModuleTitle(moduleId: string, titlePatch: LocalizedText, actorId: string) {
  const existingModule = await adminContentRepository.findModuleTitle(moduleId);
  if (!existingModule) {
    throw new NotFoundError("Module", "module_not_found", "Module not found.");
  }

  const title = localizedTextCodec.serialize({
    ...normalizeLocalizedTitleSeed(existingModule.title),
    ...normalizeLocalizedTitlePatch(titlePatch),
  });
  const module = await adminContentRepository.updateModuleTitle(moduleId, title);
  await recordAuditEvent({
    entityType: auditEntityTypes.module,
    entityId: moduleId,
    action: auditActions.adminContent.moduleTitleUpdated,
    actorId,
    metadata: { moduleId, title },
  });
  return module;
}

// v1.2.11: bulk-purge alle uplubliserte moduler (activeVersionId=null) som ikke er i kurs
// og ikke har submissions. Brukt av "Rydd stage"-knappen i modul-bibliotek-toolbaren —
// kun ADMINISTRATOR. Hver modul slettes i egen transaksjon så én delvis feil ikke ruller
// tilbake hele batchen.
export type PurgeCandidate = {
  id: string;
  title: string;
  updatedAt: Date;
  submissions: number;
  courseModules: number;
  versions: number;
  reasonSkipped: string | null;
};

export type PurgeResult = {
  deleted: Array<{ id: string; title: string }>;
  skipped: Array<{ id: string; title: string; reason: string }>;
  failed: Array<{ id: string; title: string; message: string }>;
};

export async function listUnpublishedPurgeCandidates(): Promise<PurgeCandidate[]> {
  const candidates = await adminContentRepository.listPurgeCandidates();
  return candidates.map((m) => {
    const reasons: string[] = [];
    if (m._count.submissions > 0) reasons.push(`${m._count.submissions} submissions`);
    if (m._count.courseModules > 0) reasons.push(`in ${m._count.courseModules} course(s)`);
    if (m._count.certificationStatuses > 0) reasons.push(`${m._count.certificationStatuses} certification statuses`);
    return {
      id: m.id,
      title: m.title,
      updatedAt: m.updatedAt,
      submissions: m._count.submissions,
      courseModules: m._count.courseModules,
      versions: m._count.versions,
      reasonSkipped: reasons.length > 0 ? reasons.join("; ") : null,
    };
  });
}

export async function purgeUnpublishedModules(actorId: string): Promise<PurgeResult> {
  const candidates = await listUnpublishedPurgeCandidates();
  const result: PurgeResult = { deleted: [], skipped: [], failed: [] };

  for (const candidate of candidates) {
    if (candidate.reasonSkipped) {
      result.skipped.push({ id: candidate.id, title: candidate.title, reason: candidate.reasonSkipped });
      continue;
    }
    try {
      await runInTransaction(async (tx) => {
        // FKs på Module-relasjoner er Restrict, så vi må slette barn først i riktig
        // rekkefølge: moduleVersions har FK til rubric/prompt/mcq-set-versions, så slett
        // moduleVersions først; deretter mcqQuestions (FK til mcqSetVersion + module);
        // deretter rubric/prompt/mcq-set-versions; til slutt selve modulen.
        await tx.moduleVersion.deleteMany({ where: { moduleId: candidate.id } });
        await tx.mCQQuestion.deleteMany({ where: { moduleId: candidate.id } });
        await tx.mCQSetVersion.deleteMany({ where: { moduleId: candidate.id } });
        await tx.rubricVersion.deleteMany({ where: { moduleId: candidate.id } });
        await tx.promptTemplateVersion.deleteMany({ where: { moduleId: candidate.id } });
        await tx.module.delete({ where: { id: candidate.id } });
      });
      result.deleted.push({ id: candidate.id, title: candidate.title });
      await recordAuditEvent({
        entityType: auditEntityTypes.module,
        entityId: candidate.id,
        action: auditActions.adminContent.moduleDeleted,
        actorId,
        metadata: { moduleId: candidate.id, title: candidate.title, purged: true, source: "bulk_purge_unpublished" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      result.failed.push({ id: candidate.id, title: candidate.title, message });
    }
  }

  return result;
}

export async function deleteModule(moduleId: string, actorId: string) {
  const module = await adminContentRepository.findModuleDeleteSummary(moduleId);

  if (!module) {
    throw new Error("Module not found.");
  }

  const dependencyChecks = [
    ["module versions", module._count.versions],
    ["rubric versions", module._count.rubricVersions],
    ["prompt template versions", module._count.promptTemplateVersions],
    ["MCQ set versions", module._count.mcqSetVersions],
    ["submissions", module._count.submissions],
    ["certification statuses", module._count.certificationStatuses],
  ].filter(([, count]) => typeof count === "number" && count > 0);

  if (module.activeVersionId || dependencyChecks.length > 0) {
    const dependencySummary = [
      module.activeVersionId ? "active published version" : null,
      ...dependencyChecks.map(([label, count]) => `${count} ${label}`),
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Module cannot be deleted because it still has dependencies: ${dependencySummary}.`);
  }

  const deletedModule = await adminContentRepository.deleteModule(moduleId);

  await recordAuditEvent({
    entityType: auditEntityTypes.module,
    entityId: moduleId,
    action: auditActions.adminContent.moduleDeleted,
    actorId,
    metadata: {
      moduleId,
      title: deletedModule.title,
    },
  });

  return deletedModule;
}

async function getNextVersionNo(model: "rubric" | "prompt" | "mcq" | "module", moduleId: string) {
  if (model === "rubric") {
    const latest = await adminContentRepository.findLatestRubricVersion(moduleId);
    return (latest?.versionNo ?? 0) + 1;
  }

  if (model === "prompt") {
    const latest = await adminContentRepository.findLatestPromptTemplateVersion(moduleId);
    return (latest?.versionNo ?? 0) + 1;
  }

  if (model === "mcq") {
    const latest = await adminContentRepository.findLatestMcqSetVersion(moduleId);
    return (latest?.versionNo ?? 0) + 1;
  }

  const latest = await adminContentRepository.findLatestModuleVersion(moduleId);
  return (latest?.versionNo ?? 0) + 1;
}

export async function createRubricVersion(input: CreateRubricVersionInput) {
  await ensureModuleExists(input.moduleId);
  const versionNo = await getNextVersionNo("rubric", input.moduleId);

  return adminContentRepository.createRubricVersion({
    moduleId: input.moduleId,
    versionNo,
    criteriaJson: JSON.stringify(input.criteria),
    scalingRuleJson: JSON.stringify(input.scalingRule),
    active: input.active,
  });
}

// Generic default rubric used as fallback when LLM-based generation fails or is not yet
// available. Matches the historical shape produced by shell.js — keep in sync if behaviour
// changes (#378 / #447). 5 criteria, equal weight, weighted-sum scaling, max_total 20.
const GENERIC_RUBRIC_CRITERIA: Record<string, unknown> = {
  task_comprehension: { weight: 0.2 },
  quality_and_depth: { weight: 0.2 },
  evidence_and_examples: { weight: 0.2 },
  reasoning_and_reflection: { weight: 0.2 },
  clarity_and_structure: { weight: 0.2 },
};
const GENERIC_RUBRIC_SCALING_RULE: Record<string, unknown> = {
  practical_weight: 70,
  max_total: 20,
};

// Translates the LLM-produced ModuleRubric (array of criteria) into the storage shape
// (record keyed by id, weights derived from maxScore). Lives on the backend so shell and
// Avansert produce identical storage shapes (#447). Was previously shell-only.
function moduleRubricToStoragePayload(
  generated: ModuleRubric,
  blueprintHash: string | null = null,
): {
  criteria: Record<string, unknown>;
  scalingRule: Record<string, unknown>;
} {
  const criteria = generated.criteria ?? [];
  const totalMax = criteria.reduce((sum, c) => sum + (Number(c?.maxScore) || 0), 0) || 1;
  const criteriaRecord: Record<string, unknown> = Object.fromEntries(
    criteria.map((c) => [
      String(c.id ?? "criterion"),
      {
        label: c.label ?? "",
        description: c.description ?? "",
        maxScore: Number(c.maxScore) || 0,
        weight: Number(((Number(c.maxScore) || 0) / totalMax).toFixed(2)),
        candidateVisible: Boolean(c.candidateVisible),
      },
    ]),
  );
  return {
    criteria: criteriaRecord,
    scalingRule: {
      practical_weight: 70,
      max_total: totalMax,
      generated_from_task: Boolean(generated.generatedFromTask),
      assessor_notes: String(generated.assessorNotes ?? ""),
      // B3 (#450): record which blueprint produced these criteria, so we can detect
      // drift later when the blueprint changes. Null when no blueprint was used.
      ...(blueprintHash ? { generated_from_blueprint_hash: blueprintHash } : {}),
    },
  };
}

export type EnsureRubricVersionInput = {
  moduleId: string;
  taskText: string;
  assessorExpectedContent: string;
  candidateTaskConstraints?: string;
  certificationLevel: CertificationLevel;
  locale: GenerationLocale;
  blueprint?: AssessmentBlueprint;
  // B3 (#450): when true, skip the "existing rubric" short-circuit and always generate +
  // persist a new RubricVersion. Used by the drift-banner "Regenerer fra ny plan" action.
  force?: boolean;
};

export type EnsureRubricVersionResult = {
  rubricVersion: {
    id: string;
    moduleId: string;
    versionNo: number;
    active: boolean;
    createdAt: Date;
  };
  autoGenerated: boolean;
  reused: boolean;
};

// Idempotent: returns the module's latest RubricVersion if one exists, otherwise generates a
// task-specific rubric via LLM (falling back to generic defaults on failure) and persists
// it as a new RubricVersion. Centralises the "auto-rubric when missing" logic that previously
// lived only in shell-side JS (#447), so Avansert-save and any future save path get the same
// behaviour as shell-save.
export async function ensureRubricVersion(
  input: EnsureRubricVersionInput,
): Promise<EnsureRubricVersionResult> {
  await ensureModuleExists(input.moduleId);

  if (!input.force) {
    const existing = await adminContentRepository.findActiveRubricVersionForModule(input.moduleId);
    if (existing) {
      return {
        rubricVersion: {
          id: existing.id,
          moduleId: existing.moduleId,
          versionNo: existing.versionNo,
          active: existing.active,
          createdAt: existing.createdAt,
        },
        autoGenerated: false,
        reused: true,
      };
    }
  }

  let generated: ModuleRubric | null = null;
  try {
    generated = await generateModuleRubric({
      taskText: input.taskText,
      assessorExpectedContent: input.assessorExpectedContent,
      candidateTaskConstraints: input.candidateTaskConstraints,
      certificationLevel: input.certificationLevel,
      locale: input.locale,
      blueprint: input.blueprint,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[#447] ensureRubricVersion: LLM generation failed for module ${input.moduleId}, falling back to generic defaults. ${message}`,
    );
  }

  const blueprintHash = hashBlueprint(input.blueprint);
  const payload = generated
    ? moduleRubricToStoragePayload(generated, blueprintHash)
    : {
      criteria: GENERIC_RUBRIC_CRITERIA,
      scalingRule: blueprintHash
        ? { ...GENERIC_RUBRIC_SCALING_RULE, generated_from_blueprint_hash: blueprintHash }
        : GENERIC_RUBRIC_SCALING_RULE,
    };

  const rubricVersion = await createRubricVersion({
    moduleId: input.moduleId,
    criteria: payload.criteria,
    scalingRule: payload.scalingRule,
    active: true,
  });

  return {
    rubricVersion,
    autoGenerated: Boolean(generated),
    reused: false,
  };
}

// B3 (#450): "Behold kriteriene"-handling. Updates the active RubricVersion's stored
// blueprint-hash to match the current blueprint without changing criteria — so the drift
// banner hides until the blueprint changes again. Returns null when no rubric exists yet
// (caller should fall back to ensure-rubric).
export async function syncActiveRubricBlueprintHash(
  moduleId: string,
  blueprintHash: string | null,
): Promise<{ rubricVersionId: string; previousHash: string | null; nextHash: string | null } | null> {
  await ensureModuleExists(moduleId);
  const existing = await adminContentRepository.findActiveRubricVersionForModule(moduleId);
  if (!existing) return null;

  let scalingRule: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(existing.scalingRuleJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      scalingRule = parsed as Record<string, unknown>;
    }
  } catch {
    scalingRule = {};
  }

  const previousHash =
    typeof scalingRule.generated_from_blueprint_hash === "string"
      ? (scalingRule.generated_from_blueprint_hash as string)
      : null;

  const nextScalingRule = { ...scalingRule };
  if (blueprintHash) {
    nextScalingRule.generated_from_blueprint_hash = blueprintHash;
  } else {
    delete nextScalingRule.generated_from_blueprint_hash;
  }

  await adminContentRepository.updateRubricVersionScalingRule(
    existing.id,
    JSON.stringify(nextScalingRule),
  );

  return {
    rubricVersionId: existing.id,
    previousHash,
    nextHash: blueprintHash,
  };
}

export async function createPromptTemplateVersion(input: CreatePromptTemplateVersionInput) {
  await ensureModuleExists(input.moduleId);
  const versionNo = await getNextVersionNo("prompt", input.moduleId);

  return adminContentRepository.createPromptTemplateVersion({
    moduleId: input.moduleId,
    versionNo,
    systemPrompt: input.systemPrompt,
    userPromptTemplate: input.userPromptTemplate,
    examplesJson: JSON.stringify(input.examples),
    active: input.active ?? true,
  });
}

export async function createMcqSetVersion(input: CreateMcqSetVersionInput) {
  await ensureModuleExists(input.moduleId);
  const versionNo = await getNextVersionNo("mcq", input.moduleId);

  return adminContentRepository.createMcqSetVersion({
    moduleId: input.moduleId,
    versionNo,
    title: input.title,
    active: input.active ?? true,
    questions: input.questions.map((question) => ({
      moduleId: input.moduleId,
      stem: question.stem,
      optionsJson: JSON.stringify(question.options),
      correctAnswer: question.correctAnswer,
      rationale: question.rationale,
      active: true,
    })),
  });
}

export async function createModuleVersion(input: CreateModuleVersionInput) {
  await ensureModuleExists(input.moduleId);
  const versionNo = await getNextVersionNo("module", input.moduleId);

  const isMcqOnly = input.assessmentMode === "MCQ_ONLY";
  const isFreetextOnly = input.assessmentMode === "FREETEXT_ONLY";

  // MCQ set is required for every mode except FREETEXT_ONLY (#578), and must belong to this module.
  if (!isFreetextOnly) {
    if (!input.mcqSetVersionId) {
      throw new Error("MCQ set version is required for this module type.");
    }
    const mcqSet = await adminContentRepository.findMcqSetSummary(input.mcqSetVersionId);
    if (!mcqSet || mcqSet.moduleId !== input.moduleId) {
      throw new Error("MCQ set version is missing or belongs to another module.");
    }
  }

  // Rubric + prompt are validated for the free-text modes (FREETEXT_PLUS_MCQ + FREETEXT_ONLY),
  // not for MCQ_ONLY (#525/#578).
  if (!isMcqOnly) {
    if (!input.rubricVersionId || !input.promptTemplateVersionId) {
      throw new Error("Rubric and prompt template are required for free-text modules.");
    }
    const [rubric, promptTemplate] = await adminContentRepository.findVersionDependencies({
      rubricVersionId: input.rubricVersionId,
      promptTemplateVersionId: input.promptTemplateVersionId,
      // mcqSet is validated above; "" yields a null 3rd result which we ignore here.
      mcqSetVersionId: input.mcqSetVersionId ?? "",
    });
    if (!rubric || rubric.moduleId !== input.moduleId) {
      throw new Error("Rubric version is missing or belongs to another module.");
    }
    if (!promptTemplate || promptTemplate.moduleId !== input.moduleId) {
      throw new Error("Prompt template version is missing or belongs to another module.");
    }
  }

  return adminContentRepository.createModuleVersion({
    moduleId: input.moduleId,
    versionNo,
    assessmentMode: input.assessmentMode,
    taskText: isMcqOnly ? null : input.taskText,
    assessorExpectedContent: input.assessorExpectedContent,
    candidateTaskConstraints: input.candidateTaskConstraints,
    assessmentBlueprint: input.assessmentBlueprint,
    rubricVersionId: isMcqOnly ? null : input.rubricVersionId,
    promptTemplateVersionId: isMcqOnly ? null : input.promptTemplateVersionId,
    mcqSetVersionId: isFreetextOnly ? null : input.mcqSetVersionId,
    submissionSchemaJson: input.submissionSchemaJson,
    assessmentPolicyJson: input.assessmentPolicyJson,
  });
}

export async function createBenchmarkExampleVersion(input: CreateBenchmarkExampleVersionInput) {
  await ensureModuleExists(input.moduleId);
  const benchmarkConfig = getBenchmarkExamplesConfig();

  const basePromptTemplate = await adminContentRepository.findPromptTemplateSummary(input.basePromptTemplateVersionId);

  if (!basePromptTemplate || basePromptTemplate.moduleId !== input.moduleId) {
    throw new Error("Base prompt template version is missing or belongs to another module.");
  }

  if (input.linkedModuleVersionId) {
    const linkedModuleVersion = await adminContentRepository.findModuleVersionSummary(input.linkedModuleVersionId);

    if (!linkedModuleVersion || linkedModuleVersion.moduleId !== input.moduleId) {
      throw new Error("Linked module version is missing or belongs to another module.");
    }
  }

  if (input.examples.length === 0) {
    throw new Error("At least one benchmark example is required.");
  }

  if (input.examples.length > benchmarkConfig.maxExamplesPerVersion) {
    throw new Error(
      `Benchmark example count exceeds maxExamplesPerVersion (${benchmarkConfig.maxExamplesPerVersion}).`,
    );
  }

  for (const [index, example] of input.examples.entries()) {
    for (const requiredField of benchmarkConfig.requiredFields) {
      if (!(requiredField in example)) {
        throw new Error(`Benchmark example at index ${index} is missing required field '${requiredField}'.`);
      }
      const value = example[requiredField];
      if (typeof value === "string" && value.length > benchmarkConfig.maxTextLength) {
        throw new Error(
          `Benchmark example field '${requiredField}' at index ${index} exceeds maxTextLength (${benchmarkConfig.maxTextLength}).`,
        );
      }
    }
  }

  const versionNo = await getNextVersionNo("prompt", input.moduleId);
  const enrichedExamples = input.examples.map((example, index) => ({
    ...example,
    benchmarkExampleIndex: index + 1,
    sourcePromptTemplateVersionId: input.basePromptTemplateVersionId,
    sourceModuleVersionId: input.linkedModuleVersionId ?? null,
    benchmarkVersionNo: versionNo,
  }));

  const promptTemplateVersion = await adminContentRepository.createPromptTemplateVersion({
    moduleId: input.moduleId,
    versionNo,
    systemPrompt: basePromptTemplate.systemPrompt,
    userPromptTemplate: basePromptTemplate.userPromptTemplate,
    examplesJson: JSON.stringify(enrichedExamples),
    active: input.active,
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.promptTemplateVersion,
    entityId: promptTemplateVersion.id,
    action: auditActions.adminContent.benchmarkExampleVersionCreated,
    actorId: input.actorId,
    metadata: {
      moduleId: input.moduleId,
      promptTemplateVersionId: promptTemplateVersion.id,
      sourcePromptTemplateVersionId: input.basePromptTemplateVersionId,
      sourceModuleVersionId: input.linkedModuleVersionId ?? null,
      benchmarkExampleCount: input.examples.length,
      versionNo: promptTemplateVersion.versionNo,
    },
  });

  return {
    ...promptTemplateVersion,
    sourcePromptTemplateVersionId: input.basePromptTemplateVersionId,
    sourceModuleVersionId: input.linkedModuleVersionId ?? null,
    benchmarkExampleCount: input.examples.length,
  };
}

export async function archiveModule(moduleId: string, actorId: string) {
  const module = await adminContentRepository.findModuleSummary(moduleId);

  if (!module) {
    throw new Error("Module not found.");
  }

  if (module.activeVersionId) {
    throw new Error("Module must be unpublished before it can be archived.");
  }

  if (module.archivedAt) {
    throw new Error("Module is already archived.");
  }

  const result = await adminContentRepository.archiveModule(moduleId, new Date());

  await recordAuditEvent({
    entityType: auditEntityTypes.module,
    entityId: moduleId,
    action: auditActions.adminContent.moduleArchived,
    actorId,
    metadata: { moduleId },
  });

  return result;
}

export async function restoreModule(moduleId: string, actorId: string) {
  const module = await adminContentRepository.findModuleSummary(moduleId);

  if (!module) {
    throw new Error("Module not found.");
  }

  if (!module.archivedAt) {
    throw new Error("Module is not archived.");
  }

  const result = await adminContentRepository.restoreModule(moduleId);

  await recordAuditEvent({
    entityType: auditEntityTypes.module,
    entityId: moduleId,
    action: auditActions.adminContent.moduleRestored,
    actorId,
    metadata: { moduleId },
  });

  return result;
}

export async function unpublishModule(moduleId: string, actorId: string) {
  await ensureModuleExists(moduleId);
  const result = await adminContentRepository.unpublishModule(moduleId);

  await recordAuditEvent({
    entityType: auditEntityTypes.module,
    entityId: moduleId,
    action: auditActions.adminContent.moduleUnpublished,
    actorId,
    metadata: {
      moduleId,
      previousActiveVersionId: result.previousActiveVersionId,
    },
  });

  return result;
}

export async function publishModuleVersion(moduleId: string, moduleVersionId: string, actorId: string) {
  const module = await ensureModuleExists(moduleId);
  const now = new Date();

  const published = await runInTransaction((tx) =>
    createAdminContentRepository(tx).publishModuleVersion(moduleId, moduleVersionId, actorId, now),
  );

  await recordAuditEvent({
    entityType: auditEntityTypes.moduleVersion,
    entityId: moduleVersionId,
    action: auditActions.adminContent.moduleVersionPublished,
    actorId,
    metadata: {
      moduleId,
      moduleVersionId,
      versionNo: published.versionNo,
      previousActiveVersionId: module.activeVersionId,
      publishedAt: published.publishedAt?.toISOString() ?? null,
    },
  });

  return published;
}

type PublishThresholdsInput = {
  moduleId: string;
  totalMin: number;
  mcqMinPercent?: number;
  practicalMinPercent?: number;
  actorId: string;
};

export async function publishModuleVersionWithThresholds(input: PublishThresholdsInput) {
  const module = await ensureModuleExists(input.moduleId);

  if (!module.activeVersionId) {
    throw new Error("Module has no active version to base thresholds on.");
  }

  const sourceVersion = await adminContentRepository.findActiveModuleVersionForClone(module.activeVersionId);

  if (!sourceVersion) {
    throw new Error("Active module version not found.");
  }

  const existingPolicy: ModuleAssessmentPolicy = assessmentPolicyCodec.parse(sourceVersion.assessmentPolicyJson) ?? {};

  const newPassRules: ModuleAssessmentPolicy["passRules"] = {
    ...(existingPolicy.passRules ?? {}),
    totalMin: input.totalMin,
  };
  if (input.mcqMinPercent !== undefined) {
    newPassRules.mcqMinPercent = input.mcqMinPercent;
  }
  if (input.practicalMinPercent !== undefined) {
    newPassRules.practicalMinPercent = input.practicalMinPercent;
  }

  const newPolicy: ModuleAssessmentPolicy = {
    ...existingPolicy,
    passRules: newPassRules,
  };

  const versionNo = await getNextVersionNo("module", input.moduleId);
  const now = new Date();

  const { newVersion, published } = await runInTransaction(async (tx) => {
    const repo = createAdminContentRepository(tx);
    const newVersion = await repo.createModuleVersion({
      moduleId: input.moduleId,
      versionNo,
      taskText: sourceVersion.taskText,
      assessorExpectedContent: sourceVersion.assessorExpectedContent ?? undefined,
      candidateTaskConstraints: sourceVersion.candidateTaskConstraints ?? undefined,
      assessmentBlueprint: sourceVersion.assessmentBlueprint ?? undefined,
      rubricVersionId: sourceVersion.rubricVersionId,
      promptTemplateVersionId: sourceVersion.promptTemplateVersionId,
      mcqSetVersionId: sourceVersion.mcqSetVersionId,
      submissionSchemaJson: sourceVersion.submissionSchemaJson ?? undefined,
      assessmentPolicyJson: assessmentPolicyCodec.serialize(newPolicy),
    });
    const published = await repo.publishModuleVersion(input.moduleId, newVersion.id, input.actorId, now);
    return { newVersion, published };
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.moduleVersion,
    entityId: newVersion.id,
    action: auditActions.adminContent.calibrationThresholdsPublished,
    actorId: input.actorId,
    metadata: {
      moduleId: input.moduleId,
      moduleVersionId: newVersion.id,
      versionNo: newVersion.versionNo,
      sourceVersionId: sourceVersion.id,
      totalMin: input.totalMin,
      mcqMinPercent: input.mcqMinPercent ?? null,
      practicalMinPercent: input.practicalMinPercent ?? null,
      publishedAt: published.publishedAt?.toISOString() ?? null,
    },
  });

  return published;
}
