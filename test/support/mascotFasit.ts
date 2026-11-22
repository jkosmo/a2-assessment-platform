import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Maskotpakken, steg 0 (doc/design/MASKOTPAKKE.md): fasiten er laget av koden slik den var FØR seilbåten ble flyttet
// inn i pakken (3d39e88b). Flyttingen skal ikke endre noe brukerne ser, så fasiten skal stå uendret etterpå.
//
// ⚠️ En fasitfil som endres, er en feil i flyttingen, ikke i fasiten. Fasiten lages på nytt bare når noe brukerne ser
// skal endres med vilje: MASCOT_FASIT_UPDATE=1 skriver filene i stedet for å sammenligne.

export const FASIT_DIR = path.resolve(process.cwd(), "test", "fixtures", "mascot-fasit");

export const updatingFasit = process.env.MASCOT_FASIT_UPDATE === "1";

export function sha256(bytes: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Skriver fasiten (MASCOT_FASIT_UPDATE=1), eller leser den som er lagret. */
export function fasit<T>(name: string, actual: T): T {
  const file = path.join(FASIT_DIR, name);
  if (updatingFasit) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    return actual;
  }
  if (!existsSync(file)) throw new Error(`Fasiten ${name} mangler. Lag den med MASCOT_FASIT_UPDATE=1 fra koden før flyttingen.`);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/** Leser fasiten, aldri skriver den: for testene av et bytte (testpakken), som sammenligner med seilbåtens fasit. */
export function readFasit<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(FASIT_DIR, name), "utf8")) as T;
}

/** Rota til testpakken (testbat), som aldri kan velges i drift: den ligger ikke i mascots/. */
export const SWAP_ROOT = path.resolve(process.cwd(), "test", "fixtures", "mascot-swap");

/**
 * Bytter tekst i alle strenger i `value`, lengste først (så en kort tekst aldri treffer inne i en lengre). Testene av
 * et bytte gjør testpakkens tekster og filnavn om til seilbåtens, og sammenligner så med fasiten: det som er likt
 * etterpå, er alt som ikke kom fra pakken.
 */
export function replaceStrings<T>(value: T, pairs: Array<[string, string]>): T {
  const sorted = [...pairs].sort(([a], [b]) => b.length - a.length);
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      let text = node;
      for (const [from, to] of sorted) text = text.split(from).join(to);
      return text;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, child]) => [walk(key) as string, walk(child)]));
    return node;
  };
  return walk(value) as T;
}
