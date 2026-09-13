import type { SupportedLocale } from "./locale.js";
import { contentMessages } from "./contentMessages.js";

const localeKeys: SupportedLocale[] = ["en-GB", "nb", "nn"];

// #1046 (produkteier 12.09: «Ja til NB som påkrevd»): når en tekst mangler på leserens språk, vises
// organisasjonens standardspråk (DEFAULT_LOCALE, nb hos A-2) — ikke engelsk. Engelsk er bare siste
// utvei, for plattformer som kjører uten standardspråk. Lest rett fra miljøet, ikke fra env.ts, så
// denne fila ikke drar med seg hele miljøvalideringen inn i alle som lokaliserer en tekst.
function organisationDefaultLocale(): SupportedLocale {
  const raw = process.env.DEFAULT_LOCALE;
  return raw && (localeKeys as string[]).includes(raw) ? (raw as SupportedLocale) : "en-GB";
}

/** Rekkefølgen en lokalisert tekst leses i: leserens språk → standardspråket → engelsk → det som finnes. */
export function contentFallbackOrder(locale: SupportedLocale): SupportedLocale[] {
  return [...new Set<SupportedLocale>([locale, organisationDefaultLocale(), "en-GB"])];
}

/** Første ikke-tomme verdi i et språkkart, i fallback-rekkefølgen. */
export function pickLocalizedValue<T extends Partial<Record<SupportedLocale, string | null | undefined>>>(
  map: T,
  locale: SupportedLocale,
): string | undefined {
  for (const key of contentFallbackOrder(locale)) {
    const value = map[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return Object.values(map).find((v): v is string => typeof v === "string" && v.trim().length > 0);
}

type InlineLocalizedMap = Partial<Record<SupportedLocale, string>>;

export function parseInlineLocalizedMap(input: string): InlineLocalizedMap | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const mapped: InlineLocalizedMap = {};
    let hasSupportedLocale = false;

    for (const locale of localeKeys) {
      const value = (parsed as Record<string, unknown>)[locale];
      if (typeof value !== "string") {
        continue;
      }
      const normalized = value.trim();
      if (!normalized) {
        continue;
      }
      mapped[locale] = normalized;
      hasSupportedLocale = true;
    }

    return hasSupportedLocale ? mapped : null;
  } catch {
    return null;
  }
}

export function resolveContentVariants(input: string): string[] {
  const inline = parseInlineLocalizedMap(input);
  if (inline) {
    return Array.from(
      new Set(
        localeKeys
          .map((locale) => inline[locale])
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    );
  }

  const variants = new Set<string>([input]);
  for (const locale of ["nb", "nn"] as const) {
    const translated = contentMessages[locale][input];
    if (translated) {
      variants.add(translated);
    }
  }
  return Array.from(variants);
}

export function matchesLocalizedContentVariant(storedValue: string, selectedValue: string): boolean {
  const selected = selectedValue.trim();
  if (!selected) {
    return false;
  }
  return resolveContentVariants(storedValue).some((candidate) => candidate === selected);
}

export function localizeContentText(locale: SupportedLocale, input: string | null | undefined): string | null {
  if (input == null) {
    return null;
  }

  const inline = parseInlineLocalizedMap(input);
  if (inline) {
    return pickLocalizedValue(inline, locale) ?? input;
  }

  if (locale === "en-GB") {
    return input;
  }
  return contentMessages[locale][input] ?? input;
}

export function localizeContentArray(locale: SupportedLocale, values: unknown[]): string[] {
  return values.map((value) => {
    if (typeof value === "string") {
      return localizeContentText(locale, value) ?? value;
    }

    if (value && typeof value === "object") {
      const inlineJson = JSON.stringify(value);
      return localizeContentText(locale, inlineJson) ?? inlineJson;
    }

    return String(value);
  });
}
