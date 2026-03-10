import { prisma } from "../db/prisma.js";
import { recordAuditEvent } from "./auditService.js";
import type { SubmissionStatus as SubmissionStatusType } from "@prisma/client";

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
  try {
    const parsed = JSON.parse(redFlagsJson) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.length;
    }
    if (parsed && typeof parsed === "object") {
      return Object.keys(parsed).length;
    }
    return 0;
  } catch {
    return 0;
  }
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
  const module = await prisma.module.findUnique({
    where: { id: input.filters.moduleId },
    select: { id: true, title: true },
  });

  if (!module) {
    throw new Error("module_not_found");
  }

  const submissions = await prisma.submission.findMany({
    where: {
      moduleId: input.filters.moduleId,
      ...(input.filters.moduleVersionId ? { moduleVersionId: input.filters.moduleVersionId } : {}),
      ...(input.filters.statuses.length > 0 ? { submissionStatus: { in: input.filters.statuses } } : {}),
      ...(input.filters.dateFrom || input.filters.dateTo
        ? {
            submittedAt: {
              ...(input.filters.dateFrom ? { gte: input.filters.dateFrom } : {}),
              ...(input.filters.dateTo ? { lte: input.filters.dateTo } : {}),
            },
          }
        : {}),
    },
    orderBy: { submittedAt: "desc" },
    take: input.filters.limit,
    select: {
      id: true,
      submittedAt: true,
      submissionStatus: true,
      moduleVersion: {
        select: {
          id: true,
          versionNo: true,
          promptTemplateVersionId: true,
        },
      },
      user: {
        select: {
          id: true,
        },
      },
      decisions: {
        orderBy: { finalisedAt: "desc" },
        take: 1,
        select: {
          decisionType: true,
          totalScore: true,
          passFailTotal: true,
          practicalScaledScore: true,
          mcqScaledScore: true,
          finalisedAt: true,
          redFlagsJson: true,
        },
      },
      llmEvaluations: {
        orderBy: { evaluatedAt: "desc" },
        take: 1,
        select: {
          manualReviewRecommended: true,
          confidenceNote: true,
          evaluatedAt: true,
        },
      },
      mcqAttempts: {
        where: {
          completedAt: { not: null },
        },
        orderBy: { completedAt: "desc" },
        take: 1,
        select: {
          percentScore: true,
          scaledScore: true,
          passFailMcq: true,
          completedAt: true,
        },
      },
    },
  });

  const promptTemplateVersions = await prisma.promptTemplateVersion.findMany({
    where: { moduleId: input.filters.moduleId },
    orderBy: { versionNo: "desc" },
    select: {
      id: true,
      versionNo: true,
      createdAt: true,
      examplesJson: true,
    },
  });

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

  await recordAuditEvent({
    entityType: "calibration_workspace",
    entityId: module.id,
    action: "calibration_workspace_session_started",
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
      title: module.title,
    },
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
