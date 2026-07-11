// AA-6 (#762): deterministic localization check for the a2-authoring-api skill.
//
// Problem this guards against: an imported package had content in only ONE language. The skill
// fixes a primary language for the dialogue, then must produce REAL translations for all three
// supported languages (nb, nn, en-GB) before production — not the same bokmål text copied into
// every locale field.
//
// This module verifies, over an a2-authoring-package/v1: all three languages present in every
// student-facing localized field; equal structure across languages; no language lost a section /
// question / option / rubric-criterion; fields are not a blind copy of the primary; and the
// answer key (MCQ correct answer) is unchanged across languages. It also verifies that
// formulas / code / identifiers / filenames / URLs are preserved across every locale.
//
// IMPORTANT (documented, do not change the API contract): A2's schema localizes only SOME
// fields. rubric.criteria and rubric.scalingRule are z.record(z.unknown()) — NOT localized
// datatypes — so criteria text is not enforced per-locale by the platform. See
// references/localization.md. This checker covers exactly the schema-localized student-facing
// fields; it does not invent localization the contract does not have.
//
// Node stdlib only, pure, repo-testable (test/unit/agent-authoring-localization.test.ts).

export const LANGUAGES = Object.freeze(["nb", "nn", "en-GB"]);

// Read one locale's string from a localizedText value (plain string applies to all locales).
export function localeValue(localized, lang) {
  if (localized == null) return undefined;
  if (typeof localized === "string") return localized;
  if (typeof localized === "object") return localized[lang];
  return undefined;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Which of the three languages carry a non-empty value.
export function presentLocales(localized) {
  if (typeof localized === "string") return nonEmpty(localized) ? [...LANGUAGES] : [];
  return LANGUAGES.filter((lang) => nonEmpty(localeValue(localized, lang)));
}

// A prose field is a "blind copy" when all three locales hold the identical string AND that
// string reads as translatable prose (>= 2 alphabetic words of >= 4 chars). This deliberately
// does NOT flag short tokens, proper nouns, numbers or bare identifiers ("GDPR", "72") that are
// legitimately identical across languages.
export function isBlindCopy(localized) {
  const values = LANGUAGES.map((lang) => (localeValue(localized, lang) ?? "").trim());
  if (values.some((v) => v.length === 0)) return false; // handled by missing-locale check
  const allEqual = values.every((v) => v.toLowerCase() === values[0].toLowerCase());
  if (!allEqual) return false;
  const words = (values[0].match(/[\p{L}]{4,}/gu) ?? []).map((w) => w.toLowerCase());
  return new Set(words).size >= 2;
}

// Tokens that MUST survive translation verbatim: URLs, filenames, code identifiers with parens,
// legal-article references, and simple formulas/equalities. Returned as a normalised set.
export function extractPreservedTokens(text) {
  const s = String(text ?? "");
  const tokens = new Set();
  const add = (m) => m && tokens.add(m.trim());
  for (const m of s.matchAll(/https?:\/\/[^\s)]+/gi)) add(m[0]);
  for (const m of s.matchAll(/\b[\w-]+\.(?:pdf|json|csv|xlsx?|md|png|jpe?g|ya?ml|ts|js|sql)\b/gi)) add(m[0].toLowerCase());
  for (const m of s.matchAll(/\b[A-Za-z_][\w.]*\([^)]*\)/g)) add(m[0]);
  for (const m of s.matchAll(/\bart\.?\s*\d+(?:\([^)]*\))*/gi)) add(m[0].toLowerCase().replace(/\s+/g, ""));
  for (const m of s.matchAll(/\d+(?:[.,]\d+)?\s*[+\-*/=^]\s*\d+(?:[.,]\d+)?(?:\s*[=]\s*\d+(?:[.,]\d+)?)?/g)) add(m[0].replace(/\s+/g, ""));
  return tokens;
}

// Walk an a2-authoring-package/v1 and collect every student-facing localized field the schema
// localizes: { prose: [{ path, value }], mcqQuestions: [{ path, stem, options, correctAnswer,
// rationale }] }.
export function collectLocalizedFields(pkg) {
  const prose = [];
  const mcqQuestions = [];
  const push = (path, value) => {
    if (value !== undefined) prose.push({ path, value });
  };

  for (const object of pkg.objects ?? []) {
    const ref = object.clientRef;
    const p = object.payload ?? {};
    if (object.type === "course") {
      push(`${ref}.course.title`, p.course?.title);
      push(`${ref}.course.description`, p.course?.description);
    } else if (object.type === "section") {
      push(`${ref}.title`, p.title);
      push(`${ref}.bodyMarkdown`, p.bodyMarkdown);
    } else if (object.type === "module") {
      push(`${ref}.module.title`, p.module?.title);
      push(`${ref}.module.description`, p.module?.description);
      const av = p.activeVersion ?? {};
      push(`${ref}.activeVersion.taskText`, av.taskText);
      push(`${ref}.activeVersion.assessorExpectedContent`, av.assessorExpectedContent);
      push(`${ref}.activeVersion.candidateTaskConstraints`, av.candidateTaskConstraints);
      push(`${ref}.activeVersion.promptTemplate.systemPrompt`, av.promptTemplate?.systemPrompt);
      push(`${ref}.activeVersion.promptTemplate.userPromptTemplate`, av.promptTemplate?.userPromptTemplate);
      push(`${ref}.activeVersion.mcqSet.title`, av.mcqSet?.title);
      for (const [i, field] of (av.submissionSchema?.fields ?? []).entries()) {
        push(`${ref}.activeVersion.submissionSchema.fields[${i}].label`, field.label);
        push(`${ref}.activeVersion.submissionSchema.fields[${i}].placeholder`, field.placeholder);
      }
      for (const [qi, q] of (av.mcqSet?.questions ?? []).entries()) {
        mcqQuestions.push({
          path: `${ref}.activeVersion.mcqSet.questions[${qi}]`,
          stem: q.stem,
          options: q.options ?? [],
          correctAnswer: q.correctAnswer,
          rationale: q.rationale,
        });
      }
    }
  }
  return { prose, mcqQuestions };
}

