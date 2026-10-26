import { checkRubricScales, collectRubrics } from "#rubric-check";

/**
 * #1122: skillets kontroll av vurderingskriterier (`skills/a2-authoring-api/scripts/rubric-check.mjs`),
 * lest av plattformen. Skillet stopper på et kriterium med én linje for hele skalaen; her er det et
 * varsel — samme deling som hint-kontrollen for flervalg (mcqCueWarnings.ts).
 */
export type RubricWarning = {
  code: "scale_not_described";
  /** Kriteriets navn slik forfatteren ser det: `label` når den finnes, ellers nøkkelen. */
  criterion: string;
};

function labelOf(name: string, criterion: unknown): string {
  if (criterion && typeof criterion === "object" && "label" in criterion) {
    const label = (criterion as { label?: unknown }).label;
    if (typeof label === "string" && label.trim()) return label;
    if (label && typeof label === "object") {
      const first = Object.values(label as Record<string, unknown>).find((v) => typeof v === "string" && v.trim());
      if (typeof first === "string") return first;
    }
  }
  return name;
}

/** Ett sett kriterier (objekt eller liste med `id`). */
export function rubricWarnings(criteria: unknown): RubricWarning[] {
  const map: Record<string, unknown> = Array.isArray(criteria)
    ? Object.fromEntries(criteria.map((c, i) => [String((c as { id?: unknown })?.id ?? i), c]))
    : criteria && typeof criteria === "object"
      ? (criteria as Record<string, unknown>)
      : {};
  return checkRubricScales(map).map((finding) => ({ code: finding.kind, criterion: labelOf(finding.criterion, map[finding.criterion]) }));
}

/** Hver modul i en kurs- eller modulpakke med funn. */
export function packageRubricWarnings(envelope: unknown): Array<{ title: unknown; warnings: RubricWarning[] }> {
  return collectRubrics(envelope)
    .map((rubric) => ({ title: rubric.title ?? null, warnings: rubricWarnings(rubric.criteria) }))
    .filter((entry) => entry.warnings.length > 0);
}
