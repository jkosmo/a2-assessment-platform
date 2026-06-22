// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { resolveInitialLocale } from "../../public/static/i18n-locale.js";

// #596 slice 3: pins the consolidated initial-locale resolution (stored > browser-prefix > en-GB).
const SUPPORTED = ["en-GB", "nb", "nn"];

function setLanguage(value) {
  Object.defineProperty(navigator, "language", { value, configurable: true });
}

describe("resolveInitialLocale (shared, #596)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns a valid stored locale, ignoring the browser", () => {
    localStorage.setItem("participant.locale", "nn");
    setLanguage("en-US");
    expect(resolveInitialLocale(SUPPORTED)).toBe("nn");
  });

  it("ignores an unsupported stored locale and falls back to the browser", () => {
    localStorage.setItem("participant.locale", "de");
    setLanguage("nb-NO");
    expect(resolveInitialLocale(SUPPORTED)).toBe("nb");
  });

  it("maps the browser language prefix nb/nn/en", () => {
    setLanguage("nb-NO");
    expect(resolveInitialLocale(SUPPORTED)).toBe("nb");
    setLanguage("nn-NO");
    expect(resolveInitialLocale(SUPPORTED)).toBe("nn");
    setLanguage("en-US");
    expect(resolveInitialLocale(SUPPORTED)).toBe("en-GB");
  });

  it("defaults to en-GB for unknown or empty browser languages", () => {
    setLanguage("de-DE");
    expect(resolveInitialLocale(SUPPORTED)).toBe("en-GB");
    setLanguage("");
    expect(resolveInitialLocale(SUPPORTED)).toBe("en-GB");
  });
});
