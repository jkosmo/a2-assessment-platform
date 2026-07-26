import { describe, it, expect } from "vitest";
import { buildContentSimilarityReport } from "../../src/modules/calibration/calibrationWorkspaceService.js";
import type { AiInfluenceContentRules } from "../../src/modules/assessment/aiInfluence.js";

// #475: the calibration report aggregates persisted aiInfluenceJson into a similarity distribution.
const RULES: AiInfluenceContentRules = { enabled: true, shadowMode: true, similarityThreshold: 0.82 };

function persisted(declaration: string | null, similarity: number | null) {
  return JSON.stringify({
    declaration,
    declarationForcesReview: false,
    contentSimilarity: similarity == null ? null : { similarity, threshold: 0.82, exceeded: similarity >= 0.82, forcesReview: false },
    forcesReview: false,
  });
}

describe("buildContentSimilarityReport", () => {
  it("returns an empty distribution when nothing has a similarity score", () => {
    const r = buildContentSimilarityReport([null, "not json", persisted("none", null)], RULES);
    expect(r.count).toBe(0);
    expect(r.median).toBeNull();
    expect(r.overThresholdCount).toBe(0);
    expect(r.bins).toHaveLength(20);
    expect(r.byDeclaration).toEqual([]);
    expect(r.enabled).toBe(true);
    expect(r.shadowMode).toBe(true);
    expect(r.threshold).toBe(0.82);
  });

  it("aggregates similarity into count/median/p90 and counts over-threshold", () => {
    const r = buildContentSimilarityReport(
      [
        persisted("none", 0.40),
        persisted("none", 0.50),
        persisted("none", 0.60),
        persisted("autonomous", 0.90), // over threshold
        persisted("improve", 0.84), // over threshold
      ],
      RULES,
    );
    expect(r.count).toBe(5);
    expect(r.median).toBe(0.6); // sorted [.4,.5,.6,.84,.9] → idx floor(0.5*5)=2 → .6
    expect(r.overThresholdCount).toBe(2);
    expect(r.p90).toBe(0.9);
  });

  it("buckets into the right histogram bin (20 bins over 0–1) by declaration", () => {
    const r = buildContentSimilarityReport([persisted("autonomous", 0.71)], RULES);
    // 0.71 → bin index floor(0.71*20)=14
    expect(r.bins[14].byDeclaration).toEqual({ autonomous: 1 });
    expect(r.count).toBe(1);
  });

  it("produces per-declaration rows in declaration order with correct stats", () => {
    const r = buildContentSimilarityReport(
      [persisted("autonomous", 0.90), persisted("none", 0.40), persisted("none", 0.60), persisted(null, 0.55)],
      RULES,
    );
    const decls = r.byDeclaration.map((d) => d.declaration);
    expect(decls).toEqual(["none", "autonomous", "undeclared"]); // fixed display order, only present ones
    const none = r.byDeclaration.find((d) => d.declaration === "none")!;
    expect(none.count).toBe(2);
    expect(none.max).toBe(0.6);
    const auto = r.byDeclaration.find((d) => d.declaration === "autonomous")!;
    expect(auto.overThresholdCount).toBe(1);
  });
});
