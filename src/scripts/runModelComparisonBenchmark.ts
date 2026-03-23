import fs from "node:fs";
import path from "node:path";
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
  let outputBase: string | null = null;

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
    } else if (arg.startsWith("--output=")) {
      outputBase = arg.slice("--output=".length);
    }
  }

  if (!Number.isInteger(repeat) || repeat <= 0) throw new Error("--repeat must be a positive integer.");
  if (modelSpecs.length === 0) throw new Error("--models is required. Example: --models=full:gpt-5.4,mini:gpt-5.4-mini,nano:gpt-5.4-nano");

  return { repeat, modelSpecs, caseIds, outputBase };
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
  return Math.sqrt(mean(values.map((v) => (v - avg) ** 2)));
}

function fmt(value: number, decimals = 1): string {
  return value.toFixed(decimals);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RunRecord = {
  round: number;
  modelLabel: string;
  deployment: string;
  caseId: string;
  rubricTotal: number;
  practicalScoreScaled: number;
  outcome: "PASS" | "FAIL" | "UNDER_REVIEW";
  latencyMs: number;
  error: string | null;
  timestamp: string;
  rubricScores?: Record<string, number>;
  criterionRationales?: Record<string, string>;
  redFlags?: string[];
};

// ---------------------------------------------------------------------------
// Progressive JSONL logging
// ---------------------------------------------------------------------------

function appendJsonl(filePath: string, record: RunRecord): void {
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");
}

function loadJsonl(filePath: string): RunRecord[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunRecord);
}

// ---------------------------------------------------------------------------
// Single run
// ---------------------------------------------------------------------------

