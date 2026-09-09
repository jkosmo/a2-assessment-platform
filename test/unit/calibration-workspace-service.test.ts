import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../../src/errors/AppError.js";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

const findModuleSummary = vi.fn();
const findSubmissionsForWorkspace = vi.fn();
const findPromptTemplateVersionsForBenchmarkAnchors = vi.fn();
const recordAuditEvent = vi.fn();

vi.mock("../../src/modules/calibration/calibrationRepository.js", () => ({
  calibrationRepository: {
    findModuleSummary,
    findSubmissionsForWorkspace,
    findPromptTemplateVersionsForBenchmarkAnchors,
  },
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

// #994: modulgrafen leses her, ikke i første test. Se test/support/moduleGraphWarmup.ts.
warmModuleGraph(() => import("../../src/modules/calibration/index.js"));

describe("calibration workspace service", () => {
  beforeEach(() => {
    findModuleSummary.mockReset();
    findSubmissionsForWorkspace.mockReset();
    findPromptTemplateVersionsForBenchmarkAnchors.mockReset();
    recordAuditEvent.mockReset();
  });

  it("rejects snapshot requests when the module does not exist", async () => {
    findModuleSummary.mockResolvedValue(null);

    const { getCalibrationWorkspaceSnapshot } = await import("../../src/modules/calibration/index.js");

    await expect(
      getCalibrationWorkspaceSnapshot({
        filters: {
          moduleId: "module-1",
          statuses: [],
          limit: 50,
        },
        signalThresholds: {
          passRateMinimum: 0.7,
          manualReviewRateMaximum: 0.4,
          benchmarkCoverageMinimum: 0.8,
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("builds calibration signals, benchmark anchors, and flags from submission outcomes", async () => {
    findModuleSummary.mockResolvedValue({
      id: "module-1",
      title: "Module One",
    });
    findSubmissionsForWorkspace.mockResolvedValue([
      {
        id: "submission-1",
        submittedAt: new Date("2026-03-10T10:00:00.000Z"),
        submissionStatus: "COMPLETED",
        moduleVersion: {
          id: "module-version-1",
          versionNo: 1,
          promptTemplateVersionId: "prompt-1",
        },
        user: { id: "user-1" },
        decisions: [
          {
            decisionType: "AUTOMATIC",
            totalScore: 80,
            passFailTotal: true,
            practicalScaledScore: 45,
            mcqScaledScore: 35,
            finalisedAt: new Date("2026-03-10T11:00:00.000Z"),
            redFlagsJson: "[\"policy\"]",
          },
        ],
        llmEvaluations: [
          {
            manualReviewRecommended: false,
            confidenceNote: "High",
            evaluatedAt: new Date("2026-03-10T10:30:00.000Z"),
          },
        ],
        mcqAttempts: [
          {
            percentScore: 90,
            scaledScore: 35,
            passFailMcq: true,
            completedAt: new Date("2026-03-10T10:20:00.000Z"),
          },
        ],
      },
      {
        id: "submission-2",
        submittedAt: new Date("2026-03-10T12:00:00.000Z"),
        submissionStatus: "UNDER_REVIEW",
        moduleVersion: {
          id: "module-version-2",
          versionNo: 2,
          promptTemplateVersionId: "prompt-2",
        },
        user: { id: "user-2" },
        decisions: [],
        llmEvaluations: [
          {
            manualReviewRecommended: true,
            confidenceNote: "Escalate",
            evaluatedAt: new Date("2026-03-10T12:30:00.000Z"),
          },
        ],
        mcqAttempts: [],
      },
    ]);
    findPromptTemplateVersionsForBenchmarkAnchors.mockResolvedValue([
      {
        id: "prompt-1",
        versionNo: 1,
        createdAt: new Date("2026-03-01T09:00:00.000Z"),
        examplesJson: JSON.stringify([
          {
            anchorId: "anchor-1",
            benchmarkExampleIndex: 1,
            sourcePromptTemplateVersionId: "prompt-0",
            sourceModuleVersionId: "module-version-1",
          },
        ]),
      },
      {
        id: "prompt-2",
        versionNo: 2,
        createdAt: new Date("2026-03-02T09:00:00.000Z"),
        examplesJson: JSON.stringify([{ freeform: true }]),
      },
    ]);

    const { getCalibrationWorkspaceSnapshot } = await import("../../src/modules/calibration/index.js");

    const snapshot = await getCalibrationWorkspaceSnapshot({
      actorId: "smo-1",
      filters: {
        moduleId: "module-1",
        statuses: ["COMPLETED", "UNDER_REVIEW"],
        dateFrom: new Date("2026-03-01T00:00:00.000Z"),
        dateTo: new Date("2026-03-31T23:59:59.000Z"),
        limit: 50,
      },
      signalThresholds: {
        passRateMinimum: 0.8,
        manualReviewRateMaximum: 0.2,
        benchmarkCoverageMinimum: 0.75,
      },
    });

    expect(findSubmissionsForWorkspace).toHaveBeenCalledWith({
      moduleId: "module-1",
      moduleVersionId: undefined,
      statuses: ["COMPLETED", "UNDER_REVIEW"],
      dateFrom: new Date("2026-03-01T00:00:00.000Z"),
      dateTo: new Date("2026-03-31T23:59:59.000Z"),
      limit: 50,
    });
    expect(snapshot.module).toEqual({
      id: "module-1",
      title: "Module One",
      activeVersionId: null,
    });
    expect(snapshot.outcomes).toHaveLength(2);
    expect(snapshot.outcomes[0]).toMatchObject({
      submissionId: "submission-1",
      promptTemplateVersionId: "prompt-1",
      redFlagCount: 1,
    });
    expect(snapshot.benchmarkAnchors).toEqual([
      {
        promptTemplateVersionId: "prompt-1",
        promptTemplateVersionNo: 1,
        createdAt: new Date("2026-03-01T09:00:00.000Z"),
        benchmarkExampleCount: 1,
        sourcePromptTemplateVersionId: "prompt-0",
        sourceModuleVersionId: "module-version-1",
      },
    ]);
    expect(snapshot.signals).toMatchObject({
      outcomeCount: 2,
      decisionCount: 1,
      passCount: 1,
      failCount: 0,
      underReviewCount: 1,
      passRate: 1,
      manualReviewRate: 0.5,
      averageTotalScore: 80,
      outcomePromptTemplateCount: 2,
      benchmarkPromptTemplateCount: 1,
      coveredPromptTemplateCount: 1,
      benchmarkCoverageRate: 0.5,
    });
    expect(snapshot.signals.flags).toEqual([
      {
        code: "HIGH_MANUAL_REVIEW_RATE",
        actual: 0.5,
        threshold: 0.2,
        message: "Manual review rate is above configured calibration threshold.",
      },
      {
        code: "LOW_BENCHMARK_COVERAGE",
        actual: 0.5,
        threshold: 0.75,
        message: "Benchmark anchor coverage is below configured threshold.",
      },
    ]);
    expect(recordAuditEvent).toHaveBeenCalledWith({
      entityType: "calibration_workspace",
      entityId: "module-1",
      action: "calibration_workspace_session_started",
      actorId: "smo-1",
      metadata: {
        moduleId: "module-1",
        moduleVersionId: null,
        statuses: ["COMPLETED", "UNDER_REVIEW"],
        dateFrom: "2026-03-01T00:00:00.000Z",
        dateTo: "2026-03-31T23:59:59.000Z",
        limit: 50,
        outcomeCount: 2,
        benchmarkAnchorCount: 1,
      },
    });
  });

  // ⚠️ #948 / QA-funn F1: en sak som VENTER på sensor er verken bestått eller strøket.
  //
  // Før #948 bar et ventende vedtak `passFailTotal: true` og ble talt som BESTÅTT — smigrende.
  // Etter #948 bærer det `false` og ble talt som STRØKET — alarmerende: kvalitetsflagget
  // LOW_PASS_RATE fyrte på et forsøk maskinen ga 72 av terskel 70, som ingen hadde strøket.
  //
  // Denne testen krever at den ventende saken holdes UTENFOR både telleren og nevneren. Fiksturen
  // har derfor én avgjort STRØKET og én ventende — hadde den ventende talt med, ville passRate
  // vært 0 i stedet for null, og flagget hadde fyrt.
  it("#948: en sak som venter på sensor teller verken som bestått eller strøket", async () => {
    findModuleSummary.mockResolvedValue({ id: "module-1", title: "Module One" });
    findPromptTemplateVersionsForBenchmarkAnchors.mockResolvedValue([]);
    findSubmissionsForWorkspace.mockResolvedValue([
      {
        id: "submission-pending",
        submittedAt: new Date("2026-03-11T10:00:00.000Z"),
        // Terskelen passerte (72 ≥ 70), men saken er rutet til sensor.
        submissionStatus: "UNDER_REVIEW",
        moduleVersion: { id: "module-version-1", versionNo: 1, promptTemplateVersionId: "prompt-1" },
        user: { id: "user-pending" },
        decisions: [
          {
            decisionType: "AUTOMATIC",
            totalScore: 72,
            passFailTotal: false,
            practicalScaledScore: 42,
            mcqScaledScore: 30,
            finalisedAt: new Date("2026-03-11T11:00:00.000Z"),
            redFlagsJson: "[]",
          },
        ],
        llmEvaluations: [],
        mcqAttempts: [],
      },
    ]);

    const { getCalibrationWorkspaceSnapshot } = await import("../../src/modules/calibration/index.js");
    const snapshot = await getCalibrationWorkspaceSnapshot({
      filters: { moduleId: "module-1", statuses: ["COMPLETED", "UNDER_REVIEW"], limit: 50 },
      signalThresholds: { passRateMinimum: 0.7, manualReviewRateMaximum: 0.4, benchmarkCoverageMinimum: 0.8 },
    });

    expect(snapshot.signals).toMatchObject({
      outcomeCount: 1,
      passCount: 0,
      failCount: 0,
      underReviewCount: 1,
      // Ingen avgjorte saker ⇒ ingen rate. IKKE 0 — det ville påstått at ingen består.
      passRate: null,
    });
    // Og da skal kvalitetsflagget for lav bestått-rate ikke fyre.
    expect(snapshot.signals.flags.map((flag: { code: string }) => flag.code)).not.toContain("LOW_PASS_RATE");
  });

  // Motprøven: en AVGJORT strøket sak skal fortsatt telle. Uten den ville «hopp over alt» også
  // vært grønt, og da hadde kalibreringen sluttet å måle noe som helst.
  it("#948: en avgjort strøket sak teller fortsatt som strøket", async () => {
    findModuleSummary.mockResolvedValue({ id: "module-1", title: "Module One" });
    findPromptTemplateVersionsForBenchmarkAnchors.mockResolvedValue([]);
    findSubmissionsForWorkspace.mockResolvedValue([
      {
        id: "submission-settled-fail",
        submittedAt: new Date("2026-03-11T10:00:00.000Z"),
        submissionStatus: "COMPLETED",
        moduleVersion: { id: "module-version-1", versionNo: 1, promptTemplateVersionId: "prompt-1" },
        user: { id: "user-settled" },
        decisions: [
          {
            decisionType: "AUTOMATIC",
            totalScore: 40,
            passFailTotal: false,
            practicalScaledScore: 20,
            mcqScaledScore: 20,
            finalisedAt: new Date("2026-03-11T11:00:00.000Z"),
            redFlagsJson: "[]",
          },
        ],
        llmEvaluations: [],
        mcqAttempts: [],
      },
    ]);

    const { getCalibrationWorkspaceSnapshot } = await import("../../src/modules/calibration/index.js");
    const snapshot = await getCalibrationWorkspaceSnapshot({
      filters: { moduleId: "module-1", statuses: ["COMPLETED"], limit: 50 },
      signalThresholds: { passRateMinimum: 0.7, manualReviewRateMaximum: 0.4, benchmarkCoverageMinimum: 0.8 },
    });

    expect(snapshot.signals).toMatchObject({ passCount: 0, failCount: 1, passRate: 0 });
  });
});
