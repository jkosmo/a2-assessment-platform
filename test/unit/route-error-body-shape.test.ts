import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ⚠️ Fjorten ruter skrev feilkroppen for hånd som `{ error, message }` og droppet `details`. Det
// gikk bra til #999 lot domenefeil bære data — da sto plassholderne igjen i grensesnittet.
//
// Sveipen min fant fjorten ved å søke på ÉN skrivemåte. QA-porten fant fem til som bandt `err` i
// stedet for `error`. Denne vakta søker på formen i stedet for navnet, så neste variant fanges av
// en test og ikke av en gjennomlesning.
const ROUTES_DIR = path.resolve(process.cwd(), "src/routes");

describe("feilkroppen skrives ett sted", () => {
  it("ingen rute bygger { error: <x>.code, message: <x>.message } for hånd", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith(".ts")) continue;
        if (entry.name === "respondWithAppError.ts") continue;
        const text = fs.readFileSync(full, "utf8");
        text.split("\n").forEach((line, i) => {
          if (/json\(\{\s*error:\s*\w+\.code,\s*message:\s*\w+\.message\s*\}\)/.test(line)) {
            offenders.push(`${path.relative(process.cwd(), full)}:${i + 1}`);
          }
        });
      }
    };
    walk(ROUTES_DIR);
    expect(offenders, "bruk respondWithAppError — ellers forsvinner `details`").toEqual([]);
  });
});
