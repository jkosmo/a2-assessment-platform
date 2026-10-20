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
const NORWEGIAN = new Set(["nb", "nn"]);

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
    // #1095: `null` is an absent optional field, as the platform exports one that was never set
    // (an MCQ-only module has `taskText: null`) — not a field that is missing its languages.
    if (value !== undefined && value !== null) prose.push({ path, value });
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

// ---------------------------------------------------------------------------
// Figure (SVG) localization (#763, Layer B)
// ---------------------------------------------------------------------------
// A text-bearing SVG figure must be translated the same way prose is: after the primary is
// approved, each figure gets localizedVariants for the OTHER two locales (its `<text>` translated,
// geometry unchanged). This mirrors the platform's #657 SVG-localization mechanism. We verify:
// every text-bearing SVG has a variant for each other locale; the variant's label-count equals the
// original's; identifiers/formulas/URLs in labels survive; and the variant is not a blind copy of
// the original labels.

// Minimal <text>/<tspan> extraction via regex, consistent with the platform's extractSvgTexts
// (svgSanitizer.ts): leaf text runs in document order, trimmed, deduplicated. When a <text> holds
// <tspan> children we take the tspans (not the concatenated parent) so a run is never counted twice.
export function extractSvgTextRuns(svg) {
  const source = String(svg ?? "");
  const runs = [];
  const seen = new Set();
  const push = (raw) => {
    const value = String(raw).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (value.length > 0 && !seen.has(value)) {
      seen.add(value);
      runs.push(value);
    }
  };
  for (const match of source.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)) {
    const inner = match[1];
    if (/<tspan\b/i.test(inner)) {
      for (const tspan of inner.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/gi)) push(tspan[1]);
    } else {
      push(inner);
    }
  }
  return runs;
}

/**
 * The labels of a figure THE WAY THE PLATFORM COUNTS THEM when it compares a layout with the wide
 * figure (#1079, #1087): the text of every `<text>`, `<tspan>`, `<textPath>` and `<title>` that has
 * no `<tspan>`/`<textPath>` inside it, trimmed at the ends and otherwise untouched, each counted once.
 *
 * ⚠️ Not `extractSvgTextRuns`. That one collapses white space and does not read `<title>`; used for
 * this comparison it passed layouts the import then refused (a line break inside a label, a
 * different title). The two are held to the same answer by a repo unit test that sends the same
 * figures through this function and through the platform — change one, and the test says so.
 */
