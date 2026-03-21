import { env } from "../config/env.js";
import { evaluatePracticalWithLlm } from "../modules/assessment/llmAssessmentService.js";
import { resolveAssessmentDecision } from "../modules/assessment/decisionService.js";
import {
  evaluateSecondaryAssessmentDisagreement,
  evaluateSecondaryAssessmentTrigger,
} from "../modules/assessment/secondaryAssessmentService.js";
import { shouldSuppressManualReviewForInsufficientEvidenceDisagreement } from "../modules/assessment/assessmentDecisionSignals.js";
import { assessmentBatchCases, type AssessmentBatchCase, type BatchExpectedOutcome } from "./assessmentBatchCases.js";

type BatchRunRecord = {
  caseId: string;
  iteration: number;
  expectedOutcome: BatchExpectedOutcome;
  actualOutcome: BatchExpectedOutcome;
  matchedExpectation: boolean;
  decisionReason: string;
  confidenceNote: string;
  recommendedOutcome: string | null;
  manualReviewReasonCode: string | null;
  redFlags: Array<{ code: string; severity: string }>;
  secondaryRan: boolean;
};

function parseCliArgs(argv: string[]) {
  let repeat = 10;
  let caseFilter: string | null = null;
  let allowStub = false;

  for (const arg of argv) {
    if (arg.startsWith("--repeat=")) {
      repeat = Number(arg.slice("--repeat=".length));
    } else if (arg.startsWith("--case=")) {
      caseFilter = arg.slice("--case=".length);
    } else if (arg === "--allow-stub") {
      allowStub = true;
    }
  }

  if (!Number.isInteger(repeat) || repeat <= 0) {
    throw new Error("--repeat must be a positive integer.");
  }

  return { repeat, caseFilter, allowStub };
}

function mapDecisionToOutcome(needsManualReview: boolean, passFailTotal: boolean): BatchExpectedOutcome {
  if (needsManualReview) {
    return "UNDER_REVIEW";
  }

  return passFailTotal ? "PASS" : "FAIL";
}

async function runSingleIteration(
  assessmentCase: AssessmentBatchCase,
  iteration: number,
): Promise<BatchRunRecord> {
  const primaryResult = await evaluatePracticalWithLlm({
    moduleId: assessmentCase.moduleId,
    responseJson: assessmentCase.responseJson,
    responseLocale: "en-GB",
    moduleTaskText: assessmentCase.moduleTaskText,
    moduleGuidanceText: assessmentCase.moduleGuidanceText,
    assessmentPass: "primary",
  });

  let finalResult = primaryResult;
  let secondaryRan = false;
  let forceManualReviewReason: string | undefined;

  const secondaryTrigger = evaluateSecondaryAssessmentTrigger({
    moduleId: assessmentCase.moduleId,
    primaryResult,
  });

  if (secondaryTrigger.shouldRun) {
    secondaryRan = true;
    const secondaryResult = await evaluatePracticalWithLlm({
      moduleId: assessmentCase.moduleId,
      responseJson: assessmentCase.responseJson,
      responseLocale: "en-GB",
      moduleTaskText: assessmentCase.moduleTaskText,
      moduleGuidanceText: assessmentCase.moduleGuidanceText,
      assessmentPass: "secondary",
    });

    finalResult = secondaryResult;
    const disagreement = evaluateSecondaryAssessmentDisagreement(primaryResult, secondaryResult);
    if (
      disagreement.hasDisagreement &&
      !shouldSuppressManualReviewForInsufficientEvidenceDisagreement(primaryResult, secondaryResult)
    ) {
      forceManualReviewReason =
        "Automatically routed to manual review due to disagreement between primary and secondary LLM assessments.";
    }
  }

  const resolved = resolveAssessmentDecision({
    mcqScaledScore: assessmentCase.mcqScaledScore,
    mcqPercentScore: assessmentCase.mcqPercentScore,
    llmResult: finalResult,
    forceManualReviewReason,
  });

  const actualOutcome = mapDecisionToOutcome(resolved.needsManualReview, resolved.passFailTotal);

  return {
    caseId: assessmentCase.id,
    iteration,
    expectedOutcome: assessmentCase.expectedOutcome,
    actualOutcome,
    matchedExpectation: actualOutcome === assessmentCase.expectedOutcome,
    decisionReason: resolved.decisionReason,
    confidenceNote: finalResult.confidence_note,
    recommendedOutcome: finalResult.recommended_outcome ?? null,
    manualReviewReasonCode: finalResult.manual_review_reason_code ?? null,
    redFlags: finalResult.red_flags.map((flag) => ({
      code: flag.code,
      severity: flag.severity,
    })),
    secondaryRan,
  };
}

async function main() {
  const { repeat, caseFilter, allowStub } = parseCliArgs(process.argv.slice(2));
  if (env.LLM_MODE !== "azure_openai" && !allowStub) {
    throw new Error(
      "Batch regression is intended for LLM_MODE=azure_openai. Re-run with --allow-stub only when smoke-testing the harness itself.",
    );
  }
  const selectedCases = caseFilter
    ? assessmentBatchCases.filter((assessmentCase) => assessmentCase.id === caseFilter)
    : assessmentBatchCases;

  if (selectedCases.length === 0) {
    throw new Error(`No batch case matched '${caseFilter ?? ""}'.`);
  }

  console.log(
    `Running assessment batch regression with LLM_MODE=${env.LLM_MODE}, repeat=${repeat}, cases=${selectedCases.length}`,
  );

  const records: BatchRunRecord[] = [];

  for (const assessmentCase of selectedCases) {
    console.log(`\nCase: ${assessmentCase.id} (${assessmentCase.expectedOutcome})`);
    console.log(`Description: ${assessmentCase.description}`);

    for (let iteration = 1; iteration <= repeat; iteration += 1) {
      const record = await runSingleIteration(assessmentCase, iteration);
      records.push(record);
      console.log(
        `  [${iteration}/${repeat}] outcome=${record.actualOutcome} expected=${record.expectedOutcome} secondary=${record.secondaryRan ? "yes" : "no"} reason="${record.decisionReason}" red_flags=${record.redFlags.map((flag) => flag.code).join(",") || "none"}`,
      );
    }
  }

  const failures = records.filter((record) => !record.matchedExpectation);

  console.log("\nSummary");
  for (const assessmentCase of selectedCases) {
    const caseRecords = records.filter((record) => record.caseId === assessmentCase.id);
    const counts = new Map<BatchExpectedOutcome, number>([
      ["PASS", 0],
      ["FAIL", 0],
      ["UNDER_REVIEW", 0],
    ]);
    for (const record of caseRecords) {
      counts.set(record.actualOutcome, (counts.get(record.actualOutcome) ?? 0) + 1);
    }

    console.log(
      `- ${assessmentCase.id}: PASS=${counts.get("PASS")} FAIL=${counts.get("FAIL")} UNDER_REVIEW=${counts.get("UNDER_REVIEW")} expected=${assessmentCase.expectedOutcome}`,
    );
  }

  if (failures.length > 0) {
    console.error(`\nBatch regression failed with ${failures.length} unexpected outcomes.`);
    for (const failure of failures) {
      console.error(
        `- ${failure.caseId} [${failure.iteration}] expected=${failure.expectedOutcome} actual=${failure.actualOutcome} reason="${failure.decisionReason}" confidence="${failure.confidenceNote}" recommended=${failure.recommendedOutcome} manualReviewReasonCode=${failure.manualReviewReasonCode}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log("\nBatch regression passed.");
}

await main();
