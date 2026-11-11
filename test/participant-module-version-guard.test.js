import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #1140 etappe 1 (doc/design/PLAN_1140_E1.md): hvilken versjon av en modul en deltaker får, avgjøres ETT sted.
//   - `CourseModuleRequirement.shownModuleMajor` leses bare av `findShownModuleMajors` (moduleVersioning.ts), og INGEN skriver
//     feltet. Etappe 3 gir det sin ene skriver; da endres denne vakta med vilje.
//   - `findShownModuleMajors` kalles bare fra participantModuleVersion.ts, der regelen bor.
//   - Deltakerflyten henter modulens versjon bare gjennom to steder: moduleService.ts (lista og enkeltoppslaget, som sender
//     svaret gjennom `withShownVersions`) og submissionService.ts (`versionToSubmitOn`). En ny kaller av de rå oppslagene
//     ville gitt deltakeren modulens nyeste uansett hva kurset viser.

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((file) => ({ rel: relative(SRC, file).replace(/\\/g, "/"), text: readFileSync(file, "utf8") }));
const filesWith = (pattern) => files.filter((f) => pattern.test(f.text)).map((f) => f.rel).sort();
const textOf = (rel) => files.find((f) => f.rel === rel).text;
const count = (text, pattern) => [...text.matchAll(pattern)].length;

describe("#1140: vakt for hvilken modulversjon en deltaker får", () => {
  it("bare moduleVersioning.ts leser feltet `shownModuleMajor`, og ingen skriver det", () => {
    // participantModuleVersion.ts bruker radene døra gir (regelen), men spør aldri databasen om feltet selv.
    expect(filesWith(/\bshownModuleMajor\b/)).toEqual(["modules/adminContent/moduleVersioning.ts", "modules/module/participantModuleVersion.ts"]);
    expect(textOf("modules/module/participantModuleVersion.ts")).not.toMatch(/courseModuleRequirement\s*\./);
    const text = textOf("modules/adminContent/moduleVersioning.ts");
    // KONTROLL: vakta finner leseren.
    expect(text).toMatch(/shownModuleMajor: \{ not: null \}/);
    // Skrivingene av kravet i fila (createMany, updateMany) nevner ikke feltet.
    for (const write of text.matchAll(/courseModuleRequirement\s*\.\s*(create|createMany|update|updateMany|upsert)\(([\s\S]*?)\);/g)) {
      expect(write[2], `skriver shownModuleMajor: ${write[0].slice(0, 120)}`).not.toMatch(/shownModuleMajor/);
    }
    expect(count(text, /courseModuleRequirement\s*\.\s*(create|createMany|update|updateMany|upsert)\(/g), "kontroll: vakta ser skrivingene").toBeGreaterThanOrEqual(3);
  });

  it("bare participantModuleVersion.ts spør etter låsene", () => {
    expect(filesWith(/\bfindShownModuleMajors\(/)).toEqual(["modules/adminContent/moduleVersioning.ts", "modules/module/participantModuleVersion.ts"]);
  });

  it("modullista og enkeltoppslaget går gjennom `withShownVersions`", () => {
    // De rå oppslagene har én kaller hver, i moduleService.ts.
    expect(filesWith(/\bqueryModules\(/)).toEqual(["modules/module/moduleService.ts", "repositories/moduleRepository.ts"]);
    expect(filesWith(/\bqueryModuleById\(/)).toEqual(["modules/module/moduleService.ts", "repositories/moduleRepository.ts"]);
    const service = textOf("modules/module/moduleService.ts");
    expect(count(service, /\bqueryModules\(/g)).toBe(1);
    expect(count(service, /\bqueryModuleById\(/g)).toBe(1);
    // Og hvert av dem sendes videre gjennom funksjonen.
    expect(service).toMatch(/const published = await queryModules\([^)]*\);\s*const modules = reader \? await withShownVersions\(published, reader, options\.courseId\) : published;/);
    expect(service).toMatch(/const found = await queryModuleById\([^)]*\);[\s\S]{0,200}?const module = reader \? \(await withShownVersions\(\[found\], reader, options\.courseId\)\)\[0\]! : found;/);
  });

  it("deltakersiden henter modullista ETT sted, sammen med kurset den gjelder", () => {
    // En henting utenom `loadModulesForCourse` ville byttet lista uten å si hvilket kurs den gjelder, og innleveringen ville
    // sendt en versjon og et kurs som ikke hører sammen (QA-porten 2.154.0).
    const client = readFileSync(fileURLToPath(new URL("../public/participant.js", import.meta.url)), "utf8");
    expect(count(client, /apiFetch\(\s*modulesListUrl\(/g)).toBe(1);
    expect(count(client, /["'`]\/api\/modules\?includeCompleted=true/g), "adressen bygges bare i modulesListUrl").toBe(1);
    const loader = client.slice(client.indexOf("async function loadModulesForCourse("), client.indexOf("async function enterModuleCourseContext("));
    expect(loader).toMatch(/apiFetch\(modulesListUrl\(courseId\)/);
    // Lista og kurset settes sammen, etter at svaret er kommet, og bare for den siste hentingen.
    expect(loader).toMatch(/if \(request !== moduleListFetchSeq\) return \{ applied: false, body \};\s*loadedModules = [^;]+;\s*moduleContextCourseId = courseId \|\| null;/);
    // `moduleContextCourseId` og `loadedModules` (utenom forhåndsvisningen) settes ingen andre steder.
    expect(count(client, /\bmoduleContextCourseId\s*=[^=]/g)).toBe(2); // deklarasjonen og loadModulesForCourse
    expect(client).toMatch(/\.\.\.\(seenInCourseId \? \{ courseId: seenInCourseId \} : \{\}\)/);
  });

  it("innleveringen henter modulen ett sted, og det stedet spør regelen", () => {
    expect(filesWith(/\bgetModuleWithActiveVersion\(/)).toEqual(["modules/submission/submissionRepository.ts", "modules/submission/submissionService.ts"]);
    const service = textOf("modules/submission/submissionService.ts");
    expect(count(service, /\bgetModuleWithActiveVersion\(/g)).toBe(1);
    const fn = service.slice(service.indexOf("async function versionToSubmitOn("), service.indexOf("async function createSubmissionCommand("));
    expect(fn).toMatch(/getModuleWithActiveVersion\(/);
    expect(fn).toMatch(/findVersionToSubmitOn\(/);
    // Begge stedene som avgjør versjonen (forhåndssjekken og under låsene) bruker den.
    expect(count(service, /\bawait versionToSubmitOn\(/g)).toBe(2);
    // Kurset modulen ble åpnet fra, følger med fra ruta til regelen: i lista, i enkeltoppslagene og i innleveringen.
    expect(service).toMatch(/prepareShownMajorScope\(\s*\{[^}]*\},\s*input\.moduleId,\s*input\.courseId,?\s*\)/);
    expect(count(textOf("routes/modules.ts"), /courseId: openedCourseId\(request\.query\)/g)).toBe(3);
    expect(textOf("routes/submissions.ts")).toMatch(/courseId: z\.string\(\)/);
    // Innleveringen skrives på versjonen regelen ga, ikke på modulens aktive.
    expect(service).toMatch(/moduleVersionId: target\.versionId/);
    expect(service).not.toMatch(/moduleVersionId: module\.activeVersion\.id/);
  });
});
