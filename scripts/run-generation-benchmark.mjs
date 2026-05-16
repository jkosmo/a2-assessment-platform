#!/usr/bin/env node
/**
 * Generation benchmark (#376) — tests module-draft + MCQ generation against
 * a fixed test case using the configured AZURE_OPENAI_AUTHORING_DEPLOYMENT.
 *
 * Usage:
 *   dotenv -e .env.postgres.local -- node scripts/run-generation-benchmark.mjs
 *   dotenv -e .env.postgres.local -- node scripts/run-generation-benchmark.mjs --level advanced --locale nb
 */

import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";

const { values: args } = parseArgs({
  options: {
    level: { type: "string", default: "intermediate" },
    locale: { type: "string", default: "en-GB" },
    "question-count": { type: "string", default: "5" },
    "option-count": { type: "string", default: "4" },
    "generation-mode": { type: "string", default: "ordinary" },
  },
  strict: false,
});

const certificationLevel = args.level ?? "intermediate";
const locale = args.locale ?? "en-GB";
const questionCount = Number(args["question-count"] ?? 5);
const optionCount = Number(args["option-count"] ?? 4);
const generationMode = args["generation-mode"] ?? "ordinary";

// Fixed test case — governance domain scenario
const TEST_SOURCE_MATERIAL = `
IT Governance and Risk Management

Effective IT governance ensures that IT investments support business objectives and
that risks are managed appropriately. A governance framework defines roles,
responsibilities, and accountability structures for IT decision-making.

Key concepts include:
- Alignment: IT strategy must support the overall business strategy.
- Value delivery: IT should deliver promised benefits within budget and schedule.
- Risk management: IT-related risks should be identified, assessed, and mitigated.
- Resource management: IT assets (people, infrastructure, applications, data) should
  be used responsibly and efficiently.
- Performance measurement: IT processes should be monitored against defined metrics.

Common governance frameworks include COBIT, ITIL, and ISO/IEC 38500. Organisations
often use a governance committee or IT steering committee to oversee IT strategy and
investments. A Chief Information Officer (CIO) or equivalent role typically leads
IT governance activities.

Risk management in IT involves risk identification, risk assessment (likelihood ×
impact), risk response (avoid, accept, mitigate, transfer), and monitoring. A risk
register documents identified risks, their status, and owners. Residual risk is the
risk remaining after control measures are applied.

Trade-offs often arise between security and usability, between short-term cost
reduction and long-term capability investment, and between centralised control and
departmental autonomy.
`.trim();

