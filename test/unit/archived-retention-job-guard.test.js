import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #1152 skive 4c (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Jobben»: «Jobben har ingen egne sletteregler»): slettejobben
// vet bare NÅR, aldri OM. Alt som sletter, går gjennom de tre indre slettefunksjonene «Slett» også bruker, med vaktene deres.
//
// Vakta leser kilden. En `delete`/`deleteMany`/`$executeRaw` i jobbfila ville vært en sletting forbi vaktene; en `deleteCourseInTx`
// som mangler, ville vært en jobb som ikke sletter det den skal.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = fs.readFileSync(path.join(root, "src", "modules", "content", "archivedRetentionJob.ts"), "utf8");
const code = source
  .split("\n")
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
  .join("\n");

describe("#1152 4c: slettejobben har ingen egen sletting", () => {
  it("ingen skriving mot en tabell, og ingen raw SQL, i jobbfila", () => {
    // `<klient>.<tabell>.<skriving>(`: tx.course.delete, reader.module.deleteMany, prisma.x.update … (`keptTonight.delete` er et Map i
    // minnet og har bare ett ledd, så det treffes ikke).
    expect(code).not.toMatch(/\b\w+\.\w+\.(delete|deleteMany|update|updateMany|upsert|create|createMany)\s*\(/);
    expect(code).not.toMatch(/\$executeRaw|\$queryRaw/);
  });

  it("slettingen går gjennom de tre indre slettefunksjonene, med source «retention»", () => {
    expect(code).toContain('deleteCourseInTx(tx, id, { source: "retention", now })');
    expect(code).toContain('deleteModuleInTx(tx, id, { source: "retention" })');
    expect(code).toContain('deleteSectionInTx(tx, id, { source: "retention" })');
  });

  it("forhåndssjekken er den samme som «Slett» og lista bruker", () => {
    for (const call of ["checkCourseDelete(id, reader, { now })", "checkModuleDelete(id, reader)", "checkSectionDelete(id, reader)"]) {
      expect(code).toContain(call);
    }
  });
});
