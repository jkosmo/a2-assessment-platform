import { checkAltTexts } from "#section-text-check";

/**
 * #1128: skillets alt-tekstregel (`skills/a2-authoring-api/scripts/section-text-check.mjs`), lest av
 * plattformen. Skillet stopper på en alt-tekst som bare er en tittel; her er det et varsel — samme
 * deling som for flervalg (mcqCueWarnings.ts) og kriterier (rubricWarnings.ts).
 */
export type AltTextWarning = { code: "alt_is_title"; alt: string };

function texts(bodyMarkdown: unknown): string[] {
  if (typeof bodyMarkdown === "string") return [bodyMarkdown];
  if (bodyMarkdown && typeof bodyMarkdown === "object") return Object.values(bodyMarkdown as Record<string, unknown>).filter((v): v is string => typeof v === "string");
  return [];
}

/** Én seksjonstekst, alle språk. Samme alt-tekst meldes én gang. */
export function altTextWarnings(bodyMarkdown: unknown): AltTextWarning[] {
  const seen = new Set<string>();
  const warnings: AltTextWarning[] = [];
  for (const text of texts(bodyMarkdown)) {
    for (const finding of checkAltTexts(text)) {
      if (seen.has(finding.alt)) continue;
      seen.add(finding.alt);
      warnings.push({ code: "alt_is_title", alt: finding.alt });
    }
  }
  return warnings;
}

/** Hver seksjon i en kurspakke med funn. */
export function packageAltTextWarnings(envelope: unknown): Array<{ title: unknown; warnings: AltTextWarning[] }> {
  const items = (envelope as { course?: { course?: { items?: Array<{ type?: string; section?: { title?: unknown; bodyMarkdown?: unknown } }> } } })?.course?.course?.items ?? [];
  // Bare seksjoner har `section`; en modul gir ingen tekst og faller bort i filteret under.
  return items
    .map((item) => ({ title: item?.section?.title ?? null, warnings: altTextWarnings(item?.section?.bodyMarkdown) }))
    .filter((entry) => entry.warnings.length > 0);
}
