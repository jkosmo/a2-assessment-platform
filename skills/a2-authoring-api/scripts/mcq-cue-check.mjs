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
// (mcqService.ts, `shuffleArray(options)`), so the stored position never reaches the learner. #1119:
// it is reported in the stats only, never as a finding.
//
// What it checks, per question and per set (thresholds are deliberately strict — the point is to
// remove obvious cues before the human look, not to certify quality):
//   - per question: correct option is longer than the mean distractor by more than LENGTH_RATIO;
//     fewer than MIN_OPTIONS options; an "all/none of the above"-style option. Difficulty (recall
//     vs. application) cannot be measured here — that stays a reading step (references/modules.md).
//   - per set (n >= MIN_SET_FOR_DISTRIBUTION): share of "correct is uniquely longest" above
//     LONGEST_SHARE_MAX.
//
// #1119: ONE file for the skill and the platform (`#mcq-cue` in package.json, like
// `#frame-structure`). The skill stops on every finding; the platform shows them as warnings. Three
// more rules, each measured on the 15 stage courses (2026-10-26) before its threshold was set:
//   - absolute words ("aldri", "alltid", "automatisk" …) in the wrong options and not in the right
//     ones — per set, since one "aldri" can be the real misconception;
//   - a stem that asks what the course says ("Hva anbefaler kurset?") — it tests memory of the text;
//   - a right option that repeats ECHO_MIN_WORDS words in a row from the sections before the test,
//     when no wrong option shares half as many — only when the reading text is given.
//
// Node stdlib only, pure, repo-testable. Usage:
//   node mcq-cue-check.mjs package.json [more.json ...]   (authoring package or export envelope)
//   import { checkMcqCues, collectMcqSets } from "./mcq-cue-check.mjs"

import { readFileSync } from "node:fs";
import { localeValue } from "./localization-check.mjs";
import { nGrams, sharesRun, wordsOf } from "./text-overlap.mjs";

export const LENGTH_RATIO = 1.25;
export const MIN_OPTIONS = 3;
export const MIN_SET_FOR_DISTRIBUTION = 4;
export const LONGEST_SHARE_MAX = 0.5;

// #1119, measured on stage (wrong / right options with the word, of 893 / 328): «aldri» 24/0,
// «alltid» 23/1, «automatisk» 15/0, «kun» 14/0, «ingenting» 5/0, «uansett» 4/0. «Alle», «ingen»,
// «bare» and «må» separate weakly and are left out. nb, nn and en-GB in one list — no word means
// something else in another of the three.
export const ABSOLUTE_WORDS = new Set([
  "alltid", "aldri", "automatisk", "automatiske", "kun", "ingenting", "uansett", "enhver", "ethvert",
  "utelukkende", "utelukkande", "garantert", "umulig", "umogleg", "einkvar",
  "always", "never", "automatically", "only", "nothing", "regardless", "guaranteed", "impossible", "exclusively",
]);
// A set fails with at least this many wrong options holding such a word, and the share among the
// wrong options at least ABSOLUTE_RATIO times the share among the right ones. 10 of 38 stage tests.
export const ABSOLUTE_MIN_WRONG = 3;
export const ABSOLUTE_RATIO = 2;
// 8 words in a row: 25 of 291 single-choice questions on stage, and wrong options rarely reach 6.
export const ECHO_MIN_WORDS = 8;

// The course itself as the subject: «Hva anbefaler kurset», «Hvilke fire ansvarstyper bruker kurset».
// «Ifølge NVE» is a question about the source, not the course, and is not matched; nor is «teksten»,
// which a scenario uses for the document in it («gjemmer det viktigste langt nede i teksten»).
const STEM_ABOUT_COURSE = /(?<![\p{L}\p{N}])(?:kurset|kursets|seksjonen|modulen|leksjonen)(?![\p{L}\p{N}])|\b(?:the|this) (?:course|section|module|lesson)\b/iu;


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

/**
 * Every MCQ set in an authoring package or an export envelope: [{ path, title, questions, reading? }].
 * `reading` (#1119) is the bodyMarkdown of every section before the module in the course order, as
 * stored (localized or plain) — present only where the document has a course order.
 */
