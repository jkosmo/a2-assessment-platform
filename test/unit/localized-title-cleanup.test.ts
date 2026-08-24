import { describe, expect, it } from "vitest";
import { collapsibleTitle } from "../../src/services/localizedTitleCleanup.js";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

// #892 clean-up. The dangerous direction here is over-collapsing: turning a real partial
// translation into a plain string would silently destroy an author's work. Most of these cases
// therefore assert that the script leaves a row ALONE.

// #994: modulgrafen leses her, ikke i første test. Se test/support/moduleGraphWarmup.ts.
warmModuleGraph(() => import("../../src/i18n/content.js"));

describe("collapsibleTitle — what the clean-up may touch", () => {
  it("collapses a map whose locales all hold the same string", () => {
    const raw = JSON.stringify({ "en-GB": "Klassisk LLM", nb: "Klassisk LLM", nn: "Klassisk LLM" });
    expect(collapsibleTitle(raw)).toBe("Klassisk LLM");
  });

  it("collapses a two-locale duplicate as well", () => {
    expect(collapsibleTitle(JSON.stringify({ nb: "Kodekjøring", nn: "Kodekjøring" }))).toBe("Kodekjøring");
  });

  it("ignores differences in surrounding whitespace when comparing", () => {
    const raw = JSON.stringify({ nb: "Kodekjøring", nn: "  Kodekjøring  " });
    expect(collapsibleTitle(raw)).toBe("Kodekjøring");
  });
});

describe("collapsibleTitle — what it must NOT touch", () => {
  it("leaves a genuine translation alone", () => {
    const raw = JSON.stringify({ nb: "Kunnskapskilder", nn: "Kunnskapskjelder" });
    expect(collapsibleTitle(raw)).toBeNull();
  });

  it("leaves a partial translation alone — two equal, one different is still real work", () => {
    const raw = JSON.stringify({ "en-GB": "Knowledge sources", nb: "Kunnskapskilder", nn: "Kunnskapskilder" });
    expect(collapsibleTitle(raw)).toBeNull();
  });

  it("leaves a single-locale map alone — it records WHICH language the text is in", () => {
    // A plain string says "untranslated, language unknown"; {"nb": …} says "untranslated, in nb".
    // Collapsing would throw that away.
    expect(collapsibleTitle(JSON.stringify({ nb: "Klassisk LLM" }))).toBeNull();
  });

  it("leaves an already-plain string alone", () => {
    expect(collapsibleTitle("Klassisk LLM")).toBeNull();
  });

  it("leaves empty and malformed values alone", () => {
    expect(collapsibleTitle(null)).toBeNull();
    expect(collapsibleTitle(undefined)).toBeNull();
    expect(collapsibleTitle("")).toBeNull();
    expect(collapsibleTitle("{not json")).toBeNull();
    expect(collapsibleTitle(JSON.stringify({ nb: "   ", nn: "   " }))).toBeNull();
  });

  it("is idempotent — the output of a collapse is never collapsible again", () => {
    const raw = JSON.stringify({ "en-GB": "Klassisk LLM", nb: "Klassisk LLM", nn: "Klassisk LLM" });
    const once = collapsibleTitle(raw);
    expect(once).toBe("Klassisk LLM");
    expect(collapsibleTitle(once)).toBeNull();
  });
});

describe("collapsibleTitle — display neutrality", () => {
  it("produces a value that renders identically in every locale", async () => {
    // The safety argument for the whole script: for a duplicated map, the collapsed plain string
    // resolves to the same text under every locale, so nothing observable changes.
    const { localizeContentText } = await import("../../src/i18n/content.js");
    const raw = JSON.stringify({ "en-GB": "Kodekjøring", nb: "Kodekjøring", nn: "Kodekjøring" });
    const collapsed = collapsibleTitle(raw)!;

    for (const locale of ["en-GB", "nb", "nn"] as const) {
      expect(localizeContentText(locale, collapsed)).toBe(localizeContentText(locale, raw));
    }
  });
});
