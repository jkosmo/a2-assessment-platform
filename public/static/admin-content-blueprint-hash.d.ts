// Declaration for the browser-side blueprint-hash module, used so TS tests can import it.
// The runtime implementation lives in admin-content-blueprint-hash.js.

export function hashBlueprintAsync(blueprint: unknown): Promise<string | null>;

export type DriftState = "no_blueprint" | "no_rubric" | "no_stored_hash" | "in_sync" | "drifted";

export function classifyDriftState(
  currentHash: string | null,
  storedHash: string | null,
  options: { hasBlueprint: boolean; hasRubric: boolean },
): DriftState;
