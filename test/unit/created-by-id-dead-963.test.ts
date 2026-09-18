import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #963: `Module.createdById` og `Class.createdById` var forrige generasjon eierskap. Autorisasjonen
// leser bare ContentOwner (#787). Skrivestoppen kom i 2.66.0; kolonnene ble droppet i 2.71.0
// (`20260918220000_drop_created_by_id_963`), flere releaser senere, så ingen kjørende container
// valgte dem lenger.
//
// ⚠️ Vakta står igjen: INGEN i src skal gjeninnføre navnet. En ny skriver ville gjenopplivet to
// generasjoner side om side — nettopp det som fikk en leser til å tro at `createdById` betydde noe.

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

describe("#963 — createdById er dødt i src fram til kolonnen droppes", () => {
  it("⚠️ ingen kode-linje nevner createdById (kommentarer unntatt)", () => {
    const treff: string[] = [];
    for (const file of walk(SRC)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        if (/\bcreatedById\b/.test(line)) treff.push(`${file.slice(SRC.length + 1)}:${i + 1}: ${t.slice(0, 100)}`);
      });
    }
    expect(treff.join("\n")).toBe("");
  });
});
