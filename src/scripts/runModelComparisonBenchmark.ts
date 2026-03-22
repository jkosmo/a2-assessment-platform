import { env } from "../config/env.js";
import { evaluatePracticalWithAzureOpenAi } from "../modules/assessment/llmAssessmentService.js";
import { resolveAssessmentDecision } from "../modules/assessment/decisionService.js";
import { assessmentBatchCases, type AssessmentBatchCase } from "./assessmentBatchCases.js";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]) {
  let repeat = 10;
  let modelSpecs: Array<{ label: string; deployment: string }> = [];
  let caseIds: string[] = [];

  for (const arg of argv) {
    if (arg.startsWith("--repeat=")) {
      repeat = Number(arg.slice("--repeat=".length));
    } else if (arg.startsWith("--models=")) {
      const raw = arg.slice("--models=".length);
      modelSpecs = raw.split(",").map((spec) => {
        const colonIndex = spec.indexOf(":");
        if (colonIndex < 1) throw new Error(`Invalid model spec '${spec}'. Expected 'label:deployment'.`);
        return { label: spec.slice(0, colonIndex), deployment: spec.slice(colonIndex + 1) };
      });
    } else if (arg.startsWith("--cases=")) {
      caseIds = arg.slice("--cases=".length).split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  if (!Number.isInteger(repeat) || repeat <= 0) throw new Error("--repeat must be a positive integer.");
  if (modelSpecs.length === 0) throw new Error("--models is required. Example: --models=nano:gpt4o-nano,mini:gpt4o-mini");

  return { repeat, modelSpecs, caseIds };
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squaredDiffs = values.map((v) => (v - avg) ** 2);
  return Math.sqrt(mean(squaredDiffs));
}

function fmt(value: number, decimals = 1): string {
  return value.toFixed(decimals);
}

// ---------------------------------------------------------------------------
// Single run
// ---------------------------------------------------------------------------

type RunRecord = {
  modelLabel: string;
  deployment: string;
  caseId: string;
  iteration: number;
  rubricTotal: number;
  practicalScoreScaled: number;
  outcome: "PASS" | "FAIL" | "UNDER_REVIEW";
  latencyMs: number;
  error: string | null;
};

async function runSingle(
  modelLabel: string,
  deployment: string,
  assessmentCase: AssessmentBatchCase,
  iteration: number,
): Promise<RunRecord> {
  const t0 = Date.now();

  try {
    const result = await evaluatePracticalWithAzureOpenAi(
      {
        moduleId: assessmentCase.moduleId,
        responseJson: assessmentCase.responseJson,
        responseLocale: "en-GB",
        moduleTaskText: assessmentCase.moduleTaskText,
        moduleGuidanceText: assessmentCase.moduleGuidanceText,
        assessmentPass: "primary",
      },
      {
        endpoint: env.AZURE_OPENAI_ENDPOINT ?? "",
        apiKey: env.AZURE_OPENAI_API_KEY ?? "",
        deployment,
        apiVersion: env.AZURE_OPENAI_API_VERSION,
        timeoutMs: env.AZURE_OPENAI_TIMEOUT_MS,
        temperature: env.AZURE_OPENAI_TEMPERATURE,
        maxTokens: env.AZURE_OPENAI_MAX_TOKENS,
        tokenLimitParameter: env.AZURE_OPENAI_TOKEN_LIMIT_PARAMETER,
      },
    );

    const latencyMs = Date.now() - t0;

    const resolved = resolveAssessmentDecision({
      mcqScaledScore: assessmentCase.mcqScaledScore,
      mcqPercentScore: assessmentCase.mcqPercentScore,
      llmResult: result,
      forceManualReviewReason: undefined,
    });

    const outcome: RunRecord["outcome"] = resolved.needsManualReview
      ? "UNDER_REVIEW"
      : resolved.passFailTotal
        ? "PASS"
        : "FAIL";

    return {
      modelLabel,
      deployment,
      caseId: assessmentCase.id,
      iteration,
      rubricTotal: result.rubric_total,
      practicalScoreScaled: result.practical_score_scaled,
      outcome,
      latencyMs,
      error: null,
    };
  } catch (error) {
    return {
      modelLabel,
      deployment,
      caseId: assessmentCase.id,
      iteration,
      rubricTotal: 0,
      practicalScoreScaled: 0,
      outcome: "FAIL",
      latencyMs: Date.now() - t0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(
  records: RunRecord[],
  modelSpecs: Array<{ label: string; deployment: string }>,
  cases: AssessmentBatchCase[],
  repeat: number,
) {
  console.log("\n" + "=".repeat(72));
  console.log("MODEL COMPARISON BENCHMARK REPORT");
  console.log("=".repeat(72));

  for (const assessmentCase of cases) {
    console.log(`\nCase: ${assessmentCase.id}  (expected: ${assessmentCase.expectedOutcome})`);
    console.log(`Description: ${assessmentCase.description}`);
    console.log("-".repeat(72));

    const headerRow = [
      "Model".padEnd(10),
      "Deployment".padEnd(22),
      "PASS".padStart(5),
      "FAIL".padStart(5),
      "REVW".padStart(5),
      "ERR".padStart(4),
      "Score avg".padStart(10),
      "Score std".padStart(10),
      "Score min".padStart(10),
      "Score max".padStart(10),
      "ms avg".padStart(8),
      "ms std".padStart(8),
      "ms min".padStart(8),
      "ms max".padStart(8),
    ].join("  ");
    console.log(headerRow);
    console.log("-".repeat(72));

    for (const { label, deployment } of modelSpecs) {
      const modelCaseRecords = records.filter(
        (r) => r.modelLabel === label && r.caseId === assessmentCase.id,
      );
      const successful = modelCaseRecords.filter((r) => r.error === null);
      const errorCount = modelCaseRecords.length - successful.length;

      const passCount = successful.filter((r) => r.outcome === "PASS").length;
      const failCount = successful.filter((r) => r.outcome === "FAIL").length;
      const reviewCount = successful.filter((r) => r.outcome === "UNDER_REVIEW").length;

      const scores = successful.map((r) => r.rubricTotal);
      const latencies = successful.map((r) => r.latencyMs);

      const row = [
        label.padEnd(10),
        deployment.slice(0, 22).padEnd(22),
        String(passCount).padStart(5),
        String(failCount).padStart(5),
        String(reviewCount).padStart(5),
        String(errorCount).padStart(4),
        (scores.length > 0 ? fmt(mean(scores)) : "—").padStart(10),
        (scores.length > 1 ? fmt(stddev(scores)) : "—").padStart(10),
        (scores.length > 0 ? fmt(Math.min(...scores), 0) : "—").padStart(10),
        (scores.length > 0 ? fmt(Math.max(...scores), 0) : "—").padStart(10),
        (latencies.length > 0 ? fmt(mean(latencies), 0) : "—").padStart(8),
        (latencies.length > 1 ? fmt(stddev(latencies), 0) : "—").padStart(8),
        (latencies.length > 0 ? fmt(Math.min(...latencies), 0) : "—").padStart(8),
        (latencies.length > 0 ? fmt(Math.max(...latencies), 0) : "—").padStart(8),
      ].join("  ");

      console.log(row);
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log(
    `Ran ${repeat} iterations × ${modelSpecs.length} models × ${cases.length} cases = ${repeat * modelSpecs.length * cases.length} total calls`,
  );

  const totalErrors = records.filter((r) => r.error !== null).length;
  if (totalErrors > 0) {
    console.log(`\nErrors (${totalErrors}):`);
    for (const record of records.filter((r) => r.error !== null)) {
      console.log(`  [${record.modelLabel}/${record.caseId}/${record.iteration}] ${record.error}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (env.LLM_MODE !== "azure_openai") {
    throw new Error("runModelComparisonBenchmark requires LLM_MODE=azure_openai.");
  }
  if (!env.AZURE_OPENAI_ENDPOINT || !env.AZURE_OPENAI_API_KEY) {
    throw new Error("AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY must be set.");
  }

  const { repeat, modelSpecs, caseIds } = parseCliArgs(process.argv.slice(2));

  const selectedCases = caseIds.length > 0
    ? assessmentBatchCases.filter((c) => caseIds.includes(c.id))
    : assessmentBatchCases.filter((c) => c.expectedOutcome !== "FAIL");

  if (selectedCases.length === 0) {
    throw new Error("No matching cases found. Check --cases argument.");
  }

  console.log(
    `Model comparison benchmark — ${modelSpecs.length} models, ${selectedCases.length} cases, ${repeat} iterations each`,
  );
  for (const { label, deployment } of modelSpecs) {
    console.log(`  ${label}: ${deployment}`);
  }
  console.log();

  const records: RunRecord[] = [];

  for (const { label, deployment } of modelSpecs) {
    for (const assessmentCase of selectedCases) {
      console.log(`Running [${label}/${assessmentCase.id}] ...`);
      for (let iteration = 1; iteration <= repeat; iteration++) {
        const record = await runSingle(label, deployment, assessmentCase, iteration);
        records.push(record);

        const status = record.error
          ? `ERROR: ${record.error.slice(0, 60)}`
          : `outcome=${record.outcome} score=${record.rubricTotal} latency=${record.latencyMs}ms`;
        process.stdout.write(`  [${iteration}/${repeat}] ${status}\n`);
      }
    }
  }

  printReport(records, modelSpecs, selectedCases, repeat);
}

await main();
