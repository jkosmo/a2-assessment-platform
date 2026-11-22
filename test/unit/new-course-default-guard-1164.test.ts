import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #1164 (produkteier 14.11.2026): «Nye kurs bør ikke være åpent for alle.» Regelen bor i ÉN funksjon, `createCourse`
// (courseCommands.ts), som setter `NEW_COURSE_ENROLLMENT_POLICY` når kalleren ikke sier noe. Skjemaets standardverdi
// (`@default(OPEN)`) er latt stå, så en ny vei som oppretter kurs utenom `createCourse`, ville stille fått et ÅPENT kurs.
//
// Dekningsvakt, ikke en liste over kjente veier: testen leter i hele `src/` etter kode som oppretter en kursrad, og krever at
// den eneste er i `createCourse`. En ny vei (duplisering, en ny import) må gå gjennom den, eller føres opp her med en grunn.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcDir = path.join(root, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|js|mts)$/.test(name) ? [full] : [];
  });
}

// `.course.create(`, `.course.createMany(`, `.course.upsert(` og rå SQL `INSERT INTO "Course"` — men ikke `courseItem`,
// `courseSection` osv. (ordgrensen etter `course`).
const CREATES_COURSE = /\.course\.(create|createMany|createManyAndReturn|upsert)\s*\(|INSERT\s+INTO\s+"Course"\s/;

describe("#1164: nye kurs opprettes bare gjennom createCourse", () => {
  it("den eneste koden i src/ som oppretter en kursrad, er createCourse", () => {
    const hits: string[] = [];
    for (const file of walk(srcDir)) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (CREATES_COURSE.test(line)) hits.push(`${path.relative(root, file).replaceAll("\\", "/")}:${index + 1}`);
      });
    }
    // Kontrollcase: finner mønsteret ikke createCourse selv, måler vakta ingenting.
    expect(hits.length, "fant ikke createCourse — mønsteret måler ingenting").toBeGreaterThan(0);
    expect(hits.every((hit) => hit.startsWith("src/modules/course/courseCommands.ts:")), hits.join("\n")).toBe(true);
    expect(hits).toHaveLength(1);
  });

  it("createCourse setter standardverdien når kalleren ikke sier noe, og den er RESTRICTED", () => {
    const source = readFileSync(path.join(srcDir, "modules/course/courseCommands.ts"), "utf8");
    expect(source).toMatch(/export const NEW_COURSE_ENROLLMENT_POLICY = "RESTRICTED" as const;/);
    expect(source).toMatch(/enrollmentPolicy: input\.enrollmentPolicy \?\? NEW_COURSE_ENROLLMENT_POLICY,/);
  });
});
