import { NotFoundError } from "../../errors/AppError.js";
import { calibrationRepository } from "./calibrationRepository.js";
import { recordAuditEvent } from "../../services/auditService.js";
import type { SubmissionStatus as SubmissionStatusType } from "@prisma/client";
import { assessmentPolicyCodec } from "../../codecs/assessmentPolicyCodec.js";
import { redFlagsCodec } from "../../codecs/redFlagsCodec.js";
import { getAssessmentRules } from "../../config/assessmentRules.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { localizeContentText } from "../../i18n/content.js";
import { normalizeLocale } from "../../i18n/locale.js";

export type CalibrationWorkspaceFilters = {
  moduleId: string;
  moduleVersionId?: string;
  statuses: SubmissionStatusType[];
  dateFrom?: Date;
  dateTo?: Date;
  limit: number;
};

export type CalibrationSignalThresholds = {
  passRateMinimum: number;
  manualReviewRateMaximum: number;
  benchmarkCoverageMinimum: number;
};

type CalibrationWorkspaceInput = {
  filters: CalibrationWorkspaceFilters;
  signalThresholds: CalibrationSignalThresholds;
  actorId?: string;
  locale?: string;
};

type BenchmarkAnchor = {
  promptTemplateVersionId: string;
  promptTemplateVersionNo: number;
  createdAt: Date;
  benchmarkExampleCount: number;
  sourcePromptTemplateVersionId: string | null;
  sourceModuleVersionId: string | null;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function parseRedFlagCount(redFlagsJson: string) {
  return redFlagsCodec.parse(redFlagsJson).length;
}

function parseBenchmarkExamples(rawJson: string) {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as Array<Record<string, unknown>>;
    }

    return parsed.filter((entry): entry is Record<string, unknown> => {
      return Boolean(entry && typeof entry === "object");
    });
  } catch {
    return [] as Array<Record<string, unknown>>;
  }
}

