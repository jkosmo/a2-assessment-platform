import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openedOnlySubmissionWhere } from "../../src/modules/content/openedOnlySubmission.js";

// #1176: «en innlevering som bare er åpnet» er en HVITELISTE (src/modules/content/openedOnlySubmission.ts): den er tom bare når ingen
// tabell under `Submission` har en rad for den, og ingen kolonne i raden selv bærer noe deltakeren har levert. En ny tabell eller
// kolonne gjør definisjonen ufullstendig uten at noe blir rødt, og da kunne «Slett» fjerne en innlevering med historikk. Denne
// vakta leser skjemaet og krever at hvert felt på `Submission` er vurdert her: enten sjekket i hvitelisten, eller nevnt med grunn.
//
// QA 2.172.0 (første versjon, NO-GO): vakta så bare på relasjonene, og hullet var i raden selv (fritekst i `responseJson`).

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Feltene på `model Submission` (navn → type). */
function submissionFields(): Map<string, string> {
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
  const block = /model Submission \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
  const fields = new Map<string, string>();
  for (const line of block.split("\n")) {
    const match = /^\s*(\w+)\s+([A-Za-z]\w*)(\[\])?\??(\s|$)/.exec(line);
    if (match && !line.trim().startsWith("@@") && !line.trim().startsWith("//")) fields.set(match[1]!, match[2]!);
  }
  return fields;
}

// Feltene som ikke bærer noe levert, med grunn.
const NOT_DELIVERED = new Map([
  ["id", "nøkkelen"],
  ["userId", "hvem som åpnet modulen"],
  ["moduleId", "modulen"],
  ["user", "hvem som åpnet modulen"],
  ["module", "modulen"],
  ["locale", "språket deltakeren hadde"],
  ["deliveryType", "alltid «text» fra klienten, også for flervalg"],
  ["responseJson", "fritekst: dekket av `moduleVersion.assessmentMode = MCQ_ONLY` (en ren flervalgsmodul har ingen tekst å levere)"],
  ["moduleVersionId", "versjonen deltakeren fikk (selve sjekken går på relasjonen `moduleVersion`)"],
  ["submittedAt", "tidspunktet raden ble laget"],
  ["createdAt", "tidspunktet raden ble laget"],
  ["updatedAt", "tidspunktet raden sist ble endret"],
]);

describe("#1176: definisjonen av en innlevering som bare er åpnet, dekker alle feltene på Submission", () => {
  it("hvert felt på Submission er enten i hvitelisten eller nevnt med grunn", () => {
    const fields = submissionFields();
    expect(fields.size, "fant få felt: har skjemaet endret form?").toBeGreaterThan(15);
    const checked = new Set(Object.keys(openedOnlySubmissionWhere));
    const unhandled = [...fields.keys()].filter((name) => !checked.has(name) && !NOT_DELIVERED.has(name));
    expect(unhandled, "nytt felt eller ny tabell under Submission: ta det med i openedOnlySubmissionWhere, eller nevn det i NOT_DELIVERED med grunn").toEqual([]);
    expect([...checked].filter((name) => !fields.has(name)), "hvitelisten nevner et felt som ikke finnes (omdøpt?)").toEqual([]);
  });

  it("hver tabell under Submission i hvitelisten krever at det INGENTING finnes (none / is null / every uten svar)", () => {
    const where = openedOnlySubmissionWhere as Record<string, unknown>;
    for (const relation of ["assessmentJobs", "decisions", "appeals", "manualReviews", "llmEvaluations"]) {
      expect(where[relation], relation).toEqual({ none: {} });
    }
    expect(where.modulePass).toEqual({ is: null });
    expect(where.mcqAttempts).toEqual({ every: { completedAt: null, responses: { none: {} } } });
  });

  it("bare en ren flervalgsmodul, status SUBMITTED, uten KI-erklæring og vedlegg", () => {
    expect(openedOnlySubmissionWhere.submissionStatus).toBe("SUBMITTED");
    expect(openedOnlySubmissionWhere.moduleVersion).toEqual({ assessmentMode: "MCQ_ONLY" });
    expect(openedOnlySubmissionWhere.processSignalsJson).toBeNull();
    expect(openedOnlySubmissionWhere.attachmentUri).toBeNull();
  });
});
