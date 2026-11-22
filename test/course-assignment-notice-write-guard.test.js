import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// VAKT (#1142 skive 1): `CourseAssignmentNotice` skrives bare i `courseAssignmentNotice.ts`.
//
// Raden betyr «denne personen er varslet, eller skal varsles, om dette kurset», og finnes den, kommer det aldri en ny
// e-post om samme kurs (doc/design/PLAN_1142.md, punkt 2 og 3). Radene lages av jobben fra regelen
// `eligibleAssignmentPairs`, og slettes bare av sjekken rett før sending, alltid betinget på status. En annen vei som
// lager en rad, ville stille ut e-posten for godt; en annen vei som sletter en, kunne gitt samme e-post to ganger. Begge
// deler i én linje, uten å røre fila som eier regelen.
//
// Migreringene (prisma/migrations) skriver tabellen også (baseline i skive 3); de er SQL-filer og leses ikke her.
// Skriptet for prod → stage-kopi (scripts/maintenance/stage-copy-neutralize-email.ts, skive 3) kaller
// `neutralizeEmailStateAfterProdCopy` i eierfila og skriver ikke tabellen selv, så `ALLOWED` er fortsatt tom. En ny
// skriver utenfor eierfila skal inn der, med begrunnelse.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCANNED = ["src", "scripts", "prisma"];
const OWNER = "src/modules/course/courseAssignmentNotice.ts";
/** Filer utenom eieren som får skrive tabellen, med grunnen. Tom: jobben, behandleren og stage-kopien bor i eierfila. */
const ALLOWED = new Map([]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "migrations") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|js|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

function relative(file) {
  return file.slice(ROOT.length).split("\\").join("/").replace(/^\//, "");
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

const PRISMA_WRITE = /\.courseAssignmentNotice\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\s*\(/g;
const SQL_WRITE = /(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(\s+TABLE)?)\s+"CourseAssignmentNotice"/gi;
// Skrivinger gjennom relasjonen fra User eller Course (`user.update({ data: { courseAssignmentNotices: { create … } } })`).
const NESTED_WRITE = /\b(courseAssignmentNotices|assignmentNotices)\s*:\s*\{\s*(create|createMany|connectOrCreate|upsert|update|updateMany|delete|deleteMany|set)\b/g;

/** Hver skriving av tabellen i `text`, som «fil:linje hva». */
function writesIn(rel, text) {
  const out = [];
  for (const match of text.matchAll(PRISMA_WRITE)) out.push(`${rel}:${lineOf(text, match.index)} ${match[1]} med Prisma`);
  for (const match of text.matchAll(SQL_WRITE)) out.push(`${rel}:${lineOf(text, match.index)} ${match[1].toUpperCase()} med SQL`);
  for (const match of text.matchAll(NESTED_WRITE)) out.push(`${rel}:${lineOf(text, match.index)} ${match[2]} gjennom relasjonen`);
  return out;
}

function violations() {
  const out = [];
  for (const dir of SCANNED) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(file);
      if (rel === OWNER || ALLOWED.has(rel)) continue;
      out.push(...writesIn(rel, readFileSync(file, "utf8")));
    }
  }
  return out;
}

describe("#1142: CourseAssignmentNotice skrives bare i courseAssignmentNotice.ts", () => {
  it("ingen andre filer i src/, scripts/ eller prisma/ lager, endrer eller sletter rader i CourseAssignmentNotice", () => {
    expect(violations(), "Ny skriver av CourseAssignmentNotice. Legg skrivingen i src/modules/course/courseAssignmentNotice.ts, som eier regelen.").toEqual([]);
  });

  it("KONTROLLCASE: eierfila finnes og har regelen — ellers vokter vakta en fil som er flyttet", () => {
    expect(existsSync(join(ROOT, OWNER))).toBe(true);
    expect(readFileSync(join(ROOT, OWNER), "utf8")).toMatch(/export async function eligibleAssignmentPairs\(/);
  });

  it("KONTROLLCASE: mønstrene fanger Prisma over flere linjer, rå SQL i begge skrivemåter og skriving gjennom relasjonen", () => {
    const sample = [
      "await tx.courseAssignmentNotice",
      "  .deleteMany({ where: { userId } });",
      "await prisma.$executeRaw`INSERT INTO \"CourseAssignmentNotice\" (id) VALUES (1)`;",
      "await prisma.$executeRawUnsafe('update \"CourseAssignmentNotice\" SET status = 1');",
      "await prisma.user.update({ where: { id }, data: { courseAssignmentNotices: { create: [] } } });",
    ].join("\n");
    expect(writesIn("x.ts", sample)).toEqual([
      "x.ts:1 deleteMany med Prisma",
      "x.ts:3 INSERT INTO med SQL",
      "x.ts:4 UPDATE med SQL",
      "x.ts:5 create gjennom relasjonen",
    ]);
  });

  it("KONTROLLCASE: lesing teller ikke", () => {
    const sample = "await prisma.courseAssignmentNotice.findMany({ where: { status: \"waiting\" } });\nSELECT * FROM \"CourseAssignmentNotice\"";
    expect(writesIn("x.ts", sample)).toEqual([]);
  });
});
