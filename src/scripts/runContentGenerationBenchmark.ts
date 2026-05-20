// #376 — content generation benchmark.
//
// Tests how different Azure OpenAI deployments perform when generating
// module drafts + MCQ sets from the SAME source material, certification
// level, and generation mode. Captures structural quality metrics that
// can be computed deterministically from the LLM output — no LLM-judge
// for plausibility ratings yet (that is a separate extension; see the
// "Follow-up" section in doc/CONTENT_GENERATION_BENCHMARK.md).
//
// Pattern mirrors src/scripts/runModelComparisonBenchmark.ts (which
// benchmarks the ASSESSMENT flow). This script benchmarks the
// GENERATION flow.
//
// Usage:
//
//   tsx src/scripts/runContentGenerationBenchmark.ts \
//     --deployments=full:gpt-4o,mini:gpt-4o-mini \
//     --levels=basic,intermediate \
//     --modes=thorough \
//     --repeats=3 \
//     --questions=5 \
//     --options=4 \
//     --output=benchmark-results/content
//
// Output:
//   <output>-<YYYYMMDD>.md           — human-readable markdown report
//   <output>-<YYYYMMDD>.jsonl        — one record per generation run

import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import {
  generateModuleDraft,
  generateMcqQuestions,
  type GeneratedMcqQuestion,
} from "../modules/adminContent/llmContentGenerationService.js";

// ---------------------------------------------------------------------------
// Fixture corpus — keep small and committed so benchmark runs are repeatable.
// Extend by appending entries; each case generates one draft + one MCQ set
// per (deployment, level, mode, repeat).
// ---------------------------------------------------------------------------

type BenchmarkCase = {
  id: string;
  topic: string;
  sourceMaterial: string;
};

const CASES: BenchmarkCase[] = [
  {
    id: "labour-rights",
    topic: "Trade unions and labour rights",
    sourceMaterial: [
      "Collective bargaining is the negotiation between employers and a group of employees aimed at agreements to regulate working salaries, working conditions, benefits, and other aspects of workers' compensation and rights for workers.",
      "The collective agreements reached by these negotiations usually set out wage scales, working hours, training, health and safety, overtime, grievance mechanisms, and rights to participate in workplace or company affairs.",
      "Trade unions formally represent workers and may negotiate with employers on behalf of union members.",
    ].join("\n"),
  },
  {
    id: "psychometric-validity",
    topic: "Psychometric validity",
    sourceMaterial: [
      "Validity in psychometrics is the extent to which a test measures what it claims to measure.",
      "Content validity refers to whether the test items represent the construct being measured.",
      "Construct validity is supported when test scores behave as theory predicts (e.g. correlations with related constructs, differences between known groups).",
      "Criterion validity is established by comparing test scores to outcome measures the test should predict.",
    ].join("\n"),
  },
];

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

type CertLevel = "basic" | "intermediate" | "advanced";
type GenMode = "ordinary" | "thorough";