export function collectMcqSets(doc) {
  const sets = [];
  const fromActiveVersion = (path, av, title, reading) => {
    if (av?.mcqSet?.questions?.length) sets.push({ path, ...(title ? { title } : {}), questions: av.mcqSet.questions, ...(reading ? { reading: [...reading] } : {}) });
  };
  if (Array.isArray(doc?.objects)) {
    const byRef = new Map(doc.objects.map((o) => [o?.clientRef, o]));
    const course = doc.objects.find((o) => o?.type === "course");
    const readingBefore = new Map();
    const reading = [];
    for (const item of course?.payload?.items ?? []) {
      const target = byRef.get(item?.ref);
      if (target?.type === "section") reading.push(target.payload?.bodyMarkdown);
      if (target?.type === "module") readingBefore.set(target.clientRef, [...reading]);
    }
    for (const o of doc.objects) {
      if (o?.type === "module") fromActiveVersion(`objects[${o.clientRef ?? "?"}]`, o.payload?.activeVersion, null, readingBefore.get(o.clientRef));
    }
    return sets;
  }
  if (doc?.scope === "module") fromActiveVersion("module", doc.module?.activeVersion);
  if (doc?.scope === "course") {
    const reading = [];
    for (const [i, item] of (doc.course?.course?.items ?? []).entries()) {
      if (item?.type === "SECTION") reading.push(item.section?.bodyMarkdown);
      if (item?.type === "MODULE") fromActiveVersion(`course.items[${i}]`, item.module?.activeVersion, item.module?.module?.title, reading);
    }
    for (const [i, m] of (doc.course?.course?.modules ?? []).entries()) fromActiveVersion(`course.modules[${i}]`, m?.activeVersion, m?.module?.title);
  }
  if (Array.isArray(doc?.questions)) sets.push({ path: "questions", questions: doc.questions });
  return sets;
}

// #1077: a stem that names how many are correct gives the answer away — the platform tells the
// learner to select all that apply, and nothing else.
// One list per language (QA 2.100.0): the Norwegian numeral «to» after an English word matched the
// English infinitive («Which actions would you choose to take»). A numeral followed by a hyphen is a
// compound («two-factor», «fire-øyne»), not a count. Nynorsk «vel» alone is also «surely», so only
// «vel dei …» counts.
const COUNT_IN_STEM_NB = /\b(?:hvilke|kva for|velg(?:\s+de)?|vel\s+dei|nevn)\s+(?:to|tre|fire|fem|[2-5])\b(?!-)/i;
const COUNT_IN_STEM_EN = /\b(?:which|choose|select|name)\s+(?:the\s+)?(?:two|three|four|five|[2-5])\b(?!-)/i;
// Stage 2.100.0: with one correct option planned, the model wrote «Hvilket av følgende krav gjelder?»
// — the singular says «exactly one». A select-all stem is plural whatever the number.
const SINGULAR_STEM = /^\s*(?:hvilket|hvilken|kva for ein|kva for eitt|which one)\b/i;
const COUNT_IN_STEM = { test: (stem) => COUNT_IN_STEM_NB.test(stem) || COUNT_IN_STEM_EN.test(stem) || SINGULAR_STEM.test(stem) };

/**
 * #1077: «select all that apply». Every correct answer must be an option; the correct options must
 * not be longer than the incorrect ones as a group; the stem must not say how many. No position
 * statistics — there is no single correct position.
 */
