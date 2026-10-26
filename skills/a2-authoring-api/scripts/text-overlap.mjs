// #1119 / #1121: how much of one text stands word for word in another. Shared by the question check
// (a right option that repeats the sections) and the exercise check (an answer key that repeats the
// text right above it) — one way of counting, so the two rules cannot drift apart.
//
// Words are runs of letters and digits, lower-cased; pictures (`![…](…)`) are left out. A "run" is
// n words in a row.
//
// Node stdlib only, pure.

/** The words of a text, for comparison. */
export function wordsOf(text) {
  return String(text ?? "").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Every run of n words in a list of words, as one string each. */
export function nGrams(words, n) {
  const grams = new Set();
  for (let i = 0; i + n <= words.length; i++) grams.add(words.slice(i, i + n).join(" "));
  return grams;
}

/** Does `text` share at least one run of n words with `grams` (from nGrams)? */
export function sharesRun(text, grams, n) {
  const words = wordsOf(text);
  for (let i = 0; i + n <= words.length; i++) if (grams.has(words.slice(i, i + n).join(" "))) return true;
  return false;
}

/**
 * The share (0–1) of the words in `text` that lie in a run of n words also found in `grams`.
 * A text shorter than n words shares nothing.
 */
export function coveredShare(text, grams, n) {
  const words = wordsOf(text);
  if (words.length < n) return 0;
  const hit = new Array(words.length).fill(false);
  for (let i = 0; i + n <= words.length; i++) {
    if (grams.has(words.slice(i, i + n).join(" "))) for (let j = i; j < i + n; j++) hit[j] = true;
  }
  return hit.filter(Boolean).length / words.length;
}