async function runSingle(
  round: number,
  modelLabel: string,
  deployment: string,
  assessmentCase: AssessmentBatchCase,
): Promise<RunRecord> {
  const t0 = Date.now();

  try {
    const result = await evaluatePracticalWithAzureOpenAi(
      {
        moduleId: assessmentCase.moduleId,
        responseJson: assessmentCase.responseJson,
        responseLocale: assessmentCase.responseLocale,
        moduleTaskText: assessmentCase.moduleTaskText,
        moduleGuidanceText: assessmentCase.moduleGuidanceText,
        rubricCriteriaIds: assessmentCase.rubricCriteriaIds,
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
      round,
      modelLabel,
      deployment,
      caseId: assessmentCase.id,
      rubricTotal: result.rubric_total,
      practicalScoreScaled: result.practical_score_scaled,
      outcome,
      latencyMs,
      error: null,
      timestamp: new Date().toISOString(),
      rubricScores: result.rubric_scores,
      criterionRationales: result.criterion_rationales,
      redFlags: result.red_flags?.map((f) => `${f.code}:${f.severity}`),
    };
  } catch (error) {
    return {
      round,
      modelLabel,
      deployment,
      caseId: assessmentCase.id,
      rubricTotal: 0,
      practicalScoreScaled: 0,
      outcome: "FAIL",
      latencyMs: Date.now() - t0,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Console summary table
// ---------------------------------------------------------------------------

function printSummaryTable(
  records: RunRecord[],
  modelSpecs: Array<{ label: string; deployment: string }>,
  cases: AssessmentBatchCase[],
  repeat: number,
): void {
  console.log("\n" + "=".repeat(80));
  console.log("MODEL COMPARISON BENCHMARK — SUMMARY");
  console.log("=".repeat(80));

  for (const assessmentCase of cases) {
    console.log(`\nCase: ${assessmentCase.id}  (expected: ${assessmentCase.expectedOutcome})`);
    console.log(`Description: ${assessmentCase.description}`);
    console.log("-".repeat(80));
    console.log(
      [
        "Model".padEnd(8),
        "Deployment".padEnd(20),
        "PASS".padStart(5),
        "FAIL".padStart(5),
        "REVW".padStart(5),
        "ERR".padStart(4),
        "Scr avg".padStart(8),
        "Scr std".padStart(8),
        "Scr min".padStart(8),
        "Scr max".padStart(8),
        "ms avg".padStart(8),
        "ms std".padStart(8),
        "ms min".padStart(8),
        "ms max".padStart(8),
      ].join("  "),
    );
    console.log("-".repeat(80));

    for (const { label, deployment } of modelSpecs) {
      const slice = records.filter((r) => r.modelLabel === label && r.caseId === assessmentCase.id);
      const ok = slice.filter((r) => r.error === null);
      const errCount = slice.length - ok.length;
      const pass = ok.filter((r) => r.outcome === "PASS").length;
      const fail = ok.filter((r) => r.outcome === "FAIL").length;
      const review = ok.filter((r) => r.outcome === "UNDER_REVIEW").length;
      const scores = ok.map((r) => r.rubricTotal);
      const latencies = ok.map((r) => r.latencyMs);

      console.log(
        [
          label.slice(0, 8).padEnd(8),
          deployment.slice(0, 20).padEnd(20),
          String(pass).padStart(5),
          String(fail).padStart(5),
          String(review).padStart(5),
          String(errCount).padStart(4),
          (scores.length > 0 ? fmt(mean(scores)) : "—").padStart(8),
          (scores.length > 1 ? fmt(stddev(scores)) : "—").padStart(8),
          (scores.length > 0 ? String(Math.min(...scores)) : "—").padStart(8),
          (scores.length > 0 ? String(Math.max(...scores)) : "—").padStart(8),
          (latencies.length > 0 ? fmt(mean(latencies), 0) : "—").padStart(8),
          (latencies.length > 1 ? fmt(stddev(latencies), 0) : "—").padStart(8),
          (latencies.length > 0 ? String(Math.min(...latencies)) : "—").padStart(8),
          (latencies.length > 0 ? String(Math.max(...latencies)) : "—").padStart(8),
        ].join("  "),
      );
    }
  }

  const totalErrors = records.filter((r) => r.error !== null).length;
  console.log(`\nTotal: ${repeat} rounds × ${modelSpecs.length} models × ${cases.length} cases = ${records.length} calls`);
  if (totalErrors > 0) {
    console.log(`\nErrors (${totalErrors}):`);
    for (const r of records.filter((rec) => rec.error !== null)) {
      console.log(`  [round ${r.round} ${r.modelLabel}/${r.caseId}] ${r.error}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

function buildMarkdownReport(
  records: RunRecord[],
  modelSpecs: Array<{ label: string; deployment: string }>,
  cases: AssessmentBatchCase[],
  repeat: number,
  runDate: string,
): string {
  const lines: string[] = [];

  lines.push(`# Model Comparison Benchmark — ${runDate}`);
  lines.push("");
  lines.push("## Configuration");
  lines.push("");
  lines.push(`| Parameter | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Date | ${runDate} |`);
  lines.push(`| Rounds per model per case | ${repeat} |`);
  lines.push(`| Iteration order | Interleaved (full → mini → nano per round) |`);
  lines.push(`| Temperature | ${env.AZURE_OPENAI_TEMPERATURE} |`);
  lines.push(`| Max output tokens | ${env.AZURE_OPENAI_MAX_TOKENS} |`);
  lines.push("");
  lines.push("**Models:**");
  lines.push("");
  for (const { label, deployment } of modelSpecs) {
    lines.push(`- ${label}: \`${deployment}\``);
  }
  lines.push("");
  lines.push("**Cases:**");
  lines.push("");
  for (const c of cases) {
    lines.push(`- \`${c.id}\` — expected: ${c.expectedOutcome} — ${c.description}`);
  }

  for (const assessmentCase of cases) {
    lines.push("");
    lines.push(`## Case: ${assessmentCase.id}`);
    lines.push("");
    lines.push(`**Expected outcome:** ${assessmentCase.expectedOutcome}`);
    lines.push(`**Description:** ${assessmentCase.description}`);
    lines.push("");
    lines.push("### Outcome distribution");
    lines.push("");
    lines.push("| Model | Deployment | PASS | FAIL | UNDER_REVIEW | Errors |");
    lines.push("|---|---|---|---|---|---|");

    for (const { label, deployment } of modelSpecs) {
      const slice = records.filter((r) => r.modelLabel === label && r.caseId === assessmentCase.id);
      const ok = slice.filter((r) => r.error === null);
      const pass = ok.filter((r) => r.outcome === "PASS").length;
      const fail = ok.filter((r) => r.outcome === "FAIL").length;
      const review = ok.filter((r) => r.outcome === "UNDER_REVIEW").length;
      const errors = slice.length - ok.length;
      lines.push(`| ${label} | \`${deployment}\` | ${pass} | ${fail} | ${review} | ${errors} |`);
    }

    lines.push("");
    lines.push("### Score (rubric_total)");
    lines.push("");
    lines.push("| Model | Avg | Std dev | Min | Max |");
    lines.push("|---|---|---|---|---|");

    for (const { label } of modelSpecs) {
      const ok = records.filter((r) => r.modelLabel === label && r.caseId === assessmentCase.id && r.error === null);
      const scores = ok.map((r) => r.rubricTotal);
      if (scores.length === 0) {
        lines.push(`| ${label} | — | — | — | — |`);
      } else {
        lines.push(
          `| ${label} | ${fmt(mean(scores))} | ${fmt(stddev(scores))} | ${Math.min(...scores)} | ${Math.max(...scores)} |`,
        );
      }
    }

    lines.push("");
    lines.push("### Latency (ms)");
    lines.push("");
    lines.push("| Model | Avg | Std dev | Min | Max |");
    lines.push("|---|---|---|---|---|");

    for (const { label } of modelSpecs) {
      const ok = records.filter((r) => r.modelLabel === label && r.caseId === assessmentCase.id && r.error === null);
      const latencies = ok.map((r) => r.latencyMs);
      if (latencies.length === 0) {
        lines.push(`| ${label} | — | — | — | — |`);
      } else {
        lines.push(
          `| ${label} | ${fmt(mean(latencies), 0)} | ${fmt(stddev(latencies), 0)} | ${Math.min(...latencies)} | ${Math.max(...latencies)} |`,
        );
      }
    }
  }

  lines.push("");
  lines.push("## Findings");
  lines.push("");
  lines.push("_To be filled in after reviewing results._");
  lines.push("");
  lines.push("## Recommendation");
  lines.push("");
  lines.push("_Go/no-go decision on switching deployment, with rationale._");
  lines.push("");

  return lines.join("\n");
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

  const { repeat, modelSpecs, caseIds, outputBase } = parseCliArgs(process.argv.slice(2));

  const selectedCases = caseIds.length > 0
    ? assessmentBatchCases.filter((c) => caseIds.includes(c.id))
    : assessmentBatchCases.filter((c) => c.expectedOutcome !== "FAIL");

  if (selectedCases.length === 0) throw new Error("No matching cases found.");

  const runDate = new Date().toISOString().slice(0, 10);
  const jsonlPath = outputBase ? `${outputBase}.jsonl` : null;
  const mdPath = outputBase ? `${outputBase}.md` : null;

  if (jsonlPath) {
    const dir = path.dirname(jsonlPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // Resume from partial run if JSONL already exists
  const existingRecords = jsonlPath ? loadJsonl(jsonlPath) : [];
  const completedKeys = new Set(
    existingRecords.map((r) => `${r.round}:${r.modelLabel}:${r.caseId}`),
  );

  if (existingRecords.length > 0) {
    console.log(`Resuming from ${existingRecords.length} existing records in ${jsonlPath}`);
  }

  console.log(
    `Model comparison benchmark — ${modelSpecs.length} models, ${selectedCases.length} cases, ${repeat} rounds`,
  );
  console.log(`Iteration order: interleaved (${modelSpecs.map((m) => m.label).join(" → ")} per round)`);
  for (const { label, deployment } of modelSpecs) {
    console.log(`  ${label}: ${deployment}`);
  }
  if (jsonlPath) console.log(`Progressive log: ${jsonlPath}`);
  console.log();

  const newRecords: RunRecord[] = [];

  // Interleaved: for each round, cycle through all models × cases
  for (let round = 1; round <= repeat; round++) {
    console.log(`\n--- Round ${round}/${repeat} ---`);
    for (const { label, deployment } of modelSpecs) {
      for (const assessmentCase of selectedCases) {
        const caseKey = `${round}:${label}:${assessmentCase.id}`;

        if (completedKeys.has(caseKey)) {
          console.log(`  [${label}/${assessmentCase.id}] skipped (already logged)`);
          continue;
        }

        const record = await runSingle(round, label, deployment, assessmentCase);
        newRecords.push(record);

        if (jsonlPath) appendJsonl(jsonlPath, record);

        const status = record.error
          ? `ERROR: ${record.error.slice(0, 60)}`
          : `outcome=${record.outcome} score=${record.rubricTotal} latency=${record.latencyMs}ms`;
        console.log(`  [${label}/${assessmentCase.id}] ${status}`);
      }
    }
  }

  const allRecords = [...existingRecords, ...newRecords];

  printSummaryTable(allRecords, modelSpecs, selectedCases, repeat);

  if (mdPath) {
    const markdown = buildMarkdownReport(allRecords, modelSpecs, selectedCases, repeat, runDate);
    fs.writeFileSync(mdPath, markdown, "utf8");
    console.log(`\nMarkdown report written to: ${mdPath}`);
  }
}

await main();