function parseCliArgs(argv: string[]) {
  let repeats = 3;
  let questionCount = 5;
  let optionCount = 4;
  let deploymentSpecs: Array<{ label: string; deployment: string }> = [];
  let levels: CertLevel[] = ["basic", "intermediate", "advanced"];
  let modes: GenMode[] = ["thorough"];
  let caseIds: string[] = [];
  let outputBase = "benchmark-results/content";

  for (const arg of argv) {
    if (arg.startsWith("--deployments=")) {
      const raw = arg.slice("--deployments=".length);
      deploymentSpecs = raw.split(",").map((spec) => {
        const i = spec.indexOf(":");
        if (i < 1) throw new Error(`Invalid deployment spec '${spec}'. Expected 'label:deployment'.`);
        return { label: spec.slice(0, i), deployment: spec.slice(i + 1) };
      });
    } else if (arg.startsWith("--levels=")) {
      const raw = arg.slice("--levels=".length);
      levels = raw.split(",").map((s) => s.trim()) as CertLevel[];
      for (const l of levels) {
        if (!["basic", "intermediate", "advanced"].includes(l)) {
          throw new Error(`Invalid level '${l}'. Expected basic|intermediate|advanced.`);
        }
      }
    } else if (arg.startsWith("--modes=")) {
      const raw = arg.slice("--modes=".length);
      modes = raw.split(",").map((s) => s.trim()) as GenMode[];
      for (const m of modes) {
        if (!["ordinary", "thorough"].includes(m)) {
          throw new Error(`Invalid mode '${m}'. Expected ordinary|thorough.`);
        }
      }
    } else if (arg.startsWith("--repeats=")) {
      repeats = Number(arg.slice("--repeats=".length));
    } else if (arg.startsWith("--questions=")) {
      questionCount = Number(arg.slice("--questions=".length));
    } else if (arg.startsWith("--options=")) {
      optionCount = Number(arg.slice("--options=".length));
    } else if (arg.startsWith("--cases=")) {
      caseIds = arg.slice("--cases=".length).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith("--output=")) {
      outputBase = arg.slice("--output=".length);
    }
  }

  if (deploymentSpecs.length === 0) {
    throw new Error("--deployments is required. Example: --deployments=full:gpt-4o,mini:gpt-4o-mini");
  }
  if (!Number.isInteger(repeats) || repeats <= 0) throw new Error("--repeats must be a positive integer.");
  if (!Number.isInteger(questionCount) || questionCount <= 0) throw new Error("--questions must be a positive integer.");
  if (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > 6) throw new Error("--options must be between 2 and 6.");

  return { repeats, questionCount, optionCount, deploymentSpecs, levels, modes, caseIds, outputBase };
}

// ---------------------------------------------------------------------------
// Structural metrics (no LLM-judge)
// ---------------------------------------------------------------------------

function countSentences(text: string): number {
  return text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 0).length;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function scenarioMetrics(result: { taskText: string; assessorExpectedContent: string; candidateTaskConstraints: string }) {
  return {
    taskWordCount: countWords(result.taskText),
    taskSentenceCount: countSentences(result.taskText),
    constraintsWordCount: countWords(result.candidateTaskConstraints),
    constraintsSentenceCount: countSentences(result.candidateTaskConstraints),
    assessorWordCount: countWords(result.assessorExpectedContent),
    // The 80-word ceiling on constraints comes from validateModuleDraft (see
    // contentValidationService.ts) — flag overruns so the benchmark surfaces
    // when generation drifts past the rule.
    constraintsExceedsCeiling: countWords(result.candidateTaskConstraints) > 80,
  };
}

