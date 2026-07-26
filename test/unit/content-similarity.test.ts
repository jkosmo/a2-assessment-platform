import { describe, it, expect } from "vitest";
import {
  tokenize,
  lexicalCosineSimilarity,
  extractAnswerText,
} from "../../src/modules/assessment/contentSimilarity.js";

describe("tokenize", () => {
  it("lowercases and keeps word/number tokens of length >= 2", () => {
    expect(tokenize("Hei, KS1 og KS2!")).toEqual(["hei", "ks1", "og", "ks2"]);
  });
  it("drops single-character tokens and splits on punctuation", () => {
    // "I/O" splits on the slash into "i" and "o" (both length 1, dropped); "io24" survives.
    expect(tokenize("a I/O, x — io24")).toEqual(["io24"]);
  });
  it("returns [] for empty / non-string", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize(undefined as unknown as string)).toEqual([]);
  });
});

describe("lexicalCosineSimilarity", () => {
  it("is 1 for identical text", () => {
    expect(lexicalCosineSimilarity("the quick brown fox", "the quick brown fox")).toBe(1);
  });
  it("is 0 for disjoint vocabularies", () => {
    expect(lexicalCosineSimilarity("alpha beta gamma", "delta epsilon zeta")).toBe(0);
  });
  it("is 0 when either side is empty", () => {
    expect(lexicalCosineSimilarity("", "anything here")).toBe(0);
    expect(lexicalCosineSimilarity("anything here", "")).toBe(0);
  });
  it("is between 0 and 1 for partial overlap, and symmetric", () => {
    const a = "kvalitetssikring av konsept og styringsunderlag";
    const b = "kvalitetssikring av kostnadsoverslag og styringsunderlag";
    const s = lexicalCosineSimilarity(a, b);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
    expect(lexicalCosineSimilarity(b, a)).toBeCloseTo(s, 10);
  });
  it("ignores word order (bag-of-words)", () => {
    expect(lexicalCosineSimilarity("fox brown quick the", "the quick brown fox")).toBe(1);
  });
});

describe("extractAnswerText", () => {
  it("joins string field values, ignoring non-strings", () => {
    expect(extractAnswerText({ response: "Line one", reflection: "Line two", count: 3 })).toBe(
      "Line one\nLine two",
    );
  });
  it("returns '' for empty / non-object", () => {
    expect(extractAnswerText({})).toBe("");
    expect(extractAnswerText(null)).toBe("");
  });
});
