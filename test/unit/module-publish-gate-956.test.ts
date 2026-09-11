import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateModulePublishGate, flattenStoredLocalized } from "../../src/modules/adminContent/modulePublishGate.js";

// ─────────────────────────────────────────────────────────────────────────────
// #956: tre publiseringsgater, tre feltsett, tre normaliseringer — nå én.
//
// Knappen flatet ut «en-GB → nb → nn», kaskaden flatet ikke ut i det hele tatt (målte på rå JSON),
// og importen kjørte aldri blueprint-sjekken og unntok taskText for MCQ_ONLY. Forfatteren fikk tre
// svar på «kan denne publiseres?» avhengig av dør.
//
// ⚠️ Testene under måler det som SKILTE dørene, ikke det de var enige om.
// ─────────────────────────────────────────────────────────────────────────────

const nb3 = (t: string) => JSON.stringify({ "en-GB": `${t} (en)`, nb: t, nn: `${t} (nn)` });
const nbOnly = (t: string) => JSON.stringify({ nb: t });
const blueprint = (mcq: number) => JSON.stringify({ learningObjectives: ["x"], mcqProfile: { suggestedCount: mcq } });

const langTekst = "Dette er en oppgavetekst som er lang nok til at lengdesjekken ikke reagerer på den. ".repeat(4);

function q(i: number) {
  return {
    stem: nb3(`Spørsmål ${i}`),
    optionsJson: JSON.stringify([nb3("A"), nb3("B"), nb3("C"), nb3("D")]),
    correctAnswer: nb3("A"),
    rationale: nb3("Fordi"),
  };
}

describe("#956 — flattenStoredLocalized er den ene normaliseringen", () => {
  it("⚠️ et språkkart gir TEKST, ikke JSON — kaskaden målte på JSON-en før", () => {
    expect(flattenStoredLocalized(nb3("Tekst"))).toBe("Tekst (en)");
    expect(flattenStoredLocalized(nbOnly("Bare bokmål"))).toBe("Bare bokmål");
    expect(flattenStoredLocalized("ren streng")).toBe("ren streng");
    expect(flattenStoredLocalized(null)).toBeNull();
  });
});

describe("#956 — evaluateModulePublishGate", () => {
  const komplett = {
    module: { title: nb3("Modul"), description: nb3("Beskrivelse"), archivedAt: null },
    version: { taskText: nb3(langTekst), candidateTaskConstraints: null, assessorExpectedContent: nb3(langTekst), assessmentBlueprint: blueprint(4) },
    mcqQuestions: [q(1), q(2), q(3), q(4)],
  };

  it("kontrollcase: en komplett modul går gjennom", () => {
    const r = evaluateModulePublishGate(komplett);
    expect(r.valid, JSON.stringify(r.issues)).toBe(true);
  });

  it("⚠️ taskText gates når den FINNES — også der importen før unntok MCQ_ONLY", () => {
    const r = evaluateModulePublishGate({ ...komplett, version: { ...komplett.version, taskText: nbOnly(langTekst) } });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === "TRANSLATION_MISSING" && (i as { field?: string }).field === "taskText" || String(i.code).toLowerCase().includes("translation"))).toBe(true);
  });

  it("⚠️ blueprint-sjekken blokkerer — den fantes ikke på import-døra", () => {
    // Blueprint sier 10 spørsmål, settet har 4 → ratio 0,4 < 0,5 → blokkerende.
    const r = evaluateModulePublishGate({ ...komplett, version: { ...komplett.version, assessmentBlueprint: blueprint(10) } });
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("MCQ_COUNT_FAR_BELOW_BLUEPRINT");
  });

  it("⚠️ lengdesjekken måler tekst, ikke JSON — kaskaden fikk TASK_TEXT_TOO_SHORT på lang tekst", () => {
    // En kort tekst pakket i et språkkart er kort. En lang tekst er lang — uansett innpakning.
    const kort = evaluateModulePublishGate({ ...komplett, version: { ...komplett.version, taskText: nb3("Kort.") } });
    expect(kort.issues.map((i) => i.code)).toContain("TASK_TEXT_TOO_SHORT");
    const lang = evaluateModulePublishGate(komplett);
    expect(lang.issues.map((i) => i.code)).not.toContain("TASK_TEXT_TOO_SHORT");
  });

  it("arkivert modul blokkeres med samme kode som de andre stedene (#955)", () => {
    const r = evaluateModulePublishGate({ ...komplett, module: { ...komplett.module, archivedAt: new Date() } });
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("item_archived");
  });

  it("fraværende valgfrie felt er ikke uoversatte", () => {
    const r = evaluateModulePublishGate({
      module: { title: nb3("MCQ-modul"), description: null, archivedAt: null },
      version: { taskText: null, candidateTaskConstraints: null, assessorExpectedContent: null, assessmentBlueprint: blueprint(4) },
      mcqQuestions: [q(1), q(2), q(3), q(4)],
    });
    expect(r.valid, JSON.stringify(r.issues)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VAKT: modulvalidatorene kalles bare fra den delte gaten. En fjerde dør som kaller
// `validateModuleVersionForPublish` direkte er en fjerde mening om «kan denne publiseres?».
// (`validateSectionTranslationCompleteness` er seksjonenes gate og får bruke oversettelsessjekken.)
// ─────────────────────────────────────────────────────────────────────────────
const SRC = fileURLToPath(new URL("../../src", import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}
describe("#956 — vakt: én gate", () => {
  it("⚠️ validateModuleVersionForPublish / validateMcqTranslationCompleteness kalles bare fra modulePublishGate", () => {
    const treff: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");
      if (rel.endsWith("modulePublishGate.ts") || rel.endsWith("contentValidationService.ts")) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
        if (/\b(validateModuleVersionForPublish|validateMcqTranslationCompleteness)\s*\(/.test(line)) treff.push(`${rel}:${i + 1}`);
      });
    }
    expect(treff.join("\n")).toBe("");
  });
});
