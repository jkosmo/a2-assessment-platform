import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkObjectiveMap, formatObjectiveMap } from "../../skills/a2-authoring-api/scripts/objective-map-check.mjs";

// #1125: hvert spørsmål kobles til et læringsmål og til en seksjon som kommer FØR testen; hvert mål
// testes. Koblingen bor i skillets kurstilstand — plattformens import har ikke noe felt for den, og
// forfatteren godkjente målene og planen. Her: den rene kontrollen og planskriptet (uten pakke).
// Gjennom produce-course: agent-authoring-produce-course-1079.test.ts og skill-adjust-course-1095.test.ts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- testene endrer tilstanden fritt, også til ugyldige former
function kurs(): any {
  return {
    primaryLanguage: "nb",
    learningObjectives: [
      { id: "mal-1", text: "Etter dette kan deltakeren sette et mål for møtet" },
      { id: "mal-2", text: "Etter dette kan deltakeren skrive referatet" },
    ],
    order: ["sec-a", "sec-b", "mod-1", "sec-c", "mod-2"],
    elements: [
      { clientRef: "sec-a", type: "section" },
      { clientRef: "sec-b", type: "section" },
      {
        clientRef: "mod-1",
        type: "module",
        questions: [
          { question: "Hva trenger et møte?", objective: "mal-1", section: "sec-a" },
          { question: "Hvem skriver referatet?", objective: "mal-2", section: "sec-b" },
        ],
      },
      { clientRef: "sec-c", type: "section" },
      { clientRef: "mod-2", type: "module", questions: [{ task: true, objective: ["mal-1", "mal-2"], section: ["sec-a", "sec-c"] }] },
    ],
  };
}
const feil = (r: ReturnType<typeof checkObjectiveMap>) => r.findings.filter((f) => f.severity === "fail").map((f) => `${f.ref}: ${f.detail}`);
const merknader = (r: ReturnType<typeof checkObjectiveMap>) => r.findings.filter((f) => f.severity === "note").map((f) => f.detail);

describe("objective-map-check — planen, før pakken finnes (#1125)", () => {
  it("et kurs der alt er koblet, går gjennom uten merknad", () => {
    const r = checkObjectiveMap(kurs());
    expect(r.findings).toEqual([]);
    expect(r.objectives).toBe(2);
    expect(formatObjectiveMap(r)).toBe("OK   2 objective(s); every link points at an objective and a section before its test");
  });

  it("en seksjon etter testen stopper — også når den står før en SENERE test", () => {
    const s = kurs();
    s.elements[2]!.questions![1]!.section = "sec-c";
    expect(feil(checkObjectiveMap(s))).toEqual(['mod-1: «Hvem skriver referatet?» is taught in "sec-c", which comes after the test — move the section before the test, or point at the section before it that teaches it']);
  });

  it("en seksjon i en tidligere del av kurset (før en tidligere test) er greit", () => {
    const s = kurs();
    s.elements[4]!.questions![0]!.section = ["sec-a", "sec-b", "sec-c"];
    expect(feil(checkObjectiveMap(s))).toEqual([]);
  });

  it("en test uten noen kobling stopper planen", () => {
    const s = kurs();
    delete (s.elements[4] as { questions?: unknown }).questions;
    expect(feil(checkObjectiveMap(s))).toEqual(['mod-2: no question is linked — add the module\'s "questions" to the course state, each with the objective it tests and the section that teaches it']);
  });

  it("et mål ingen spørsmål tester, er en merknad — ikke en stopp", () => {
    const s = kurs();
    s.learningObjectives.push({ id: "mal-3", text: "Etter dette kan deltakeren lede møtet" });
    const r = checkObjectiveMap(s);
    expect(feil(r)).toEqual([]);
    expect(merknader(r)).toEqual(['objective "mal-3" («Etter dette kan deltakeren lede møtet») is tested by no question or task — add one, or tell the author it is taught and not tested']);
    expect(formatObjectiveMap(r).split("\n")).toEqual([
      "OK   3 objective(s); every link points at an objective and a section before its test",
      'NOTE objective "mal-3" («Etter dette kan deltakeren lede møtet») is tested by no question or task — add one, or tell the author it is taught and not tested',
    ]);
  });

  it("et mål som bare en ukjent id «tester», er fortsatt utestet — og den ukjente id-en stopper", () => {
    const s = kurs();
    s.elements[4]!.questions![0]!.objective = ["mal-1", "mal-x"];
    s.elements[2]!.questions![1]!.objective = "mal-1";
    const r = checkObjectiveMap(s);
    expect(feil(r)).toEqual(['mod-2: the free-text task points at objective "mal-x", which is not among the course\'s learningObjectives (mal-1, mal-2)']);
    expect(merknader(r).join(" ")).toContain('objective "mal-2"');
  });

  it("en lang spørsmålstekst kortes i meldingen", () => {
    const s = kurs();
    s.elements[2]!.questions![0]!.question = "Et styremøte har en lang sakliste, og møtelederen vil at alle skal vite hva som skal avgjøres. Hva gjør hun?";
    s.elements[2]!.questions![0]!.objective = "mal-9";
    expect(feil(checkObjectiveMap(s))[0]).toContain("«Et styremøte har en lang sakliste, og møtelederen vil at…» points at");
  });
});

