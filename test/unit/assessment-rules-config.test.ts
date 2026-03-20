/**
 * Negative config validation tests for assessment-rules.json.
 *
 * Strategy: test the exported rulesSchema directly using safeParse().
 * "Valid syntax, wrong semantics" — JSON that parses but violates the zod schema.
 *
 * Related issue: #213
 */
import { describe, it, expect } from "vitest";
import { rulesSchema } from "../../src/config/assessmentRules.js";

// ---------------------------------------------------------------------------
// Minimal valid config used as a base for mutation tests
// ---------------------------------------------------------------------------

const valid = {
  thresholds: { totalMin: 70, practicalMinPercent: 50, mcqMinPercent: 60 },
  weights: { practicalMaxScore: 70, mcqMaxScore: 30 },
  manualReview: {
    borderlineWindow: { min: 67, max: 73 },
    redFlagSeverities: ["high"],
    redFlagCodes: ["policy_violation"],
  },
} as const;

function withThresholds(overrides: Record<string, unknown>) {
  return { ...valid, thresholds: { ...valid.thresholds, ...overrides } };
}

function withWeights(overrides: Record<string, unknown>) {
  return { ...valid, weights: { ...valid.weights, ...overrides } };
}

function withManualReview(overrides: Record<string, unknown>) {
  return { ...valid, manualReview: { ...valid.manualReview, ...overrides } };
}

// ---------------------------------------------------------------------------
// Baseline: minimal valid config parses successfully
// ---------------------------------------------------------------------------

