import type { SupportedLocale } from "./locale.js";
import { contentMessages } from "./contentMessages.js";

export function localizeContentText(locale: SupportedLocale, input: string | null | undefined): string | null {
  if (input == null) {
    return null;
  }

  if (locale === "en-GB") {
    return input;
  }

  return contentMessages[locale][input] ?? input;
}

export function localizeContentArray(locale: SupportedLocale, values: string[]): string[] {
  return values.map((value) => localizeContentText(locale, value) ?? value);
}
