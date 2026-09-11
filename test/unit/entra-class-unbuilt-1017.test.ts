import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #1017: ENTRA-klasser er halvbygde. Kommentarene i koden sier nå at grenene er vakter, ikke
// funksjon. Denne testen holder påstanden sann: den dagen noen lar `createClass` ta imot en annen
// `kind` enn MANUAL, skal kommentarene (og #678) oppdateres — ikke bli stående som en ny løgn.
const les = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("#1017 — ingen kode kan opprette en ENTRA-klasse", () => {
  it("⚠️ createClass i repositoryet hardkoder MANUAL, og skjemaet tar ikke kind", () => {
    const repo = les("../../src/modules/course/classRepository.ts");
    const createBlock = repo.slice(repo.indexOf("createClass(input: CreateClassInput)"), repo.indexOf("select:", repo.indexOf("createClass(input: CreateClassInput)")));
    expect(createBlock).toContain('kind: "MANUAL"');
    expect(createBlock).not.toMatch(/kind:\s*input/);
    const schema = les("../../src/routes/adminClasses.ts");
    const createSchema = schema.slice(schema.indexOf("createClassSchema"), schema.indexOf("})", schema.indexOf("createClassSchema")));
    expect(createSchema, "createClassSchema tar bare navn og beskrivelse").not.toContain("kind");
    expect(createSchema).not.toContain("entraGroupId");
  });

  it("de fire grenene bærer merket, så neste leser slipper runden", () => {
    for (const f of ["classConfig.ts", "classService.ts", "cohortStatusService.ts", "courseReminderService.ts"]) {
      expect(les(`../../src/modules/course/${f}`), f).toContain("#1017");
    }
  });
});