describe("objective-map-check — mot spørsmålene i pakken (#1125)", () => {
  const moduler = (spm1: string[], oppgave2 = true) => [
    { ref: "mod-1", questions: spm1, hasTask: false },
    { ref: "mod-2", questions: [], hasTask: oppgave2 },
  ];

  it("hvert spørsmål og hver oppgave er koblet → ok, og tellingen stemmer", () => {
    const r = checkObjectiveMap(kurs(), { modules: moduler(["Hva trenger et møte?", "Hvem skriver referatet?"]) });
    expect(r.findings).toEqual([]);
    expect(r.linked).toBe(3);
  });

  it("et spørsmål skrevet om etter at koblingen ble laget: både det nye og den gamle koblingen meldes", () => {
    const r = checkObjectiveMap(kurs(), { modules: moduler(["Hva trenger et godt møte?", "Hvem skriver referatet?"]) });
    expect(feil(r)).toEqual([
      "mod-1: question 1 («Hva trenger et godt møte?») is not linked — add it to the module's \"questions\" in the course state with the objective it tests and the section that teaches it",
      "mod-1: the course state links «Hva trenger et møte?», which is not a question in the module — write the question as it now stands, or take the link out",
    ]);
  });

  it("en oppgave i pakken uten «task»-kobling stopper; en «task»-kobling uten oppgave i pakken er bare ubrukt", () => {
    const s = kurs();
    s.elements[4]!.questions = [{ question: "Hva trenger et møte?", objective: "mal-1", section: "sec-a" }] as never;
    s.elements[2]!.questions!.push({ task: true, objective: "mal-1", section: "sec-a" } as never);
    const r = checkObjectiveMap(s, { modules: [{ ref: "mod-1", questions: ["Hva trenger et møte?", "Hvem skriver referatet?"], hasTask: false }, { ref: "mod-2", questions: ["Hva trenger et møte?"], hasTask: true }] });
    expect(feil(r)).toEqual(['mod-2: the free-text task is not linked — add { "task": true, "objective": […], "section": […] } to the module\'s "questions" in the course state']);
  });

  it("rekkefølgen i pakken gjelder, ikke tilstandens: en seksjon flyttet bak testen stopper", () => {
    const order = [
      { ref: "sec-a", type: "section" },
      { ref: "mod-1", type: "module" },
      { ref: "sec-b", type: "section" },
      { ref: "sec-c", type: "section" },
      { ref: "mod-2", type: "module" },
    ];
    const r = checkObjectiveMap(kurs(), { order, modules: moduler(["Hva trenger et møte?", "Hvem skriver referatet?"]) });
    expect(feil(r)).toEqual(['mod-1: «Hvem skriver referatet?» is taught in "sec-b", which comes after the test — move the section before the test, or point at the section before it that teaches it']);
  });

  it("bare noen av testene (en justering): bare de leses, og et mål de andre kanskje tester, meldes ikke", () => {
    const s = kurs();
    s.learningObjectives.push({ id: "mal-3", text: "Etter dette kan deltakeren lede møtet" });
    s.elements[4]!.questions![0]!.section = "sec-borte";
    const bare1 = [{ ref: "mod-1", questions: ["Hva trenger et møte?", "Hvem skriver referatet?"], hasTask: false }];
    expect(checkObjectiveMap(s, { modules: bare1, partial: true }).findings).toEqual([]);
    // Kontrollcase: hele kurset gir merknaden.
    expect(merknader(checkObjectiveMap(s, { modules: bare1 })).join(" ")).toContain('objective "mal-3"');
  });
});

describe("objective-map-check — kommandolinja (#1125)", () => {
  const kjør = (state: unknown) => {
    const fil = join(mkdtempSync(join(tmpdir(), "maal-")), "course-state.json");
    writeFileSync(fil, JSON.stringify(state), "utf8");
    return spawnSync(process.execPath, ["skills/a2-authoring-api/scripts/objective-map-check.mjs", fil], { encoding: "utf8" });
  };

  it("et koblet kurs gir OK og kode 0; en manglende kobling gir FAIL og kode 1", () => {
    const ok = kjør(kurs());
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("OK   2 objective(s)");
    const s = kurs();
    delete (s as { learningObjectives?: unknown }).learningObjectives;
    const brudd = kjør(s);
    expect(brudd.status).toBe(1);
    expect(brudd.stdout).toContain("FAIL the course state has no learningObjectives");
    expect(brudd.stdout).not.toContain("OK ");
  });

  it("eksempelkurset i skillet går gjennom planen", () => {
    const r = spawnSync(process.execPath, ["skills/a2-authoring-api/scripts/objective-map-check.mjs", "skills/a2-authoring-api/examples/course-from-slides/course-state.json"], { encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