export function extractLayoutLabels(svg) {
  const source = String(svg ?? "");
  const labels = [];
  const seen = new Set();
  const decode = (text) => text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const push = (raw) => {
    const value = decode(String(raw).replace(/<[^>]*>/g, "")).trim();
    if (value.length > 0 && !seen.has(value)) {
      seen.add(value);
      labels.push(value);
    }
  };
  const holdsRuns = (inner) => /<(?:tspan|textPath)\b/i.test(inner);
  for (const match of source.matchAll(/<(text|title)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const inner = match[2];
    if (match[1].toLowerCase() === "title" || !holdsRuns(inner)) { push(inner); continue; }
    for (const run of inner.matchAll(/<(tspan|textPath)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      if (!holdsRuns(run[2])) push(run[2]);
    }
  }
  return labels;
}

function decodeSvg(contentBase64) {
  try {
    return Buffer.from(String(contentBase64 ?? ""), "base64").toString("utf8");
  } catch {
    return "";
  }
}

// Collect every SVG figure carried on a section object: { path, sourceId, sourceLocale, runs,
// variants: [{ locale, runs }] }. Non-SVG (raster) assets are skipped — they cannot be translated
// (baked pixels), which the localization check reports separately as untranslatable if they carry
// author-declared text, but this deterministic check only covers SVG whose text it can read.
export function collectFigures(pkg) {
  const figures = [];
  for (const object of pkg.objects ?? []) {
    if (object.type !== "section") continue;
    const ref = object.clientRef;
    const assets = object.payload?.assets ?? [];
    assets.forEach((asset, index) => {
      if (asset?.mimeType !== "image/svg+xml") return;
      const wide = {
        path: `${ref}.assets[${index}]`,
        sourceId: asset.sourceId,
        sourceLocale: asset.sourceLocale ?? null,
        runs: extractSvgTextRuns(decodeSvg(asset.contentBase64)),
        // `labels` is what a layout is compared on (#1087) — counted the platform's way, not `runs`.
        labels: extractLayoutLabels(decodeSvg(asset.contentBase64)),
        variants: (asset.localizedVariants ?? []).map((variant) => ({
          locale: variant.locale,
          runs: extractSvgTextRuns(decodeSvg(variant.contentBase64)),
          labels: extractLayoutLabels(decodeSvg(variant.contentBase64)),
        })),
      };
      figures.push(wide);
      // #1079: the other layouts of a figure (narrow) are figures in their own right — each needs
      // its variants, its label count and its preserved tokens — so each is collected as one, and
      // every check below applies to it without knowing what a layout is. `wide` is what it is
      // compared with: a layout carries the same texts as the wide figure, language by language.
      (Array.isArray(asset.layoutVariants) ? asset.layoutVariants : []).forEach((layoutVariant, layoutIndex) => {
        figures.push({
          path: `${ref}.assets[${index}].layoutVariants[${layoutIndex}]`,
          sourceId: asset.sourceId,
          layout: layoutVariant?.layout ?? null,
          sourceLocale: asset.sourceLocale ?? null,
          runs: extractSvgTextRuns(decodeSvg(layoutVariant?.contentBase64)),
          labels: extractLayoutLabels(decodeSvg(layoutVariant?.contentBase64)),
          variants: (layoutVariant?.localizedVariants ?? []).map((variant) => ({
            locale: variant.locale,
            runs: extractSvgTextRuns(decodeSvg(variant.contentBase64)),
            labels: extractLayoutLabels(decodeSvg(variant.contentBase64)),
          })),
          wide,
        });
      });
    });
  }
  return figures;
}

function preservedTokensOf(runs) {
  const tokens = new Set();
  for (const run of runs) for (const token of extractPreservedTokens(run)) tokens.add(token);
  return tokens;
}

// A variant is a "blind copy" when its ordered label runs equal the original's AND the labels read
// as translatable prose (>= 2 distinct alphabetic words of >= 4 chars). Short single-word labels
// ("Start", "A", "72") that legitimately stay identical are NOT flagged.
function figureRunsAreBlindCopy(originalRuns, variantRuns) {
  if (originalRuns.length === 0 || originalRuns.length !== variantRuns.length) return false;
  const identical = originalRuns.every(
    (run, index) => run.toLowerCase() === (variantRuns[index] ?? "").toLowerCase(),
  );
  if (!identical) return false;
  const words = (originalRuns.join(" ").match(/[\p{L}]{4,}/gu) ?? []).map((w) => w.toLowerCase());
  return new Set(words).size >= 2;
}

// Deterministic figure-localization check. Blocks on a missing variant, a changed label count,
// lost identifiers/formulas/URLs, or a blind copy of the original labels.
export function checkFigureLocalization(pkg, { languages = LANGUAGES, primary = "nb" } = {}) {
  const missingVariants = [];
  const textCountMismatches = [];
  const tokenDrift = [];
  const blindCopies = [];
  const layoutTextMismatches = [];

  // #1079: the platform translates the wide figure and writes the answers into every layout by
  // matching the original text, so it refuses a layout whose texts differ from the wide figure.
  // The same rule is applied here — a package this check passes must not be one the import refuses.
  // #1087: on the labels as the platform counts them (`extractLayoutLabels`), which a repo unit
  // test holds to the platform's own answer. The first version compared `runs`, and was looser.
  const sameTexts = (a, b) => a.length === b.length && a.every((label) => b.includes(label));

  for (const figure of collectFigures(pkg)) {
    if (figure.wide) {
      if (!sameTexts(figure.labels, figure.wide.labels)) {
        layoutTextMismatches.push({ path: figure.path, sourceId: figure.sourceId, layout: figure.layout, locale: null });
      }
      for (const variant of figure.variants) {
        const wideVariant = figure.wide.variants.find((v) => v.locale === variant.locale);
        if (wideVariant && !sameTexts(variant.labels, wideVariant.labels)) {
          layoutTextMismatches.push({ path: figure.path, sourceId: figure.sourceId, layout: figure.layout, locale: variant.locale });
        }
      }
    }
    if (figure.runs.length === 0) continue; // no translatable text → nothing to localize
    const source = figure.sourceLocale ?? primary;
    const targets = languages.filter((lang) => lang !== source);
    const runsByLocale = new Map(figure.variants.map((v) => [v.locale, v.runs]));
    const originalTokens = preservedTokensOf(figure.runs);

    for (const locale of targets) {
      if (!runsByLocale.has(locale)) {
        missingVariants.push({ path: figure.path, sourceId: figure.sourceId, locale });
        continue;
      }
      const variantRuns = runsByLocale.get(locale);
      if (variantRuns.length !== figure.runs.length) {
        textCountMismatches.push({
          path: figure.path,
          sourceId: figure.sourceId,
          locale,
          expected: figure.runs.length,
          actual: variantRuns.length,
        });
      }
      const variantTokens = preservedTokensOf(variantRuns);
      for (const token of originalTokens) {
        if (!variantTokens.has(token)) tokenDrift.push({ path: figure.path, sourceId: figure.sourceId, locale, token });
      }
      // Bokmål and Nynorsk often share a short label word for word ("Samle data"): between those
      // two, identical labels are a translation, not a copy. Refusing them forces a worse word.
      const bothNorwegian = NORWEGIAN.has(source) && NORWEGIAN.has(locale);
      if (!bothNorwegian && figureRunsAreBlindCopy(figure.runs, variantRuns)) {
        blindCopies.push({ path: figure.path, sourceId: figure.sourceId, locale });
      }
    }
  }

  const reasons = [];
  if (missingVariants.length > 0) reasons.push(`${missingVariants.length} SVG figure variant(s) missing a language`);
  if (textCountMismatches.length > 0) reasons.push(`${textCountMismatches.length} SVG figure variant(s) with a changed label count`);
  if (tokenDrift.length > 0) reasons.push(`${tokenDrift.length} identifier/formula/URL(s) lost in an SVG figure variant`);
  if (blindCopies.length > 0) reasons.push(`${blindCopies.length} SVG figure variant(s) are a blind copy of the original labels`);

  if (layoutTextMismatches.length > 0) reasons.push(`${layoutTextMismatches.length} figure layout(s) do not carry the same labels as the wide figure — draw both from one description (draw-flow-figure.mjs)`);

  return { missingVariants, textCountMismatches, tokenDrift, blindCopies, layoutTextMismatches, blocks: reasons.length > 0, reasons };
}

// Full localization check over the package. Blocks on any missing locale, structural loss,
// answer-key change, or preserved-token drift. Blind copies are reported and (by default) block,
// because the requirement is REAL translations, not the primary copied into every locale.
// #763 (Layer B): text-bearing SVG figures are localized too — folded into `figures` + `blocks`.
/**
 * #1074: fasiten i hver «sjekk deg selv»-ramme i en tekst, som et mønster per ramme ("010" = det andre
 * av tre alternativer er riktig). Plattformen leser rammen slik (src/modules/course/contentBlocks.ts):
 * alternativene står først, `- [ ]` eller `- [x]`.
 */
export function checkAnswerPatterns(text) {
  const patterns = [];
  const frame = /^:::[ \t]*(?:sjekk|check)[ \t]+\S[^\r\n]*\r?\n([\s\S]*?)\r?\n:::[ \t]*$/gim;
  for (const match of String(text ?? "").matchAll(frame)) {
    let pattern = "";
    for (const line of match[1].split(/\r?\n/)) {
      if (pattern === "" && line.trim() === "") continue;
      const option = /^[ \t]*[-*][ \t]+\[([ xX])\][ \t]+\S/.exec(line);
      if (option) {
        pattern += option[1].toLowerCase() === "x" ? "1" : "0";
        continue;
      }
      // #1110: an indented line under an option is its feedback — "f" after the option, once, so a
      // translation that drops or moves a feedback shows up as another pattern.
      if (pattern !== "" && /^(?: {2,}|\t)[ \t]*\S/.test(line)) {
        if (!pattern.endsWith("f")) pattern += "f";
        continue;
      }
      break;
    }
    patterns.push(pattern);
  }
  return patterns;
}

const PRACTICE_KIND = { steg: "steg", steps: "steg", skriv: "skriv", write: "skriv", repetisjon: "repetisjon", flashcards: "repetisjon", par: "par", pairs: "par" };

/**
 * #1075, #1076, #1078: formen på hver øvingsramme i en tekst, i rekkefølge — "steg:4" (fire steg),
 * "skriv:3" (tre punkter i sjekklista), "repetisjon:5" (fem kort). Leses slik plattformen leser rammen
 * (src/modules/course/contentBlocks.ts): en overskrift begynner et steg eller et kort, og sjekklista er
 * `- [ ]`-linjene til slutt i en skriv-ramme. Det engelske markørordet er samme ramme.
 */
export function practiceBlockShapes(text) {
  const shapes = [];
  const frame = /^:::[ \t]*(steg|steps|skriv|write|repetisjon|flashcards|par|pairs)\b[^\r\n]*\r?\n([\s\S]*?)\r?\n:::[ \t]*$/gim;
  for (const match of String(text ?? "").matchAll(frame)) {
    const kind = PRACTICE_KIND[match[1].toLowerCase()];
    const lines = match[2].split(/\r?\n/);
    let count = 0;
    if (kind === "skriv") {
      let end = lines.length;
      while (end > 0 && lines[end - 1].trim() === "") end -= 1;
      while (end > 0 && /^[ \t]*[-*][ \t]+\[[ xX]\][ \t]+\S/.test(lines[end - 1])) {
        count += 1;
        end -= 1;
      }
    } else if (kind === "par") {
      // #1107: one pair per line, «- term = explanation».
      count = lines.filter((line) => /^[ \t]*[-*][ \t]+\S.*?[ \t]+=[ \t]+\S/.test(line)).length;
    } else count = lines.filter((line) => /^ {0,3}#{1,6}[ \t]+\S/.test(line)).length;
    shapes.push(`${kind}:${count}`);
  }
  return shapes;
}

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

  // #1074: fasiten i «sjekk deg selv» skal stå på samme plass på alle språk, i like mange rammer.
  for (const field of prose) {
    const reference = checkAnswerPatterns(localeValue(field.value, primary));
    if (reference.length === 0) continue;
    const drifted = languages.filter((lang) => lang !== primary && presentLocales(field.value).includes(lang)
      && checkAnswerPatterns(localeValue(field.value, lang)).join("|") !== reference.join("|"));
    if (drifted.length > 0) {
      answerKeyChanges.push({ path: field.path, detail: `a «sjekk deg selv» question has its right option (- [x]) in another place, a feedback line under another option, or a question is missing, in: ${drifted.join(", ")}` });
    }
  }

  // #1075/#1076/#1078: like mange steg, sjekkpunkter og kort på alle språk. Et steg eller et kort som
  // forsvant i oversettelsen, ser deltakeren aldri; et sjekkpunkt som forsvant, sjekker hen aldri.
  const blockShapeChanges = [];
  for (const field of prose) {
    const reference = practiceBlockShapes(localeValue(field.value, primary));
    if (reference.length === 0) continue;
    const drifted = languages.filter((lang) => lang !== primary && presentLocales(field.value).includes(lang)
      && practiceBlockShapes(localeValue(field.value, lang)).join("|") !== reference.join("|"));
    if (drifted.length > 0) {
      blockShapeChanges.push({
        path: field.path,
        detail: `a step-by-step, write-it-yourself, flashcard or match-the-pairs frame has another number of steps, checklist points, cards or pairs, or is missing, in: ${drifted.join(", ")} (${primary} has ${reference.join(", ")})`,
      });
    }
  }

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

  const figures = checkFigureLocalization(pkg, { languages, primary });

  const reasons = [];
  if (missing.length > 0) reasons.push(`${missing.length} localized field(s) missing a language`);
  if (optionCountMismatches.length > 0) reasons.push(`${optionCountMismatches.length} option-count mismatch(es)`);
  if (answerKeyChanges.length > 0) reasons.push(`${answerKeyChanges.length} answer-key change(s) across languages`);
  if (blockShapeChanges.length > 0) reasons.push(`${blockShapeChanges.length} step, checklist or flashcard frame(s) with another shape in a translation`);
  if (tokenDrift.length > 0) reasons.push(`${tokenDrift.length} formula/URL/identifier(s) lost in a translation`);
  if (blindCopyBlocks && blindCopies.length > 0) reasons.push(`${blindCopies.length} field(s) are a blind copy of the primary language`);
  reasons.push(...figures.reasons);

  return {
    primary,
    languages: [...languages],
    missing,
    blindCopies,
    answerKeyChanges,
    blockShapeChanges,
    optionCountMismatches,
    tokenDrift,
    figures,
    blocks: reasons.length > 0,
    reasons,
  };
}
