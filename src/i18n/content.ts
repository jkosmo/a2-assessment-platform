import type { SupportedLocale } from "./locale.js";
import { contentMessages } from "./contentMessages.js";

const localeKeys: SupportedLocale[] = ["en-GB", "nb", "nn"];

type InlineLocalizedMap = Partial<Record<SupportedLocale, string>>;

function parseInlineLocalizedMap(input: string): InlineLocalizedMap | null {
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
    return inline[locale] ?? inline["en-GB"] ?? Object.values(inline)[0] ?? input;
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