// For a localized field, in each language, verify the preserved tokens found in the PRIMARY
// language also appear in that language. Returns [{ token, missingLocales }].
function tokenDriftFor(localized, primary) {
  const primaryTokens = extractPreservedTokens(localeValue(localized, primary));
  const drift = [];
  for (const token of primaryTokens) {
    const missingLocales = LANGUAGES.filter((lang) => {
      if (lang === primary) return false;
      const text = localeValue(localized, lang);
      if (text == null) return false; // a wholly-missing locale is a missing-field finding, not drift
      return !extractPreservedTokens(text).has(token);
    });
    if (missingLocales.length > 0) drift.push({ token, missingLocales });
  }
  return drift;
}

// Structural identity used to map an MCQ correctAnswer to an option index within one locale.
function localeString(localized, lang) {
  return (localeValue(localized, lang) ?? "").trim();
}

// Full localization check over the package. Blocks on any missing locale, structural loss,
// answer-key change, or preserved-token drift. Blind copies are reported and (by default) block,
// because the requirement is REAL translations, not the primary copied into every locale.
export function checkLocalization(pkg, { languages = LANGUAGES, primary = "nb", blindCopyBlocks = true } = {}) {
  const { prose, mcqQuestions } = collectLocalizedFields(pkg);
  const missing = [];
  const blindCopies = [];
  const answerKeyChanges = [];
  const optionCountMismatches = [];
  const tokenDrift = [];

  const checkField = (path, value) => {
    const present = presentLocales(value);
    const missingLocales = languages.filter((lang) => !present.includes(lang));
    if (missingLocales.length > 0) missing.push({ path, missingLocales });
    else if (isBlindCopy(value)) blindCopies.push({ path });
    for (const d of tokenDriftFor(value, primary)) tokenDrift.push({ path, ...d });
  };

  for (const field of prose) checkField(field.path, field.value);

  for (const q of mcqQuestions) {
    checkField(`${q.path}.stem`, q.stem);
    if (q.rationale !== undefined) checkField(`${q.path}.rationale`, q.rationale);
    q.options.forEach((opt, oi) => checkField(`${q.path}.options[${oi}]`, opt));
    checkField(`${q.path}.correctAnswer`, q.correctAnswer);

    // Answer key must map to the SAME option position in every language (semantic, per-locale —
    // not by index): find which option equals correctAnswer in each locale, compare positions.
    const indexByLocale = {};
    let structurallyOk = true;
    for (const lang of languages) {
      const answer = localeString(q.correctAnswer, lang);
      const idx = q.options.findIndex((opt) => localeString(opt, lang) === answer && answer.length > 0);
      indexByLocale[lang] = idx;
      if (idx < 0) structurallyOk = false;
    }
    if (!structurallyOk) {
      answerKeyChanges.push({ path: q.path, detail: "correctAnswer does not match any option in one or more locales", indexByLocale });
    } else {
      const primaryIdx = indexByLocale[primary];
      const drifted = languages.filter((lang) => indexByLocale[lang] !== primaryIdx);
      if (drifted.length > 0) {
        answerKeyChanges.push({ path: q.path, detail: `correct option differs across locales: ${drifted.join(", ")}`, indexByLocale });
      }
    }
  }

  const reasons = [];
  if (missing.length > 0) reasons.push(`${missing.length} localized field(s) missing a language`);
  if (optionCountMismatches.length > 0) reasons.push(`${optionCountMismatches.length} option-count mismatch(es)`);
  if (answerKeyChanges.length > 0) reasons.push(`${answerKeyChanges.length} answer-key change(s) across languages`);
  if (tokenDrift.length > 0) reasons.push(`${tokenDrift.length} formula/URL/identifier(s) lost in a translation`);
  if (blindCopyBlocks && blindCopies.length > 0) reasons.push(`${blindCopies.length} field(s) are a blind copy of the primary language`);

  return {
    primary,
    languages: [...languages],
    missing,
    blindCopies,
    answerKeyChanges,
    optionCountMismatches,
    tokenDrift,
    blocks: reasons.length > 0,
    reasons,
  };
}
