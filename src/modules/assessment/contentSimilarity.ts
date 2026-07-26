// #475 Phase 2: lexical cosine similarity between two texts. Deterministic, self-contained (no
// embeddings infra) — a coarse but transparent signal used ONLY to flag a submission for human review,
// never as a verdict. See doc/design/AI_INFLUENCE_FLAGGING_475.md.
//
// Honest limitation: two correct answers to the same factual task naturally share domain vocabulary, so
// high lexical similarity is a WEAK signal on its own. That is exactly why it ships OFF + shadow-mode:
// it collects pilot data so a product owner can calibrate the threshold (and false-positive rate)
// before it is ever allowed to route anyone. A future backend could swap in embeddings-cosine behind
// this same function without changing callers.

const TOKEN_RE = /[\p{L}\p{N}]+/gu;
const MIN_TOKEN_LEN = 2;

/** Lowercase word/number tokens of length >= 2. */
export function tokenize(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const matches = text.toLowerCase().match(TOKEN_RE);
  if (!matches) return [];
  return matches.filter((t) => t.length >= MIN_TOKEN_LEN);
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

/**
 * Cosine similarity of the two texts' term-frequency vectors, in [0, 1]. Returns 0 when either side has
 * no tokens (nothing to compare).
 */
export function lexicalCosineSimilarity(a: string, b: string): number {
  const tfA = termFrequency(tokenize(a));
  const tfB = termFrequency(tokenize(b));
  if (tfA.size === 0 || tfB.size === 0) return 0;

  // Dot product over the smaller map's keys.
  const [small, large] = tfA.size <= tfB.size ? [tfA, tfB] : [tfB, tfA];
  let dot = 0;
  for (const [token, count] of small) {
    const other = large.get(token);
    if (other) dot += count * other;
  }
  if (dot === 0) return 0;

  let sumSqA = 0;
  for (const count of tfA.values()) sumSqA += count * count;
  let sumSqB = 0;
  for (const count of tfB.values()) sumSqB += count * count;

  const magnitude = Math.sqrt(sumSqA) * Math.sqrt(sumSqB);
  if (magnitude === 0) return 0;
  // Clamp to [0,1] to guard against floating-point drift.
  return Math.min(1, Math.max(0, dot / magnitude));
}

/**
 * Concatenate the string field values of a submission responseJson into one comparable text blob.
 * Non-string values are ignored (the student's answer is free text).
 */
export function extractAnswerText(responseJson: Record<string, unknown> | null | undefined): string {
  if (!responseJson || typeof responseJson !== "object") return "";
  return Object.values(responseJson)
    .filter((v): v is string => typeof v === "string")
    .join("\n")
    .trim();
}
