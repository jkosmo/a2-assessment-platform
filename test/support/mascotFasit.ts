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
