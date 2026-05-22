import { describe, it, expect } from "vitest";
import { hashBlueprint } from "../../src/modules/adminContent/blueprintHash.js";

describe("blueprintHash", () => {
  it("returns null for null and undefined", () => {
    expect(hashBlueprint(null)).toBeNull();
    expect(hashBlueprint(undefined)).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(hashBlueprint({})).toBeNull();
  });

  it("returns a 16-char hex string for a non-empty object", () => {
    const hash = hashBlueprint({ objectives: ["a", "b"] });
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic across calls", () => {
    const blueprint = { objectives: ["analyse", "evaluate"], keyTopics: ["x", "y"] };
    expect(hashBlueprint(blueprint)).toBe(hashBlueprint(blueprint));
  });

  it("ignores key order", () => {
    const a = { objectives: ["x"], keyTopics: ["y"] };
    const b = { keyTopics: ["y"], objectives: ["x"] };
    expect(hashBlueprint(a)).toBe(hashBlueprint(b));
  });

  it("ignores nested key order", () => {
    const a = { outer: { foo: 1, bar: 2 } };
    const b = { outer: { bar: 2, foo: 1 } };
    expect(hashBlueprint(a)).toBe(hashBlueprint(b));
  });

  it("differs when content differs", () => {
    const a = { objectives: ["a", "b"] };
    const b = { objectives: ["a", "c"] };
    expect(hashBlueprint(a)).not.toBe(hashBlueprint(b));
  });

  it("differs when array order differs", () => {
    // Array order matters in a blueprint — ["a", "b"] is a different plan than ["b", "a"].
    const a = { objectives: ["a", "b"] };
    const b = { objectives: ["b", "a"] };
    expect(hashBlueprint(a)).not.toBe(hashBlueprint(b));
  });
});