function toStringOrNull(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function safeParsePolicy(json: string | null | undefined) {
  return assessmentPolicyCodec.parse(json);
}

function buildBenchmarkAnchors(
  versions: Array<{
    id: string;
    versionNo: number;
    createdAt: Date;
    examplesJson: string;
  }>,
): BenchmarkAnchor[] {
  const anchors: BenchmarkAnchor[] = [];

  for (const version of versions) {
    const examples = parseBenchmarkExamples(version.examplesJson);
    const benchmarkExamples = examples.filter((example) => "benchmarkExampleIndex" in example);
    if (benchmarkExamples.length === 0) {
      continue;
    }

    const sourcePromptTemplateVersionId = toStringOrNull(
      benchmarkExamples.find((example) => toStringOrNull(example.sourcePromptTemplateVersionId))?.sourcePromptTemplateVersionId,
    );
    const sourceModuleVersionId = toStringOrNull(
      benchmarkExamples.find((example) => toStringOrNull(example.sourceModuleVersionId))?.sourceModuleVersionId,
    );

    anchors.push({
      promptTemplateVersionId: version.id,
      promptTemplateVersionNo: version.versionNo,
      createdAt: version.createdAt,
      benchmarkExampleCount: benchmarkExamples.length,
      sourcePromptTemplateVersionId,
      sourceModuleVersionId,
    });
  }

  return anchors;
}

export async function getCalibrationWorkspaceSnapshot(input: CalibrationWorkspaceInput) {
  const module = await calibrationRepository.findModuleSummary(input.filters.moduleId);

  if (!module) {
    throw new NotFoundError("Module");
  }

  const submissions = await calibrationRepository.findSubmissionsForWorkspace({
    moduleId: input.filters.moduleId,
    moduleVersionId: input.filters.moduleVersionId,
    statuses: input.filters.statuses,
    dateFrom: input.filters.dateFrom,
    dateTo: input.filters.dateTo,
    limit: input.filters.limit,
  });

  const promptTemplateVersions = await calibrationRepository.findPromptTemplateVersionsForBenchmarkAnchors(
    input.filters.moduleId,
  );

  const benchmarkAnchors = buildBenchmarkAnchors(promptTemplateVersions);

  const outcomes = submissions.map((submission) => {
    const decision = submission.decisions[0] ?? null;
    const llm = submission.llmEvaluations[0] ?? null;
    const mcq = submission.mcqAttempts[0] ?? null;
    return {
      submissionId: submission.id,
      participantRef: submission.user.id,
      submittedAt: submission.submittedAt,
      submissionStatus: submission.submissionStatus,
      moduleVersionId: submission.moduleVersion.id,
      moduleVersionNo: submission.moduleVersion.versionNo,
      promptTemplateVersionId: submission.moduleVersion.promptTemplateVersionId,
      decision: decision
        ? {
            decisionType: decision.decisionType,
            totalScore: decision.totalScore,
            passFailTotal: decision.passFailTotal,
            practicalScaledScore: decision.practicalScaledScore,
            mcqScaledScore: decision.mcqScaledScore,
            finalisedAt: decision.finalisedAt,
          }
        : null,
      redFlagCount: decision ? parseRedFlagCount(decision.redFlagsJson) : 0,
      mcq: mcq
        ? {
            percentScore: mcq.percentScore,
            scaledScore: mcq.scaledScore,
            passFailMcq: mcq.passFailMcq,
            completedAt: mcq.completedAt,
          }
        : null,
      llm: llm
        ? {
            manualReviewRecommended: llm.manualReviewRecommended,
            confidenceNote: llm.confidenceNote,
            evaluatedAt: llm.evaluatedAt,
          }
        : null,
    };
  });

  const outcomeCount = outcomes.length;
  const decisions = outcomes.filter((outcome) => outcome.decision !== null).map((outcome) => outcome.decision!);
  const decisionCount = decisions.length;
  const passCount = decisions.filter((decision) => decision.passFailTotal === true).length;
  const failCount = decisions.filter((decision) => decision.passFailTotal === false).length;
  const underReviewCount = outcomes.filter((outcome) => outcome.submissionStatus === "UNDER_REVIEW").length;
  const manualReviewSignalCount = outcomes.filter(
    (outcome) => outcome.submissionStatus === "UNDER_REVIEW" || outcome.llm?.manualReviewRecommended === true,
  ).length;
  const passRate = decisionCount > 0 ? round2(passCount / decisionCount) : null;
  const manualReviewRate = outcomeCount > 0 ? round2(manualReviewSignalCount / outcomeCount) : null;
  const averageTotalScore =
    decisionCount > 0 ? round2(decisions.reduce((sum, decision) => sum + decision.totalScore, 0) / decisionCount) : null;

  const outcomePromptTemplateIds = new Set(outcomes.map((outcome) => outcome.promptTemplateVersionId));
  const benchmarkPromptTemplateIds = new Set(
    benchmarkAnchors.map((anchor) => anchor.promptTemplateVersionId),
  );
  const coveredPromptTemplateCount = Array.from(outcomePromptTemplateIds).filter((id) =>
    benchmarkPromptTemplateIds.has(id),
  ).length;
  const benchmarkCoverageRate =
    outcomePromptTemplateIds.size > 0 ? round2(coveredPromptTemplateCount / outcomePromptTemplateIds.size) : null;

  const flags: Array<{
    code: string;
    actual: number;
    threshold: number;
    message: string;
  }> = [];

  if (passRate !== null && passRate < input.signalThresholds.passRateMinimum) {
    flags.push({
      code: "LOW_PASS_RATE",
      actual: passRate,
      threshold: input.signalThresholds.passRateMinimum,
      message: "Pass rate is below configured calibration threshold.",
    });
  }
  if (
    manualReviewRate !== null &&
    manualReviewRate > input.signalThresholds.manualReviewRateMaximum
  ) {
    flags.push({
      code: "HIGH_MANUAL_REVIEW_RATE",
      actual: manualReviewRate,
      threshold: input.signalThresholds.manualReviewRateMaximum,
      message: "Manual review rate is above configured calibration threshold.",
    });
  }
  if (
    benchmarkCoverageRate !== null &&
    benchmarkCoverageRate < input.signalThresholds.benchmarkCoverageMinimum
  ) {
    flags.push({
      code: "LOW_BENCHMARK_COVERAGE",
      actual: benchmarkCoverageRate,
      threshold: input.signalThresholds.benchmarkCoverageMinimum,
      message: "Benchmark anchor coverage is below configured threshold.",
    });
  }

  const rules = getAssessmentRules();
  const modulePolicy = safeParsePolicy(module.activeVersion?.assessmentPolicyJson);
  const hasModuleOverrides = modulePolicy?.passRules?.totalMin != null;

  const effectiveThresholds = {
    totalMin: modulePolicy?.passRules?.totalMin ?? rules.thresholds.totalMin,
    source: hasModuleOverrides ? ("module_policy" as const) : ("global_defaults" as const),
  };

  await recordAuditEvent({
    entityType: auditEntityTypes.calibrationWorkspace,
    entityId: module.id,
    action: auditActions.calibration.workspaceSessionStarted,
    actorId: input.actorId,
    metadata: {
      moduleId: module.id,
      moduleVersionId: input.filters.moduleVersionId ?? null,
      statuses: input.filters.statuses,
      dateFrom: input.filters.dateFrom?.toISOString() ?? null,
      dateTo: input.filters.dateTo?.toISOString() ?? null,
      limit: input.filters.limit,
      outcomeCount,
      benchmarkAnchorCount: benchmarkAnchors.length,
    },
  });

  return {
    module: {
      id: module.id,
      title: localizeContentText(normalizeLocale(input.locale) ?? "en-GB", module.title) ?? module.title,
      activeVersionId: module.activeVersionId ?? null,
    },
    effectiveThresholds,
    filters: {
      moduleId: input.filters.moduleId,
      moduleVersionId: input.filters.moduleVersionId ?? null,
      statuses: input.filters.statuses,
      dateFrom: input.filters.dateFrom ?? null,
      dateTo: input.filters.dateTo ?? null,
      limit: input.filters.limit,
    },
    outcomes,
    benchmarkAnchors,
    signals: {
      outcomeCount,
      decisionCount,
      passCount,
      failCount,
      underReviewCount,
      passRate,
      manualReviewRate,
      averageTotalScore,
      outcomePromptTemplateCount: outcomePromptTemplateIds.size,
      benchmarkPromptTemplateCount: benchmarkPromptTemplateIds.size,
      coveredPromptTemplateCount,
      benchmarkCoverageRate,
      flags,
    },
  };
}
