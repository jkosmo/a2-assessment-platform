import { checkMcqCues, collectMcqSets, type McqCueIssue } from "#mcq-cue";

/**
 * #1119: skillets hint-kontroll (`skills/a2-authoring-api/scripts/mcq-cue-check.mjs`), lest av
 * plattformen. Skillet stopper på hvert funn; her blir de varsler — reglene er tommelfingerregler,
 * og den som redigerer på plattformen har ingen KI som skriver spørsmålet om.
 *
 * Bare reglene om at svaret røper seg vises. Formreglene (for få alternativer, «sett i riktig
 * rekkefølge» med feil antall …) har plattformen egne kontroller for.
 *
 * ⚠️ En ny regel legges til i mcq-cue-check.mjs, ikke her — og får en tekst i
 * admin-content-translations.js (`mcqCue.<kind>`) før den tas med i lista under.
 */
export const PLATFORM_CUE_KINDS = [
  "absolute_words",
  "stem_about_course",
  "answer_echoes_text",
  "correct_is_longest",
  "correct_are_longer",
  "length_bias",
  "count_in_stem",
  "catch_all_option",
] as const satisfies ReadonlyArray<McqCueIssue["kind"]>;

export type McqCueWarning = {
  code: (typeof PLATFORM_CUE_KINDS)[number];
  /** 1-basert spørsmålsnummer; null for et funn om hele testen. */
  question: number | null;
  count?: number;
};

const shown = new Set<string>(PLATFORM_CUE_KINDS);

function toWarnings(issues: McqCueIssue[], omit: ReadonlySet<string>): McqCueWarning[] {
  return issues
    .filter((issue) => shown.has(issue.kind) && !omit.has(issue.kind))
    .map((issue) => ({
      code: issue.kind as McqCueWarning["code"],
      question: issue.index == null ? null : issue.index + 1,
      ...(issue.count !== undefined ? { count: issue.count } : {}),
    }));
}

/** Én test. `reading` er seksjonstekstene før testen, når de finnes. `omit` tar bort regler kalleren alt melder. */
export function mcqCueWarnings(
  questions: unknown[] | null | undefined,
  { reading, omit = [] }: { reading?: unknown[]; omit?: string[] } = {},
): McqCueWarning[] {
  if (!Array.isArray(questions) || questions.length === 0) return [];
  return toWarnings(checkMcqCues(questions, reading ? { reading } : {}).issues, new Set(omit));
}

/** Hver test i en kurs- eller modulpakke (eksportformatet), med lesestoffet før den. Bare tester med funn. */
export function packageCueWarnings(envelope: unknown): Array<{ title: unknown; warnings: McqCueWarning[] }> {
  return collectMcqSets(envelope)
    .map((set) => ({ title: set.title ?? null, warnings: mcqCueWarnings(set.questions, { reading: set.reading }) }))
    .filter((set) => set.warnings.length > 0);
}
