// #928: er oppgaveteksten VESENTLIG endret siden kriteriene ble laget?
//
// Ordlikhet (Jaccard) mellom forrige og ny versjons tekster: ordene som mengder, små bokstaver,
// tegnsetting borte. En rettet skrivefeil i en tekst på tjue ord gir rundt 0,9 og er stille; et
// omskrevet scenario gir 0,4–0,7 og spør. Planen kriteriene ble laget fra (blueprint-hashen) er
// ikke målet: forfatteren endrer teksten, ikke planen.
//
// ⚠️ Grensen er et utgangspunkt fra designnotatet (doc/DESIGN_928.md). Juster den etter ekte
// lagringer på stage, ikke etter hva som virker rimelig.

export const TEXT_DRIFT_THRESHOLD = 0.85;

function words(text) {
  return new Set(
    String(text ?? "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

/** Likheten mellom to tekster, 0–1. To tomme tekster er like. */
export function textDriftScore(previous, next) {
  const a = words(previous);
  const b = words(next);
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Vesentlig endret: det fantes en tekst før, og likheten er under grensen. */
export function isSubstantialTextChange(previous, next, threshold = TEXT_DRIFT_THRESHOLD) {
  if (!String(previous ?? "").trim()) return false;
  return textDriftScore(previous, next) < threshold;
}
