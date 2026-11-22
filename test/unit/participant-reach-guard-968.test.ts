import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isReachableParticipant } from "../../src/modules/user/participantReach.js";

// #968: regelen «aktiv og ikke anonymisert» sto på fire steder og ble håndhevet på tre. Vakta
// nekter en femte kopi: `activeStatus` og `isAnonymized` i samme betingelse hører hjemme i
// `isReachableParticipant`, ikke inline. (Prisma-`where`-objekter med begge feltene er lovlige —
// de er spørringer, ikke regelen — og telles ikke: de har `:` etter feltnavnet.)

describe("#968 — isReachableParticipant", () => {
  it("aktiv og ikke anonymisert er den eneste kombinasjonen som når fram", () => {
    expect(isReachableParticipant({ activeStatus: true, isAnonymized: false })).toBe(true);
    expect(isReachableParticipant({ activeStatus: false, isAnonymized: false })).toBe(false);
    expect(isReachableParticipant({ activeStatus: true, isAnonymized: true })).toBe(false);
  });
});

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

const inlineRule = (line: string) => /\.activeStatus\b/.test(line) && /\.isAnonymized\b/.test(line);
describe("#968 — vakt: ingen inline kopi av regelen", () => {
  // Testgjennomgangen 2026-11 (avsnitt 5.3): kontrollen. Får feltene nye navn, treffer mønsteret ingenting, og vakta under
  // er grønn uten å se. Hjelperen selv skriver regelen på én linje, så der skal mønsteret treffe.
  it("kontroll: mønsteret treffer regelen i hjelperen selv", () => {
    const helper = readFileSync(join(SRC, "modules", "user", "participantReach.ts"), "utf8");
    expect(helper.split("\n").filter((line) => !line.trim().startsWith("//") && inlineRule(line)).length).toBeGreaterThan(0);
  });

  it("⚠️ `.activeStatus` og `.isAnonymized` i samme uttrykk finnes bare i hjelperen", () => {
    const treff: string[] = [];
    for (const file of walk(SRC)) {
      if (file.endsWith("participantReach.ts")) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*")) return;
        if (inlineRule(line)) treff.push(`${file.slice(SRC.length + 1)}:${i + 1}: ${t.slice(0, 110)}`);
      });
    }
    expect(treff.join("\n"), "bruk isReachableParticipant(user)").toBe("");
  });
});