function mcqMetrics(questions: GeneratedMcqQuestion[], requestedCount: number, requestedOptionCount: number) {
  const eliminationRisks: Record<"low" | "medium" | "high" | "unset", number> = { low: 0, medium: 0, high: 0, unset: 0 };
  let totalOptions = 0;
  let optionsWithCompleteMetadata = 0;
  for (const q of questions) {
    if (q.eliminationRisk) eliminationRisks[q.eliminationRisk] += 1;
    else eliminationRisks.unset += 1;
    totalOptions += q.options.length;
    for (const meta of q.distractorMetadata ?? []) {
      if (meta.whyTempting && meta.whyWrongUnderStem && meta.wouldBeCorrectIf) {
        optionsWithCompleteMetadata += 1;
      }
    }
  }
  const requestedTotalOptions = requestedCount * requestedOptionCount;
  return {
    requestedQuestionCount: requestedCount,
    actualQuestionCount: questions.length,
    questionCountMatch: questions.length === requestedCount,
    avgOptionsPerQuestion: questions.length > 0 ? totalOptions / questions.length : 0,
    eliminationRiskHigh: eliminationRisks.high,
    eliminationRiskMedium: eliminationRisks.medium,
    eliminationRiskLow: eliminationRisks.low,
    eliminationRiskUnset: eliminationRisks.unset,
    distractorMetadataCompletePct: requestedTotalOptions > 0
      ? Math.round((optionsWithCompleteMetadata / requestedTotalOptions) * 100)
      : 0,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RunRecord = {
  round: number;
  modelLabel: string;
  deployment: string;
  caseId: string;
  level: CertLevel;
  mode: GenMode;
  questionCount: number;
  optionCount: number;
  scenario: ReturnType<typeof scenarioMetrics> | null;
  mcq: ReturnType<typeof mcqMetrics> | null;
  scenarioLatencyMs: number;
  mcqLatencyMs: number;
  scenarioError: string | null;
  mcqError: string | null;
  timestamp: string;
};

function appendJsonl(filePath: string, record: RunRecord): void {
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Single run (one case × one deployment × one level × one mode × one round)
// ---------------------------------------------------------------------------

async function runSingle(
  round: number,
  modelLabel: string,
  deployment: string,
  c: BenchmarkCase,
  level: CertLevel,
  mode: GenMode,
  questionCount: number,
  optionCount: number,
): Promise<RunRecord> {
  // Mutate env to target the deployment under test. buildUrl() in
  // llmContentGenerationService.ts reads this on every call, so per-iteration
  // mutation is safe.
  const previousAuthoring = env.AZURE_OPENAI_AUTHORING_DEPLOYMENT;
  const previousMain = env.AZURE_OPENAI_DEPLOYMENT;
  (env as { AZURE_OPENAI_AUTHORING_DEPLOYMENT?: string }).AZURE_OPENAI_AUTHORING_DEPLOYMENT = deployment;
  (env as { AZURE_OPENAI_DEPLOYMENT?: string }).AZURE_OPENAI_DEPLOYMENT = deployment;

  const base = {
    round,
    modelLabel,
    deployment,
    caseId: c.id,
    level,
    mode,
    questionCount,
    optionCount,
    timestamp: new Date().toISOString(),
  };

  let scenarioResult: Awaited<ReturnType<typeof generateModuleDraft>> | null = null;
  let scenarioError: string | null = null;
  const scenarioStart = Date.now();
  try {
    scenarioResult = await generateModuleDraft({
      sourceMaterial: c.sourceMaterial,
      certificationLevel: level,
      locale: "en-GB",
      generationMode: mode,
    });
  } catch (err) {
    scenarioError = err instanceof Error ? err.message : String(err);
  }
  const scenarioLatencyMs = Date.now() - scenarioStart;

  let mcqResult: Awaited<ReturnType<typeof generateMcqQuestions>> | null = null;
  let mcqError: string | null = null;
  const mcqStart = Date.now();
  try {
    mcqResult = await generateMcqQuestions({
      sourceMaterial: c.sourceMaterial,
      certificationLevel: level,
      locale: "en-GB",
      generationMode: mode,
      questionCount,
      optionCount,
    });
  } catch (err) {
    mcqError = err instanceof Error ? err.message : String(err);
  }
  const mcqLatencyMs = Date.now() - mcqStart;

  // Restore env to pre-iteration state
  (env as { AZURE_OPENAI_AUTHORING_DEPLOYMENT?: string }).AZURE_OPENAI_AUTHORING_DEPLOYMENT = previousAuthoring;
  (env as { AZURE_OPENAI_DEPLOYMENT?: string }).AZURE_OPENAI_DEPLOYMENT = previousMain;

  return {
    ...base,
    scenario: scenarioResult ? scenarioMetrics(scenarioResult) : null,
    mcq: mcqResult ? mcqMetrics(mcqResult.questions, questionCount, optionCount) : null,
    scenarioLatencyMs,
    mcqLatencyMs,
    scenarioError,
    mcqError,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

function aggregateByModelLevelMode(records: RunRecord[]) {
  const groups = new Map<string, RunRecord[]>();
  for (const r of records) {
    const key = `${r.modelLabel}\t${r.level}\t${r.mode}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.entries()].map(([key, runs]) => {
    const [modelLabel, level, mode] = key.split("\t");
    const okScenario = runs.filter((r) => r.scenario);
    const okMcq = runs.filter((r) => r.mcq);
    return {
      modelLabel,
      level: level as CertLevel,
      mode: mode as GenMode,
      runs: runs.length,
      scenarioErrors: runs.filter((r) => r.scenarioError).length,
      mcqErrors: runs.filter((r) => r.mcqError).length,
      avgTaskWords: avg(okScenario.map((r) => r.scenario!.taskWordCount)),
      avgTaskSentences: avg(okScenario.map((r) => r.scenario!.taskSentenceCount)),
      avgConstraintsWords: avg(okScenario.map((r) => r.scenario!.constraintsWordCount)),
      constraintsOverCeilingPct: pct(
        okScenario.filter((r) => r.scenario!.constraintsExceedsCeiling).length,
        okScenario.length,
      ),
      avgScenarioLatencyMs: avg(runs.map((r) => r.scenarioLatencyMs)),
      avgMcqLatencyMs: avg(runs.map((r) => r.mcqLatencyMs)),
      questionCountMatchPct: pct(
        okMcq.filter((r) => r.mcq!.questionCountMatch).length,
        okMcq.length,
      ),
      eliminationRiskHighPct: pct(
        okMcq.reduce((s, r) => s + r.mcq!.eliminationRiskHigh, 0),
        okMcq.reduce((s, r) => s + (r.mcq!.actualQuestionCount), 0),
      ),
      eliminationRiskMediumPct: pct(
        okMcq.reduce((s, r) => s + r.mcq!.eliminationRiskMedium, 0),
        okMcq.reduce((s, r) => s + (r.mcq!.actualQuestionCount), 0),
      ),
      distractorMetadataCompletePct: avg(okMcq.map((r) => r.mcq!.distractorMetadataCompletePct)),
    };
  });
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

function buildReport(records: RunRecord[], deployments: Array<{ label: string; deployment: string }>): string {
  const agg = aggregateByModelLevelMode(records);
  const lines: string[] = [];
  lines.push("# Content generation benchmark");
  lines.push(`Generated ${new Date().toISOString()} — ${records.length} total runs across ${deployments.length} deployment(s).`);
  lines.push("");
  lines.push("## Deployments under test");
  for (const d of deployments) lines.push(`- **${d.label}** = \`${d.deployment}\``);
  lines.push("");
  lines.push("## Scenario quality (per model / level / mode)");
  lines.push("");
  lines.push("| Model | Level | Mode | Runs | Errors | Avg task words | Avg task sentences | Avg constraints words | Constraints over 80w | Avg scenario latency (s) |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const a of agg.sort((x, y) => x.modelLabel.localeCompare(y.modelLabel) || x.level.localeCompare(y.level))) {
    lines.push(
      `| ${a.modelLabel} | ${a.level} | ${a.mode} | ${a.runs} | ${a.scenarioErrors} | ${fmt(a.avgTaskWords)} | ${fmt(a.avgTaskSentences)} | ${fmt(a.avgConstraintsWords)} | ${a.constraintsOverCeilingPct}% | ${fmt(a.avgScenarioLatencyMs / 1000)} |`,
    );
  }
  lines.push("");
  lines.push("## MCQ quality (per model / level / mode)");
  lines.push("");
  lines.push("| Model | Level | Mode | Runs | Errors | Q-count match | EliminationRisk:high | EliminationRisk:medium | Distractor meta complete | Avg MCQ latency (s) |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const a of agg.sort((x, y) => x.modelLabel.localeCompare(y.modelLabel) || x.level.localeCompare(y.level))) {
    lines.push(
      `| ${a.modelLabel} | ${a.level} | ${a.mode} | ${a.runs} | ${a.mcqErrors} | ${a.questionCountMatchPct}% | ${a.eliminationRiskHighPct}% | ${a.eliminationRiskMediumPct}% | ${fmt(a.distractorMetadataCompletePct)}% | ${fmt(a.avgMcqLatencyMs / 1000)} |`,
    );
  }
  lines.push("");
  lines.push("## How to read these numbers");
  lines.push("");
  lines.push("- **Avg task words / sentences:** complexity of the generated scenario. Compare across levels to verify the model differentiates basic / intermediate / advanced.");
  lines.push("- **Constraints over 80w:** triggers a warning in `validateModuleDraft`. Should be 0% — model is leaking answer outline into candidate-visible constraints.");
  lines.push("- **EliminationRisk:high:** blocks publish via `validateMcqDistractors`. Anything above 0% indicates the model produces weak distractors.");
  lines.push("- **Distractor meta complete:** the per-option `whyTempting`/`whyWrongUnderStem`/`wouldBeCorrectIf` triple. Low values mean the model abbreviated metadata.");
  lines.push("");
  lines.push("## Follow-up (not yet implemented)");
  lines.push("");
  lines.push("- LLM-judge plausibility rating per distractor — needs a separate evaluator prompt + extra LLM calls per question.");
  lines.push("- Cognitive-level distribution (recall / understanding / application / analysis) — needs LLM tagging.");
  lines.push("- Simulated-candidate solve rate without source material — needs a second LLM call per question with the source hidden.");
  lines.push("- Per-call cost estimation — needs token-usage extraction from Azure OpenAI response payload.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const cases = args.caseIds.length > 0
    ? CASES.filter((c) => args.caseIds.includes(c.id))
    : CASES;
  if (cases.length === 0) {
    throw new Error(`No cases selected. Known cases: ${CASES.map((c) => c.id).join(", ")}`);
  }

  if (!env.AZURE_OPENAI_API_KEY || !env.AZURE_OPENAI_ENDPOINT) {
    throw new Error("AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT must be set in the environment.");
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const outDir = path.dirname(args.outputBase);
  if (outDir && !fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const jsonlPath = `${args.outputBase}-${stamp}.jsonl`;
  const mdPath = `${args.outputBase}-${stamp}.md`;

  const totalRuns = args.deploymentSpecs.length * args.levels.length * args.modes.length * cases.length * args.repeats;
  console.log(`Plan: ${totalRuns} runs across ${args.deploymentSpecs.length} deployment(s), ${args.levels.length} level(s), ${args.modes.length} mode(s), ${cases.length} case(s), ${args.repeats} repeat(s).`);
  console.log(`Output JSONL: ${jsonlPath}`);
  console.log(`Output Markdown: ${mdPath}`);
  console.log("");

  const records: RunRecord[] = [];
  let runIdx = 0;
  for (const { label, deployment } of args.deploymentSpecs) {
    for (const level of args.levels) {
      for (const mode of args.modes) {
        for (const c of cases) {
          for (let round = 1; round <= args.repeats; round += 1) {
            runIdx += 1;
            process.stdout.write(`[${runIdx}/${totalRuns}] ${label}/${level}/${mode}/${c.id} round=${round} ... `);
            const record = await runSingle(round, label, deployment, c, level, mode, args.questionCount, args.optionCount);
            appendJsonl(jsonlPath, record);
            records.push(record);
            const status = record.scenarioError ? "scenario-FAIL" : record.mcqError ? "mcq-FAIL" : "ok";
            console.log(`${status} (${record.scenarioLatencyMs + record.mcqLatencyMs}ms)`);
          }
        }
      }
    }
  }

  const markdown = buildReport(records, args.deploymentSpecs);
  fs.writeFileSync(mdPath, markdown, "utf8");
  console.log("");
  console.log(`Done. Markdown report: ${mdPath}`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