function checkMultiple(q, i, { lang, options, stem, label, issues }) {
  const answers = (Array.isArray(q?.correctAnswers) ? q.correctAnswers : []).map((a) => textOf(a, lang));
  if (answers.length === 0 || answers.some((a) => !options.includes(a))) {
    issues.push({ index: i, kind: "answer_not_an_option", detail: "a «multiple» question needs correctAnswers, each equal to an option (checked by export-validate too)" });
    return;
  }
  if (COUNT_IN_STEM.test(stem)) {
    issues.push({ index: i, kind: "count_in_stem", detail: `the stem says how many are correct — «${label}». The learner is told to select all that apply; ask the question without the number.` });
  }
  const correct = options.filter((o) => answers.includes(o));
  const incorrect = options.filter((o) => !answers.includes(o));
  // Every option correct is allowed on purpose (#1077, product owner 2026-10-24, kept 2026-10-26 in
  // #1119): otherwise a learner sure of all but one knows the last is wrong. Nothing to compare.
  if (incorrect.length === 0) return;
  const mean = (list) => list.reduce((s, o) => s + o.length, 0) / list.length;
  const ratio = mean(correct) / mean(incorrect);
  if (mean(incorrect) > 0 && ratio > LENGTH_RATIO) {
    issues.push({
      index: i,
      kind: "correct_are_longer",
      detail: `correct options average ${Math.round(mean(correct))} chars, the others ${Math.round(mean(incorrect))} (${ratio.toFixed(2)}× > ${LENGTH_RATIO}) — «${label}». Write every option equally complete.`,
    });
  }
}

// #1077 leveranse 2: «put in the right order». The options ARE the right order and the platform
// shuffles them, so neither position nor length is a cue. What can go wrong: too few or too many items,
// the same item twice, a catch-all, and more than one such question in a test.
const ORDER_MIN_ITEMS = 3;
const ORDER_MAX_ITEMS = 6;
const MAX_ORDER_QUESTIONS = 1;
function checkOrder(q, i, { options, issues }) {
  if (options.length < ORDER_MIN_ITEMS || options.length > ORDER_MAX_ITEMS) {
    issues.push({ index: i, kind: "order_item_count", detail: `an «order» question has ${ORDER_MIN_ITEMS}–${ORDER_MAX_ITEMS} items, not ${options.length} (checked by export-validate too)` });
  }
  if (new Set(options).size !== options.length) {
    issues.push({ index: i, kind: "order_duplicate_item", detail: "an «order» question lists the same item twice — the learner cannot tell which comes first" });
  }
}

/**
 * @param {Array<{stem:unknown, options:unknown[], correctAnswer:unknown, questionType?:string, correctAnswers?:unknown[]}>} questions one set
 * @param {{ primary?: string, reading?: unknown[] }} [options] `reading`: the bodyMarkdown of the
 *   sections before the test (localized or plain), for the echo rule; without it the rule is skipped.
 * @returns {{ ok: boolean, issues: Array<{ index: number|null, kind: string, detail: string }>, stats: object }}
 */
