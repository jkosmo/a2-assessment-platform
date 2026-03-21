export type LocalizedTextObject = Partial<Record<"en-GB" | "nb" | "nn", string>>;
export type LocalizedText = string | LocalizedTextObject;

export const localizedTextCodec = {
  /**
   * Decodes a stored localized text value.
   * Plain strings are returned as-is; JSON objects are parsed into a locale map.
   * Returns null for null/undefined input.
   */
  parse(raw: string | null | undefined): LocalizedText | null {
    if (typeof raw !== "string") return null;

    const trimmed = raw.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return raw;
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return raw;
      }

      const localized: LocalizedTextObject = {};
      for (const locale of ["en-GB", "nb", "nn"] as const) {
        const value = parsed[locale];
        if (typeof value === "string" && value.trim().length > 0) {
          localized[locale] = value.trim();
        }
      }

      return Object.keys(localized).length > 0 ? localized : raw;
    } catch {
      return raw;
    }
  },

  /**
   * Serializes a localized text value for storage.
   * Plain strings are trimmed and returned as-is; locale objects are JSON-stringified.
   */
  serialize(value: LocalizedText): string {
    if (typeof value === "string") {
      return value.trim();
    }

    const out: Record<string, string> = {};
    for (const locale of ["en-GB", "nb", "nn"] as const) {
      const v = value[locale];
      if (typeof v === "string") {
        out[locale] = v.trim();
      }
    }
    return JSON.stringify(out);
  },
};
