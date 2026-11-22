import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT (#934 skive 3): kursets versjon endres på ÉTT sted.
//
// Produkteier 2026-11-02: «alle veier inn til publisering og versjonering skal dele kode, ikke duplisere
// logikk». `applyCourseVersionChange` i `courseVersioning.ts` eier sjekken av kursbevis, regelen for
// manglende svar (`course_version_required`), låsen, øyeblikksbildet og økningen. QA-porten fant i fire
// runder veier inn som gikk utenom: lagringen, «Publiser nye versjoner», importen, «Publiser kurs».
//
// En ny vei som skriver `versionMajor`/`versionMinor` på et kurs, eller rader i `CourseVersion`, direkte —
// i én linje, uten å røre den delte funksjonen — ville gjenskape nøyaktig det. Vakta gjør det umulig i
// stillhet. Kursbevisets versjon (`CourseCompletion`) er en annen tabell og telles ikke her.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const OWNER = "modules/course/courseVersioning.ts";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Argumentteksten til hvert kall som matcher `pattern` (balanserte parenteser). */
function callArguments(text, pattern) {
  const found = [];
  for (const match of text.matchAll(pattern)) {
    let depth = 0;
    let i = match.index + match[0].length - 1; // står på «(»
    const start = i;
    for (; i < text.length; i += 1) {
      if (text[i] === "(") depth += 1;
      else if (text[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push({ index: match.index, args: text.slice(start, i + 1) });
  }
  return found;
}

function relative(file) {
  return file.slice(SRC.length + 1).split("\\").join("/");
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/** Skrivinger av kursets versjon og av CourseVersion-rader, utenfor eieren. */
function violations() {
  const out = [];
  for (const file of walk(SRC)) {
    const rel = relative(file);
    if (rel === OWNER) continue;
    const text = readFileSync(file, "utf8");
    for (const call of callArguments(text, /\.course\s*\.\s*(update|updateMany|upsert|create|createMany)\s*\(/g)) {
      if (/\bversion(Major|Minor)\b/.test(call.args)) out.push(`${rel}:${lineOf(text, call.index)} skriver Course.versionMajor/Minor`);
    }
    for (const call of callArguments(text, /\.courseVersion\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g)) {
      out.push(`${rel}:${lineOf(text, call.index)} skriver CourseVersion`);
    }
    // #934 skive 4b: e-postradene for en ny hovedversjon lages bare der hovedversjonen lages — i samme transaksjon,
    // med innholdslåsen. En annen vei som lager dem, kunne sende e-post om en versjon som ikke finnes, eller uten
    // 200-regelen. (Jobben og behandleren endrer bare status: `update`/`updateMany`.)
    for (const call of callArguments(text, /\.courseVersionNotice\s*\.\s*(create|createMany|createManyAndReturn|upsert)\s*\(/g)) {
      out.push(`${rel}:${lineOf(text, call.index)} lager CourseVersionNotice-rader`);
    }
    for (const call of callArguments(text, /\$executeRaw(Unsafe)?\s*[`(]/g)) {
      if (/"?(versionMajor|versionMinor|CourseVersion)"?/.test(call.args)) out.push(`${rel}:${lineOf(text, call.index)} skriver versjon med rå SQL`);
    }
  }
  return out;
}

describe("#934: kursets versjon endres bare gjennom applyCourseVersionChange", () => {
  it("ingen skriver versionMajor/versionMinor på et kurs, CourseVersion-rader eller lager e-postrader (CourseVersionNotice), utenfor courseVersioning.ts", () => {
    expect(violations(), "Ny vei inn til kursets versjon. Kall applyCourseVersionChange (eller applyMinorVersionToCoursesContaining) i stedet.").toEqual([]);
  });

  it("KONTROLLCASE: eieren skriver faktisk versjonen — ellers måler vakta ingenting", () => {
    const text = readFileSync(join(SRC, OWNER), "utf8");
    const writes = callArguments(text, /\.course\s*\.\s*update\s*\(/g).filter((call) => /\bversion(Major|Minor)\b/.test(call.args));
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(callArguments(text, /\.courseVersion\s*\.\s*(create|upsert)\s*\(/g).length).toBeGreaterThanOrEqual(2);
    // #934 skive 4b: og e-postradene.
    expect(callArguments(text, /\.courseVersionNotice\s*\.\s*createMany\s*\(/g)).toHaveLength(1);
  });

  it("KONTROLLCASE: mønsteret fanger en skriving over flere linjer", () => {
    const sample = "await tx.course\n  .update({ where: { id }, data: { versionMinor: 2 } });";
    const calls = callArguments(sample, /\.course\s*\.\s*(update|updateMany|upsert|create|createMany)\s*\(/g);
    expect(calls).toHaveLength(1);
    expect(/\bversion(Major|Minor)\b/.test(calls[0].args)).toBe(true);
  });
});
