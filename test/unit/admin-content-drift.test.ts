import { describe, it, expect } from "vitest";
import { hashBlueprintAsync, classifyDriftState } from "../../public/static/admin-content-blueprint-hash.js";
import { hashBlueprint } from "../../src/modules/adminContent/blueprintHash.js";

describe("hashBlueprintAsync", () => {
  it("returns null for null and empty", async () => {
    expect(await hashBlueprintAsync(null)).toBeNull();
    expect(await hashBlueprintAsync(undefined)).toBeNull();
    expect(await hashBlueprintAsync({})).toBeNull();
  });

  it("produces a 16-char hex string", async () => {
    const hash = await hashBlueprintAsync({ objectives: ["a"] });
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic", async () => {
    const blueprint = { objectives: ["a"], keyTopics: ["x"] };
    expect(await hashBlueprintAsync(blueprint)).toBe(await hashBlueprintAsync(blueprint));
  });

  it("ignores key order", async () => {
    const a = { objectives: ["a"], keyTopics: ["x"] };
    const b = { keyTopics: ["x"], objectives: ["a"] };
    expect(await hashBlueprintAsync(a)).toBe(await hashBlueprintAsync(b));
  });

  // B3 (#450) load-bearing contract: backend and frontend MUST produce identical hashes for
  // the same blueprint. Otherwise every render would show false drift.
  it("matches the backend hashBlueprint exactly", async () => {
    const blueprints = [
      { objectives: ["a", "b"] },
      { keyTopics: ["x"], objectives: ["analyse"] },
      { nested: { foo: 1, arr: [1, 2, 3] } },
      { unicode: "ÆØÅ — résumé" },
    ];
    for (const bp of blueprints) {
      expect(await hashBlueprintAsync(bp)).toBe(hashBlueprint(bp));
    }
  });
});

describe("classifyDriftState", () => {
  it("returns no_blueprint when no blueprint", () => {
    expect(classifyDriftState("aaa", "bbb", { hasBlueprint: false, hasRubric: true })).toBe("no_blueprint");
  });

  it("returns no_rubric when no rubric exists", () => {
    expect(classifyDriftState("aaa", "bbb", { hasBlueprint: true, hasRubric: false })).toBe("no_rubric");
  });

  it("returns no_stored_hash for pre-B3 rubrics (no hash recorded yet)", () => {
    expect(classifyDriftState("aaa", null, { hasBlueprint: true, hasRubric: true })).toBe("no_stored_hash");
  });

  it("returns in_sync when hashes match", () => {
    expect(classifyDriftState("aaa", "aaa", { hasBlueprint: true, hasRubric: true })).toBe("in_sync");
  });

  it("returns drifted when hashes differ", () => {
    expect(classifyDriftState("aaa", "bbb", { hasBlueprint: true, hasRubric: true })).toBe("drifted");
  });

  it("never shows banner when current hash is missing but blueprint exists (pathological)", () => {
    // currentHash should normally be computed before classify is called; this branch is the
    // safety guard for "we haven't computed it yet" — treat as no_blueprint to avoid false drift.
    expect(classifyDriftState(null, "bbb", { hasBlueprint: true, hasRubric: true })).toBe("no_blueprint");
  });
});
