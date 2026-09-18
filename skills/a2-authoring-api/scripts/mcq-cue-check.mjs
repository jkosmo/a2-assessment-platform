// #1032: deterministic "does the right answer give itself away?" check for the MCQ sets the skill
// writes.
//
// Measured on stage before this existed (348 questions): the correct option was the UNIQUELY
// LONGEST one in 76 % of questions and sat in POSITION 1 in 78 % — random would give 20–33 % for
// either. A learner who has learnt "pick the longest" passes without knowing the material, and it
// looks like learning in the numbers. That is not "too easy"; it makes the test invalid. The two
// cues reinforce each other: the correct option is long BECAUSE it is the only complete,
// carefully-worded one, and the distractors are straw men.
//
// Position: the platform shuffles option order every time it serves a question
// (mcqService.ts, `shuffleArray(options)`), so the stored position never reaches the learner. It is
// still checked, because a set with the answer always first is a set that was written on autopilot
// and never read — and reviewers, exports and the per-question quality report all see the stored
// order.
//
// What it checks, per question and per set (thresholds are deliberately strict — the point is to
// remove obvious cues before the human look, not to certify quality):
//   - per question: correct option is longer than the mean distractor by more than LENGTH_RATIO;
//     fewer than MIN_OPTIONS options; an "all/none of the above"-style option. Difficulty (recall
//     vs. application) cannot be measured here — that stays a reading step in the playbook.
//   - per set (n >= MIN_SET_FOR_DISTRIBUTION): share of correct answers in any one position above
//     POSITION_SHARE_MAX; share of "correct is uniquely longest" above LONGEST_SHARE_MAX.
//
// Node stdlib only, pure, repo-testable. Usage:
//   node mcq-cue-check.mjs package.json [more.json ...]   (authoring package or export envelope)
//   import { checkMcqCues, collectMcqSets } from "./mcq-cue-check.mjs"

import { readFileSync } from "node:fs";
import { localeValue } from "./localization-check.mjs";

export const LENGTH_RATIO = 1.25;
export const MIN_OPTIONS = 3;
export const MIN_SET_FOR_DISTRIBUTION = 4;
export const POSITION_SHARE_MAX = 0.5;
export const LONGEST_SHARE_MAX = 0.5;

const CATCH_ALL = /\b(alle|ingen|all|none)\b.*\b(ovenfor|over|above|nevnte|of the above|av disse)\b/i;

function textOf(localized, primary) {
  const v = localeValue(localized, primary);
  if (typeof v === "string" && v.trim()) return v.trim();
  if (localized && typeof localized === "object") {
    for (const s of Object.values(localized)) if (typeof s === "string" && s.trim()) return s.trim();
  }
  return typeof localized === "string" ? localized.trim() : "";
}

function pickPrimary(localized) {
  if (typeof localized === "string") return "nb";
  for (const lang of ["nb", "nn", "en-GB"]) if (localized && typeof localized[lang] === "string") return lang;
  return "nb";
}

/** Every MCQ set in an authoring package or an export envelope: [{ path, title, questions }]. */
export function collectMcqSets(doc) {
  const sets = [];
  const fromActiveVersion = (path, av) => {
    if (av?.mcqSet?.questions?.length) sets.push({ path, questions: av.mcqSet.questions });
  };
  if (Array.isArray(doc?.objects)) {
    for (const o of doc.objects) if (o?.type === "module") fromActiveVersion(`objects[${o.clientRef ?? "?"}]`, o.payload?.activeVersion);
    return sets;
  }
  if (doc?.scope === "module") fromActiveVersion("module", doc.module?.activeVersion);
  if (doc?.scope === "course") {
    for (const [i, item] of (doc.course?.course?.items ?? []).entries()) {
      if (item?.type === "MODULE") fromActiveVersion(`course.items[${i}]`, item.module?.activeVersion);
    }
    for (const [i, m] of (doc.course?.course?.modules ?? []).entries()) fromActiveVersion(`course.modules[${i}]`, m?.activeVersion);
  }
  if (Array.isArray(doc?.questions)) sets.push({ path: "questions", questions: doc.questions });
  return sets;
}

/**
 * @param {Array<{stem:unknown, options:unknown[], correctAnswer:unknown}>} questions one set
 * @returns {{ ok: boolean, issues: Array<{ index: number|null, kind: string, detail: string }>, stats: object }}
 */