describe("rulesSchema — baseline validity", () => {
  it("accepts a minimal valid config (optional sections use defaults)", () => {
    const result = rulesSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts the full production config shape", () => {
    const full = {
      ...valid,
      llmDecisionReliability: {
        unknownRedFlagHandling: "downgrade_to_unclassified",
        unknownRedFlagCanonicalCode: "unclassified_model_warning",
        canonicalRedFlags: { insufficient_submission: ["insufficient_submission"] },
      },
      mcqQuality: { minAttemptCount: 5, difficultyMin: 0.2, difficultyMax: 0.9, discriminationMin: 0.1 },
      sensitiveData: {
        enabledByDefault: false,
        moduleOverrides: {},
        rules: [{ id: "email", pattern: "[A-Z]+@[A-Z]+", replacement: "[MASKED]" }],
      },
      secondaryAssessment: {
        enabledByDefault: true,
        moduleOverrides: {},
        triggerRules: { manualReviewRecommended: true, confidenceNotePatterns: [], redFlagCodes: [], redFlagSeverities: ["high"] },
        disagreementRules: { practicalScoreDeltaMin: 8, rubricTotalDeltaMin: 3, passFailMismatch: true, manualReviewRecommendationMismatch: true },
      },
      recertification: { validityDays: 365, dueOffsetDays: 30, dueSoonDays: 14, reminderDaysBefore: [30, 7, 1] },
    };
    expect(rulesSchema.safeParse(full).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// thresholds — out-of-range values
// ---------------------------------------------------------------------------

describe("rulesSchema — thresholds out of range", () => {
  it("rejects totalMin > 100", () => {
    expect(rulesSchema.safeParse(withThresholds({ totalMin: 101 })).success).toBe(false);
  });

  it("rejects totalMin < 0", () => {
    expect(rulesSchema.safeParse(withThresholds({ totalMin: -1 })).success).toBe(false);
  });

  it("rejects practicalMinPercent > 100", () => {
    expect(rulesSchema.safeParse(withThresholds({ practicalMinPercent: 105 })).success).toBe(false);
  });

  it("rejects practicalMinPercent < 0", () => {
    expect(rulesSchema.safeParse(withThresholds({ practicalMinPercent: -10 })).success).toBe(false);
  });

  it("rejects mcqMinPercent > 100", () => {
    expect(rulesSchema.safeParse(withThresholds({ mcqMinPercent: 200 })).success).toBe(false);
  });

  it("rejects mcqMinPercent < 0", () => {
    expect(rulesSchema.safeParse(withThresholds({ mcqMinPercent: -1 })).success).toBe(false);
  });

  it("rejects non-numeric totalMin", () => {
    expect(rulesSchema.safeParse(withThresholds({ totalMin: "70" })).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// weights — zero and negative scores
// ---------------------------------------------------------------------------

describe("rulesSchema — weights min(1) constraint", () => {
  it("rejects practicalMaxScore = 0", () => {
    expect(rulesSchema.safeParse(withWeights({ practicalMaxScore: 0 })).success).toBe(false);
  });

  it("rejects practicalMaxScore < 0", () => {
    expect(rulesSchema.safeParse(withWeights({ practicalMaxScore: -5 })).success).toBe(false);
  });

  it("rejects mcqMaxScore = 0", () => {
    expect(rulesSchema.safeParse(withWeights({ mcqMaxScore: 0 })).success).toBe(false);
  });

  it("accepts practicalMaxScore = 1 (boundary)", () => {
    expect(rulesSchema.safeParse(withWeights({ practicalMaxScore: 1 })).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// manualReview — structure violations
// ---------------------------------------------------------------------------

describe("rulesSchema — manualReview structure", () => {
  it("rejects redFlagSeverities with empty-string entries", () => {
    expect(
      rulesSchema.safeParse(withManualReview({ redFlagSeverities: [""] })).success,
    ).toBe(false);
  });

  it("rejects redFlagCodes with empty-string entries", () => {
    expect(
      rulesSchema.safeParse(withManualReview({ redFlagCodes: [""] })).success,
    ).toBe(false);
  });

  it("accepts empty redFlagSeverities array (schema does not require non-empty)", () => {
    // Document: the schema accepts [] — callers must handle the empty case themselves.
    expect(
      rulesSchema.safeParse(withManualReview({ redFlagSeverities: [] })).success,
    ).toBe(true);
  });

  it("accepts borderlineWindow where min > max (no cross-field validation in schema)", () => {
    // Document: the schema does NOT enforce min <= max.
    // The decision service is responsible for handling this gracefully.
    expect(
      rulesSchema.safeParse(withManualReview({ borderlineWindow: { min: 80, max: 60 } })).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mcqQuality — optional section, value constraints
// ---------------------------------------------------------------------------

describe("rulesSchema — mcqQuality constraints", () => {
  function withMcqQuality(overrides: Record<string, unknown>) {
    return { ...valid, mcqQuality: { minAttemptCount: 5, difficultyMin: 0.2, difficultyMax: 0.9, discriminationMin: 0.1, ...overrides } };
  }

  it("rejects minAttemptCount = 0 (must be positive integer)", () => {
    expect(rulesSchema.safeParse(withMcqQuality({ minAttemptCount: 0 })).success).toBe(false);
  });

  it("rejects minAttemptCount = -1", () => {
    expect(rulesSchema.safeParse(withMcqQuality({ minAttemptCount: -1 })).success).toBe(false);
  });

  it("rejects difficultyMin > 1", () => {
    expect(rulesSchema.safeParse(withMcqQuality({ difficultyMin: 1.1 })).success).toBe(false);
  });

  it("rejects difficultyMax > 1", () => {
    expect(rulesSchema.safeParse(withMcqQuality({ difficultyMax: 1.5 })).success).toBe(false);
  });

  it("rejects difficultyMin < 0", () => {
    expect(rulesSchema.safeParse(withMcqQuality({ difficultyMin: -0.1 })).success).toBe(false);
  });

  it("accepts difficultyMin = 0 and difficultyMax = 1 (boundaries)", () => {
    expect(rulesSchema.safeParse(withMcqQuality({ difficultyMin: 0, difficultyMax: 1 })).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recertification — optional section, positive integer constraints
// ---------------------------------------------------------------------------

describe("rulesSchema — recertification constraints", () => {
  function withRecertification(overrides: Record<string, unknown>) {
    return {
      ...valid,
      recertification: { validityDays: 365, dueOffsetDays: 30, dueSoonDays: 14, reminderDaysBefore: [30, 7, 1], ...overrides },
    };
  }

  it("rejects validityDays = 0 (must be positive)", () => {
    expect(rulesSchema.safeParse(withRecertification({ validityDays: 0 })).success).toBe(false);
  });

  it("rejects validityDays = -1", () => {
    expect(rulesSchema.safeParse(withRecertification({ validityDays: -1 })).success).toBe(false);
  });

  it("rejects dueOffsetDays < 0", () => {
    expect(rulesSchema.safeParse(withRecertification({ dueOffsetDays: -1 })).success).toBe(false);
  });

  it("accepts dueOffsetDays = 0 (boundary — same-day due)", () => {
    expect(rulesSchema.safeParse(withRecertification({ dueOffsetDays: 0 })).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Missing required top-level sections
// ---------------------------------------------------------------------------

describe("rulesSchema — missing required sections", () => {
  it("rejects config missing thresholds", () => {
    const { thresholds: _t, ...noThresholds } = valid;
    expect(rulesSchema.safeParse(noThresholds).success).toBe(false);
  });

  it("rejects config missing weights", () => {
    const { weights: _w, ...noWeights } = valid;
    expect(rulesSchema.safeParse(noWeights).success).toBe(false);
  });

  it("rejects config missing manualReview", () => {
    const { manualReview: _m, ...noManualReview } = valid;
    expect(rulesSchema.safeParse(noManualReview).success).toBe(false);
  });

  it("rejects null", () => {
    expect(rulesSchema.safeParse(null).success).toBe(false);
  });

  it("rejects empty object", () => {
    expect(rulesSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sensitiveData — rule entry structure
// ---------------------------------------------------------------------------

describe("rulesSchema — sensitiveData rule entry constraints", () => {
  function withRules(rules: unknown[]) {
    return { ...valid, sensitiveData: { enabledByDefault: false, moduleOverrides: {}, rules } };
  }

  it("rejects a rule with empty id", () => {
    expect(rulesSchema.safeParse(withRules([{ id: "", pattern: "[A-Z]+", replacement: "[M]" }])).success).toBe(false);
  });

  it("rejects a rule with empty pattern", () => {
    expect(rulesSchema.safeParse(withRules([{ id: "x", pattern: "", replacement: "[M]" }])).success).toBe(false);
  });

  it("rejects a rule with empty replacement", () => {
    expect(rulesSchema.safeParse(withRules([{ id: "x", pattern: "[A-Z]+", replacement: "" }])).success).toBe(false);
  });

  it("accepts a rule with no flags (optional)", () => {
    expect(rulesSchema.safeParse(withRules([{ id: "x", pattern: "[A-Z]+", replacement: "[M]" }])).success).toBe(true);
  });
});