export function checkMcqCues(questions, { primary, reading } = {}) {
  const issues = [];
  const positions = [];
  let longestCount = 0;
  let measured = 0;
  let multipleCount = 0;
  let orderCount = 0;
  const absolute = { wrong: 0, wrongWith: 0, right: 0, rightWith: 0, examples: [] };
  const readingLang = primary ?? pickPrimary(questions?.[0]?.stem);
  const readingWords = Array.isArray(reading) ? reading.flatMap((body) => wordsOf(textOf(body, readingLang))) : null;
  const echoGrams = readingWords?.length ? nGrams(readingWords, ECHO_MIN_WORDS) : null;
  const halfGrams = readingWords?.length ? nGrams(readingWords, Math.ceil(ECHO_MIN_WORDS / 2)) : null;

  for (const [i, q] of (questions ?? []).entries()) {
    const lang = primary ?? pickPrimary(q?.stem);
    const options = (q?.options ?? []).map((o) => textOf(o, lang));
    const answer = textOf(q?.correctAnswer, lang);
    const stem = textOf(q?.stem, lang);
    const label = stem.length > 60 ? `${stem.slice(0, 57)}…` : stem;

    if (STEM_ABOUT_COURSE.test(stem)) {
      issues.push({ index: i, kind: "stem_about_course", detail: `the stem asks what the course says — «${label}». That tests memory of the text; ask what the learner should do or conclude in a situation.` });
    }
    // #1077 leveranse 3: i «fill» skriver deltakeren selv — ingen alternativer å lese hint i.
    if (q?.questionType === "fill") continue;
    if (q?.questionType !== "order") {
      const rightOnes = q?.questionType === "multiple" ? (Array.isArray(q?.correctAnswers) ? q.correctAnswers : []).map((a) => textOf(a, lang)) : [answer];
      for (const o of options) {
        const has = wordsOf(o).some((w) => ABSOLUTE_WORDS.has(w));
        if (rightOnes.includes(o)) {
          absolute.right += 1;
          if (has) absolute.rightWith += 1;
        } else {
          absolute.wrong += 1;
          if (has) {
            absolute.wrongWith += 1;
            absolute.examples.push(`q${i + 1} «${o}»`);
          }
        }
      }
      if (echoGrams && rightOnes.some((o) => sharesRun(o, echoGrams, ECHO_MIN_WORDS)) && !options.some((o) => !rightOnes.includes(o) && sharesRun(o, halfGrams, Math.ceil(ECHO_MIN_WORDS / 2)))) {
        issues.push({ index: i, kind: "answer_echoes_text", detail: `the right option repeats ${ECHO_MIN_WORDS}+ words in a row from the sections, and no wrong option does — «${label}». The learner recognises the wording; say it in other words, as it would come up in the work.` });
      }
    }

    if (q?.questionType === "order") {
      orderCount += 1;
      for (const o of options) {
        if (CATCH_ALL.test(o)) issues.push({ index: i, kind: "catch_all_option", detail: `«${o}» — never "all/none of the above"` });
      }
      checkOrder(q, i, { options, issues });
      continue;
    }
    if (options.length < MIN_OPTIONS) {
      issues.push({ index: i, kind: "too_few_options", detail: `${options.length} options — write at least ${MIN_OPTIONS} (write 3–4)` });
    }
    for (const o of options) {
      if (CATCH_ALL.test(o)) issues.push({ index: i, kind: "catch_all_option", detail: `«${o}» — never "all/none of the above"` });
    }
    if (q?.questionType === "multiple") {
      multipleCount += 1;
      checkMultiple(q, i, { lang, options, stem, label, issues });
      continue;
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

  // #1077: høyst halvparten av settet som «velg alle» (produkteier 2026-10-24 — også når forfatteren
  // ber om flere). Ved nye kurs er standarden lavere, høyst omtrent hvert tredje (modules.md).
  const total = (questions ?? []).length;
  if (orderCount > MAX_ORDER_QUESTIONS) {
    issues.push({ index: null, kind: "order_share", detail: `${orderCount} questions are «put in the right order» — at most ${MAX_ORDER_QUESTIONS} per test, where the source states an order.` });
  }
  if (multipleCount > Math.floor(total / 2)) {
    issues.push({ index: null, kind: "multiple_share", detail: `${multipleCount} of ${total} questions are «select all that apply» — at most ${Math.floor(total / 2)} (half the set). Keep the type for the questions where the source lists several things that all hold.` });
  }

  const wrongShare = absolute.wrong ? absolute.wrongWith / absolute.wrong : 0;
  const rightShare = absolute.right ? absolute.rightWith / absolute.right : 0;
  if (absolute.wrongWith >= ABSOLUTE_MIN_WRONG && wrongShare >= ABSOLUTE_RATIO * rightShare) {
    issues.push({
      index: null,
      kind: "absolute_words",
      count: absolute.wrongWith,
      detail: `${absolute.wrongWith} of ${absolute.wrong} wrong options say «aldri», «alltid», «kun», «automatisk» or the like, against ${absolute.rightWith} of ${absolute.right} right ones — a learner who rules those out passes without knowing the material. Rewrite them as misconceptions someone would hold: ${absolute.examples.slice(0, 6).join("; ")}.`,
    });
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
      const { ok, issues, stats } = checkMcqCues(set.questions, { reading: set.reading });
      const pos = Object.entries(stats.correctPositionShare).map(([p, s]) => `${Number(p) + 1}:${Math.round(s * 100)}%`).join(" ");
      console.log(`${ok ? "OK  " : "FAIL"} ${file} ${set.path} — ${stats.questions} questions, correct-longest ${Math.round(stats.correctLongestShare * 100)} %, positions ${pos}`);
      if (!ok) failed = true;
      for (const issue of issues) console.log(`  - ${issue.index == null ? "set" : `q${issue.index + 1}`} ${issue.kind}: ${issue.detail}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