export function checkMcqCues(questions, { primary } = {}) {
  const issues = [];
  const positions = [];
  let longestCount = 0;
  let measured = 0;

  for (const [i, q] of (questions ?? []).entries()) {
    const lang = primary ?? pickPrimary(q?.stem);
    const options = (q?.options ?? []).map((o) => textOf(o, lang));
    const answer = textOf(q?.correctAnswer, lang);
    const stem = textOf(q?.stem, lang);
    const label = stem.length > 60 ? `${stem.slice(0, 57)}…` : stem;

    if (options.length < MIN_OPTIONS) {
      issues.push({ index: i, kind: "too_few_options", detail: `${options.length} options — write at least ${MIN_OPTIONS} (playbook: 3–4)` });
    }
    for (const o of options) {
      if (CATCH_ALL.test(o)) issues.push({ index: i, kind: "catch_all_option", detail: `«${o}» — never "all/none of the above"` });
    }
    const correctIndex = options.findIndex((o) => o === answer);
    if (correctIndex < 0) {
      issues.push({ index: i, kind: "answer_not_an_option", detail: "correctAnswer does not equal any option (checked by export-validate too)" });
      continue;
    }
    positions.push(correctIndex);
    const distractors = options.filter((_, j) => j !== correctIndex);
    if (distractors.length === 0) continue;
    measured += 1;
    const meanDistractor = distractors.reduce((s, o) => s + o.length, 0) / distractors.length;
    const longestDistractor = Math.max(...distractors.map((o) => o.length));
    const uniquelyLongest = answer.length > longestDistractor;
    if (uniquelyLongest) longestCount += 1;
    if (meanDistractor > 0 && answer.length / meanDistractor > LENGTH_RATIO) {
      issues.push({
        index: i,
        kind: "correct_is_longest",
        detail: `correct option is ${answer.length} chars, distractors average ${Math.round(meanDistractor)} (${(answer.length / meanDistractor).toFixed(2)}× > ${LENGTH_RATIO}) — «${label}». Make the distractors as complete as the answer, or shorten the answer without losing precision.`,
      });
    }
  }

  const n = positions.length;
  const byPosition = {};
  for (const p of positions) byPosition[p] = (byPosition[p] ?? 0) + 1;
  const stats = {
    questions: (questions ?? []).length,
    measured,
    correctPositionShare: Object.fromEntries(Object.entries(byPosition).map(([p, c]) => [p, n ? c / n : 0])),
    correctLongestShare: measured ? longestCount / measured : 0,
  };
  if (n >= MIN_SET_FOR_DISTRIBUTION) {
    for (const [p, c] of Object.entries(byPosition)) {
      if (c / n > POSITION_SHARE_MAX) {
        issues.push({ index: null, kind: "position_bias", detail: `${c} of ${n} correct answers sit in position ${Number(p) + 1} (${Math.round((100 * c) / n)} % > ${POSITION_SHARE_MAX * 100} %) — rotate where the correct option sits so every position is used about equally.` });
      }
    }
    if (longestCount / measured > LONGEST_SHARE_MAX) {
      issues.push({ index: null, kind: "length_bias", detail: `the correct option is the single longest one in ${longestCount} of ${measured} questions (${Math.round((100 * longestCount) / measured)} % > ${LONGEST_SHARE_MAX * 100} %) — a learner who always picks the longest option passes this set.` });
    }
  }
  return { ok: issues.length === 0, issues, stats };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node mcq-cue-check.mjs package.json [more.json ...]");
    process.exit(2);
  }
  let failed = false;
  for (const file of files) {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const sets = collectMcqSets(doc);
    if (sets.length === 0) { console.log(`--   ${file}: no MCQ sets`); continue; }
    for (const set of sets) {
      const { ok, issues, stats } = checkMcqCues(set.questions);
      const pos = Object.entries(stats.correctPositionShare).map(([p, s]) => `${Number(p) + 1}:${Math.round(s * 100)}%`).join(" ");
      console.log(`${ok ? "OK  " : "FAIL"} ${file} ${set.path} — ${stats.questions} questions, correct-longest ${Math.round(stats.correctLongestShare * 100)} %, positions ${pos}`);
      if (!ok) failed = true;
      for (const issue of issues) console.log(`  - ${issue.index == null ? "set" : `q${issue.index + 1}`} ${issue.kind}: ${issue.detail}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
