// B3 (#450): browser-side blueprint hash, mirrors src/modules/adminContent/blueprintHash.ts.
// MUST produce the same hex output as the backend for the same blueprint object — otherwise
// every render would show false drift. The canonicalize algorithm and hex truncation length
// (16 chars) are the contract.
//
// `hashBlueprintAsync(blueprint)` resolves to a 16-hex-char string or null when blueprint is
// missing or empty. Uses SubtleCrypto (available in all modern browsers; admin pages run
// behind authentication so HTTPS is guaranteed → SubtleCrypto is defined).

function canonicalize(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  return "null";
}

export async function hashBlueprintAsync(blueprint) {
  if (blueprint == null) return null;
  if (typeof blueprint === "object" && !Array.isArray(blueprint) && Object.keys(blueprint).length === 0) {
    return null;
  }
  const canonical = canonicalize(blueprint);
  if (canonical === "null") return null;

  const enc = new TextEncoder();
  const bytes = enc.encode(canonical);
  const digestBuf = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digestBuf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// B3 (#450): pure helper — decides whether a drift banner should appear for a given pair.
// Returns one of:
//   - "no_blueprint":     no blueprint exists; never show banner
//   - "no_rubric":        no rubric exists; never show banner
//   - "no_stored_hash":   rubric pre-dates B3 (no hash recorded); never show banner (false drift)
//   - "in_sync":          stored hash matches current hash; never show banner
//   - "drifted":          stored hash differs from current hash; show banner
export function classifyDriftState(currentHash, storedHash, { hasBlueprint, hasRubric }) {
  if (!hasBlueprint) return "no_blueprint";
  if (!hasRubric) return "no_rubric";
  if (!storedHash) return "no_stored_hash";
  if (!currentHash) return "no_blueprint";
  return currentHash === storedHash ? "in_sync" : "drifted";
}
