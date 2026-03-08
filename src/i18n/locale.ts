export const SUPPORTED_LOCALES = ["en-GB", "nb", "nn"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(input: string | undefined | null): SupportedLocale | null {
  if (!input) {
    return null;
  }

  const cleaned = input.trim();
  if (!cleaned) {
    return null;
  }

  if (isSupportedLocale(cleaned)) {
    return cleaned;
  }

  const lower = cleaned.toLowerCase();
  if (lower.startsWith("nb")) {
    return "nb";
  }
  if (lower.startsWith("nn")) {
    return "nn";
  }
  if (lower.startsWith("en")) {
    return "en-GB";
  }

  return null;
}

export function resolveFromAcceptLanguage(input: string | undefined | null): SupportedLocale | null {
  if (!input) {
    return null;
  }

  const values = input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(";")[0]?.trim())
    .filter((part): part is string => Boolean(part));

  for (const value of values) {
    const normalized = normalizeLocale(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function resolveRequestLocale(input: {
  explicitLocale?: string;
  acceptLanguage?: string;
  defaultLocale?: string;
}): SupportedLocale {
  const explicit = normalizeLocale(input.explicitLocale);
  if (explicit) {
    return explicit;
  }

  const accepted = resolveFromAcceptLanguage(input.acceptLanguage);
  if (accepted) {
    return accepted;
  }

  const configuredDefault = normalizeLocale(input.defaultLocale);
  if (configuredDefault) {
    return configuredDefault;
  }

  return "en-GB";
}
