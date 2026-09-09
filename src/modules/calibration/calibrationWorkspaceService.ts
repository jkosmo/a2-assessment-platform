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
import {
  parseAiInfluencePersisted,
  resolveContentSimilarityRules,
  type AiInfluenceContentRules,
} from "../assessment/aiInfluence.js";
import type { ModuleAssessmentPolicy } from "../../codecs/assessmentPolicyCodec.js";

// #475: declaration groups shown in the content-similarity calibration report, in display order.
const DECLARATION_ORDER = ["none", "ideas", "improve", "autonomous", "undeclared"] as const;

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return round2(sortedAsc[idx]);
}

/**
 * #475: build the content-similarity distribution for the calibration report from the persisted
 * aiInfluenceJson of each submission's latest decision. Histogram (20 bins over 0–1) with per-
 * declaration counts, plus per-declaration stats — so a product owner can see whether AI-declared and
 * suspicious "declared none but high-similarity" answers separate from the honest bulk.
 */
export function buildContentSimilarityReport(
  aiInfluenceJsons: Array<string | null | undefined>,
  rules: AiInfluenceContentRules,
) {
  const BIN_COUNT = 20;
  const bins = Array.from({ length: BIN_COUNT }, (_, i) => ({
    from: round2(i / BIN_COUNT),
    to: round2((i + 1) / BIN_COUNT),
    byDeclaration: {} as Record<string, number>,
  }));
  const simsByDeclaration = new Map<string, number[]>();
  const allSims: number[] = [];

  for (const raw of aiInfluenceJsons) {
    const parsed = parseAiInfluencePersisted(raw);
    const sim = parsed?.contentSimilarity?.similarity;
    if (typeof sim !== "number") continue;
    const declaration = parsed?.declaration ?? "undeclared";
    allSims.push(sim);
    const idx = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor(sim * BIN_COUNT)));
    bins[idx].byDeclaration[declaration] = (bins[idx].byDeclaration[declaration] ?? 0) + 1;
    if (!simsByDeclaration.has(declaration)) simsByDeclaration.set(declaration, []);
    simsByDeclaration.get(declaration)!.push(sim);
  }

  const threshold = rules.similarityThreshold;
  const sortedAll = [...allSims].sort((a, b) => a - b);
  const byDeclaration = Array.from(simsByDeclaration.entries())
    .map(([declaration, sims]) => {
      const sorted = [...sims].sort((a, b) => a - b);
      return {
        declaration,
        count: sorted.length,
        median: percentile(sorted, 0.5),
        p90: percentile(sorted, 0.9),
        max: sorted.length > 0 ? round2(sorted[sorted.length - 1]) : null,
        overThresholdCount: sorted.filter((x) => x >= threshold).length,
      };
    })
    .sort(
      (a, b) =>
        DECLARATION_ORDER.indexOf(a.declaration as (typeof DECLARATION_ORDER)[number]) -
        DECLARATION_ORDER.indexOf(b.declaration as (typeof DECLARATION_ORDER)[number]),
    );

  return {
    enabled: rules.enabled,
    shadowMode: rules.shadowMode,
    threshold,
    count: allSims.length,
    median: percentile(sortedAll, 0.5),
    p90: percentile(sortedAll, 0.9),
    overThresholdCount: allSims.filter((x) => x >= threshold).length,
    bins,
    byDeclaration,
  };
}

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
  // #948: en sak som VENTER paa sensor er verken bestaatt eller stroeket, og skal ikke telle i en
  // bestaatt-rate i det hele tatt.
  //
  // ⚠️ Foer #948 bar et ventende vedtak `passFailTotal: true` og ble talt som BESTAATT — en
  // smigrende feil. Etter #948 baerer det `false`, og ble talt som STROEKET — en alarmerende feil
  // som fyrte LOW_PASS_RATE paa et forsoek maskinen ga 72 av terskel 70. Begge er feil paa samme
  // maate: de gjoer en ikke-avgjort sak om til et datapunkt.
  //
  // Dette avgjoer IKKE den aapne KPI-beslutningen (skal raten maale raavedtaket eller det endelige
  // utfallet?). Den handler om saker som ER avgjort. Her utelates bare de som ikke er det.
  const settledDecisions = outcomes
    .filter((outcome) => outcome.decision !== null && outcome.submissionStatus !== "UNDER_REVIEW")
    .map((outcome) => outcome.decision!);
  const settledDecisionCount = settledDecisions.length;
  const passCount = settledDecisions.filter((decision) => decision.passFailTotal === true).length;
  const failCount = settledDecisions.filter((decision) => decision.passFailTotal === false).length;
  const underReviewCount = outcomes.filter((outcome) => outcome.submissionStatus === "UNDER_REVIEW").length;
  const manualReviewSignalCount = outcomes.filter(
    (outcome) => outcome.submissionStatus === "UNDER_REVIEW" || outcome.llm?.manualReviewRecommended === true,
  ).length;
  const passRate = settledDecisionCount > 0 ? round2(passCount / settledDecisionCount) : null;
  const manualReviewRate = outcomeCount > 0 ? round2(manualReviewSignalCount / outcomeCount) : null;
  const averageTotalScore =
    decisionCount > 0 ? round2(decisions.reduce((sum, decision) => sum + decision.totalScore, 0) / decisionCount) : null;

  // MCQ_ONLY decisions have no prompt template (#525) — exclude nulls from coverage stats.
  const outcomePromptTemplateIds = new Set(
    outcomes
      .map((outcome) => outcome.promptTemplateVersionId)
      .filter((id): id is string => id !== null),
  );
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
  const hasModuleOverrides =
    modulePolicy?.passRules?.totalMin != null ||
    modulePolicy?.passRules?.mcqMinPercent != null ||
    modulePolicy?.passRules?.practicalMinPercent != null;

  const effectiveThresholds = {
    totalMin: modulePolicy?.passRules?.totalMin ?? rules.thresholds.totalMin,
    mcqMinPercent: modulePolicy?.passRules?.mcqMinPercent ?? null,
    practicalMinPercent: modulePolicy?.passRules?.practicalMinPercent ?? null,
    source: hasModuleOverrides ? ("module_policy" as const) : ("global_defaults" as const),
  };

  // #475: content-similarity distribution for this module (from persisted aiInfluenceJson).
  const contentSimilarity = buildContentSimilarityReport(
    submissions.map((s) => s.decisions[0]?.aiInfluenceJson ?? null),
    resolveContentSimilarityRules(modulePolicy as ModuleAssessmentPolicy | null, rules.aiInfluence.contentSimilarity),
  );

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
    contentSimilarity,
  };
}