function formatDuration(ms) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function printSection(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

function printResult(label, value) {
  const pad = 28;
  console.log(`  ${label.padEnd(pad)} ${value}`);
}

async function main() {
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT ?? "").replace(/\/+$/, "");
  const deployment = process.env.AZURE_OPENAI_AUTHORING_DEPLOYMENT ?? process.env.AZURE_OPENAI_DEPLOYMENT ?? "";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-02-01";
  const apiKey = process.env.AZURE_OPENAI_API_KEY ?? "";

  if (!endpoint || !deployment || !apiKey) {
    console.error("Missing required env vars: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT (or AUTHORING variant), AZURE_OPENAI_API_KEY");
    process.exit(1);
  }

  printSection("Generation Benchmark Configuration");
  printResult("Level:", certificationLevel);
  printResult("Locale:", locale);
  printResult("Generation mode:", generationMode);
  printResult("MCQ count / options:", `${questionCount} / ${optionCount}`);
  printResult("Endpoint:", endpoint.slice(0, 50) + "…");
  printResult("Deployment:", deployment);

  // -------------------------------------------------------------------------
  // Blueprint generation
  // -------------------------------------------------------------------------
  printSection("Step 1: Assessment blueprint");

  const blueprintUrl = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  const blueprintPayload = buildBlueprintPrompt(TEST_SOURCE_MATERIAL, certificationLevel, locale);

  const t0 = performance.now();
  const blueprintRaw = await callLlm(blueprintUrl, apiKey, blueprintPayload.systemPrompt, blueprintPayload.userPrompt, 2000);
  const blueprintMs = performance.now() - t0;

  let blueprint = null;
  try {
    blueprint = JSON.parse(blueprintRaw);
    printResult("Duration:", formatDuration(blueprintMs));
    printResult("Learning objectives:", blueprint.learningObjectives?.length ?? 0);
    printResult("Key topics:", blueprint.keyTopics?.length ?? 0);
    printResult("Suggested MCQ count:", blueprint.mcqProfile?.suggestedCount ?? "–");
    printResult("Validation:", "OK");
  } catch (err) {
    printResult("Duration:", formatDuration(blueprintMs));
    printResult("Validation:", `FAILED — ${err.message}`);
    console.log("  Raw response (first 300 chars):", blueprintRaw.slice(0, 300));
  }

  // -------------------------------------------------------------------------
  // Module draft generation
  // -------------------------------------------------------------------------
  printSection("Step 2: Module draft");

  const draftUrl = blueprintUrl;
  const draftPayload = buildModuleDraftPrompt(TEST_SOURCE_MATERIAL, certificationLevel, locale, generationMode);

  const t1 = performance.now();
  const draftRaw = await callLlm(draftUrl, apiKey, draftPayload.systemPrompt, draftPayload.userPrompt, 4000);
  const draftMs = performance.now() - t1;

  let draft = null;
  try {
    draft = JSON.parse(draftRaw);
    const taskWordCount = (draft.taskText ?? "").split(/\s+/).filter(Boolean).length;
    const assessorWordCount = (draft.assessorExpectedContent ?? "").split(/\s+/).filter(Boolean).length;
    const constraintsWordCount = (draft.candidateTaskConstraints ?? "").split(/\s+/).filter(Boolean).length;
    printResult("Duration:", formatDuration(draftMs));
    printResult("taskText words:", taskWordCount);
    printResult("assessorExpectedContent words:", assessorWordCount);
    printResult("candidateTaskConstraints words:", constraintsWordCount);
    printResult("includesScenario:", String(draft.includesScenario ?? "–"));
    printResult("Validation:", validateDraft(draft));
  } catch (err) {
    printResult("Duration:", formatDuration(draftMs));
    printResult("Validation:", `FAILED — ${err.message}`);
    console.log("  Raw response (first 300 chars):", draftRaw.slice(0, 300));
  }

  // -------------------------------------------------------------------------
  // MCQ generation
  // -------------------------------------------------------------------------
  printSection("Step 3: MCQ generation");

  const mcqUrl = blueprintUrl;
  const mcqPayload = buildMcqPrompt(TEST_SOURCE_MATERIAL, certificationLevel, locale, generationMode, questionCount, optionCount);
  const maxMcqTokens = Math.max(4000, questionCount * optionCount * 200);

  const t2 = performance.now();
  const mcqRaw = await callLlm(mcqUrl, apiKey, mcqPayload.systemPrompt, mcqPayload.userPrompt, maxMcqTokens);
  const mcqMs = performance.now() - t2;

  try {
    const mcqResult = JSON.parse(mcqRaw);
    const questions = mcqResult.questions ?? [];
    const allHaveCorrectAnswer = questions.every(q => q.options?.includes(q.correctAnswer));
    const allHaveRationale = questions.every(q => typeof q.rationale === "string" && q.rationale.length > 0);
    printResult("Duration:", formatDuration(mcqMs));
    printResult("Questions generated:", questions.length);
    printResult("All options include correct answer:", String(allHaveCorrectAnswer));
    printResult("All have rationale:", String(allHaveRationale));
    printResult("Validation:", validateMcq(questions, questionCount, optionCount));
  } catch (err) {
    printResult("Duration:", formatDuration(mcqMs));
    printResult("Validation:", `FAILED — ${err.message}`);
    console.log("  Raw response (first 300 chars):", mcqRaw.slice(0, 300));
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  printSection("Summary");
  const totalMs = (performance.now() - t0);
  printResult("Total duration:", formatDuration(totalMs));
  printResult("Blueprint:", formatDuration(blueprintMs));
  printResult("Module draft:", formatDuration(draftMs));
  printResult("MCQ:", formatDuration(mcqMs));
  console.log();
}

async function callLlm(url, apiKey, systemPrompt, userPrompt, maxTokens) {
  const temperature = Number(process.env.AZURE_OPENAI_AUTHORING_TEMPERATURE ?? 0.4);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_completion_tokens: maxTokens,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Azure OpenAI request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content ?? "";
  return content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}

function buildBlueprintPrompt(sourceMaterial, certificationLevel, locale) {
  const localeMap = { "en-GB": "British English", nb: "Norwegian Bokmål", nn: "Norwegian Nynorsk" };
  const localeName = localeMap[locale] ?? locale;
  const budgetMap = {
    basic:        { actorsMax: 1, conceptsMax: 2, tradeoffsMax: 0, minWords: 100, maxWords: 200, timeBudgetMinutes: 10 },
    intermediate: { actorsMax: 2, conceptsMax: 3, tradeoffsMax: 1, minWords: 250, maxWords: 450, timeBudgetMinutes: 20 },
    advanced:     { actorsMax: 3, conceptsMax: 4, tradeoffsMax: 2, minWords: 400, maxWords: 700, timeBudgetMinutes: 30 },
  };
  const budget = budgetMap[certificationLevel] ?? budgetMap.intermediate;
  return {
    systemPrompt: "You are a certification content architect. Return strict JSON only.",
    userPrompt: `Analyse the source material and produce an assessment blueprint for ${certificationLevel} level (${localeName}).\n\nComplexity limits: actors≤${budget.actorsMax}, concepts≤${budget.conceptsMax}, tradeoffs≤${budget.tradeoffsMax}, answer ${budget.minWords}–${budget.maxWords} words.\n\nSource material:\n${sourceMaterial}\n\nReturn: { "learningObjectives": [...], "keyTopics": [...], "complexityBudget": { "actors": N, "concepts": N, "tradeoffs": N }, "mcqProfile": { "suggestedCount": N, "topicDistribution": {} }, "notes": "..." }`,
  };
}

function buildModuleDraftPrompt(sourceMaterial, certificationLevel, locale, generationMode) {
  const localeMap = { "en-GB": "British English", nb: "Norwegian Bokmål", nn: "Norwegian Nynorsk" };
  return {
    systemPrompt: "You are a module content author for a professional certification platform. Return strict JSON only.",
    userPrompt: `Generate a ${certificationLevel}-level module draft in ${localeMap[locale] ?? locale} (${generationMode} mode) from the source material below.\n\nSource:\n${sourceMaterial}\n\nReturn: { "taskText": "...", "assessorExpectedContent": "...", "candidateTaskConstraints": "...", "includesScenario": true/false }`,
  };
}

function buildMcqPrompt(sourceMaterial, certificationLevel, locale, generationMode, questionCount, optionCount) {
  const localeMap = { "en-GB": "British English", nb: "Norwegian Bokmål", nn: "Norwegian Nynorsk" };
  return {
    systemPrompt: "You are an MCQ question author for a professional certification platform. Return strict JSON only.",
    userPrompt: `Generate ${questionCount} ${certificationLevel}-level MCQ questions with ${optionCount} options each in ${localeMap[locale] ?? locale} (${generationMode} mode).\n\nSource:\n${sourceMaterial}\n\nReturn: { "questions": [ { "stem": "...", "options": [...], "correctAnswer": "...", "rationale": "..." } ] }`,
  };
}

function validateDraft(draft) {
  if (!draft?.taskText) return "FAILED — missing taskText";
  if (!draft?.assessorExpectedContent) return "FAILED — missing assessorExpectedContent";
  if (typeof draft.includesScenario !== "boolean") return "WARN — includesScenario not boolean";
  return "OK";
}

function validateMcq(questions, expectedCount, expectedOptions) {
  if (!Array.isArray(questions) || questions.length === 0) return "FAILED — no questions";
  if (questions.length !== expectedCount) return `WARN — expected ${expectedCount} questions, got ${questions.length}`;
  for (const [i, q] of questions.entries()) {
    if (!Array.isArray(q.options) || q.options.length !== expectedOptions) return `WARN — Q${i + 1} has ${q.options?.length ?? 0} options, expected ${expectedOptions}`;
    if (!q.options.includes(q.correctAnswer)) return `FAILED — Q${i + 1} correctAnswer not in options`;
  }
  return "OK";
}

main().catch((err) => {
  console.error("Benchmark failed:", err.message);
  process.exit(1);
});
