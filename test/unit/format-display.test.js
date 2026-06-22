import { describe, it, expect } from "vitest";
import { createNumberFormatter, createDateTimeFormatter } from "../../public/static/format-display.js";

// #596 slice 2: pins the consolidated number formatter, including the lazy locale getter and the
// configurable non-number placeholder (the one behaviour that differed across the 7 copies).
describe("createNumberFormatter (shared, #596)", () => {
  it("formats numbers using the locale read lazily at call time", () => {
    let locale = "en-GB";
    const fmt = createNumberFormatter(() => locale);
    expect(fmt(1234.5)).toBe("1,234.5");
    // Changing the captured locale afterwards is reflected on the next call (lazy read).
    locale = "nb";
    expect(fmt(1234.5)).toBe("1 234,5"); // nb groups with a non-breaking space, decimal comma
  });

  it("respects maximumFractionDigits (default 2, minimum 0)", () => {
    const fmt = createNumberFormatter(() => "en-GB");
    expect(fmt(1.23456)).toBe("1.23");
    expect(fmt(5)).toBe("5"); // minimumFractionDigits 0 → no trailing zeros
    expect(fmt(1.23456, 4)).toBe("1.2346");
  });

  it("returns the default '-' placeholder for non-numbers", () => {
    const fmt = createNumberFormatter(() => "en-GB");
    expect(fmt(null)).toBe("-");
    expect(fmt(undefined)).toBe("-");
    expect(fmt("12")).toBe("-"); // strings are NOT coerced (typeof guard)
    expect(fmt(NaN)).toBe("NaN"); // NaN is typeof number → Intl formats it
  });

  it("supports a custom placeholder (profile.js uses the em-dash)", () => {
    const fmt = createNumberFormatter(() => "en-GB", "—");
    expect(fmt(null)).toBe("—");
  });
});

describe("createDateTimeFormatter (shared, #596)", () => {
  it("formats a date-time with the lazily-read locale (medium date, short time)", () => {
    const fmt = createDateTimeFormatter(() => "en-GB");
    const out = fmt("2026-06-22T08:30:00Z");
    // Locale/timezone-dependent exact string; assert it produced a non-empty formatted value
    // containing the year, not the raw ISO input.
    expect(out).toContain("2026");
    expect(out).not.toBe("2026-06-22T08:30:00Z");
  });

  it("returns the placeholder for falsy values (default '-' or custom)", () => {
    expect(createDateTimeFormatter(() => "en-GB")(null)).toBe("-");
    expect(createDateTimeFormatter(() => "en-GB")("")).toBe("-");
    expect(createDateTimeFormatter(() => "en-GB", "—")(undefined)).toBe("—");
  });

  it("falls back to String(value) when the date cannot be formatted", () => {
    // An unparseable date → new Date("nope") is Invalid Date → Intl throws → catch → String(value).
    expect(createDateTimeFormatter(() => "en-GB")("not-a-date")).toBe("not-a-date");
  });
});
