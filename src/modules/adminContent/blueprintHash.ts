import { createHash } from "crypto";

// B3 (#450): deterministic short hash of a blueprint object, used to detect drift
// between "blueprint at the time the rubric was generated" and "blueprint now".
//
// Algorithm:
//  - Sort keys recursively so {a, b} and {b, a} hash identically.
//  - Stringify with no whitespace.
//  - SHA-256, return the first 16 hex chars (collision risk is negligible at this
//    scale — single rubric/module, not a content-addressed store).
//
// Returns null when blueprint is missing/empty so callers can short-circuit.
export function hashBlueprint(blueprint: unknown): string | null {
  if (blueprint == null) return null;
  if (typeof blueprint === "object" && !Array.isArray(blueprint) && Object.keys(blueprint as object).length === 0) {
    return null;
  }
  const canonical = canonicalize(blueprint);
  if (canonical === "null") return null;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
  }
  return "null";
}
