import { describe, expect, it } from "vitest";
import {
  localizeContentText,
  matchesLocalizedContentVariant,
  resolveContentVariants,
} from "../src/i18n/content.js";

describe("content localization helpers", () => {
  it("localizes inline locale-json text payloads", () => {
    const value = JSON.stringify({
      "en-GB": "Risk review",
      nb: "Risikovurdering",
      nn: "Risikovurdering",
    });

    expect(localizeContentText("en-GB", value)).toBe("Risk review");
    expect(localizeContentText("nb", value)).toBe("Risikovurdering");
    expect(localizeContentText("nn", value)).toBe("Risikovurdering");
  });

  it("matches localized variants for plain source strings", () => {
    const source = "Backend owns final decision";
    const variants = resolveContentVariants(source);
    expect(variants).toContain("Backend owns final decision");
    expect(variants).toContain("Backend eier endelig beslutning");
    expect(variants).toContain("Backend eig endeleg avgjerd");
    expect(matchesLocalizedContentVariant(source, "Backend eier endelig beslutning")).toBe(true);
  });
});

// #913 widened what an MCQ field may hold: a PARTIAL locale map, so a translation that succeeded
// for one language and failed for another can be stored honestly. That change is only safe if the
// read side survives a missing locale — scoring compares a participant's selection against the
// stored correct answer, and a module can be live with a gap only for content published before
// the #896 S4 gate existed.
describe("partial locale maps (#913)", () => {
  const partial = JSON.stringify({ nb: "Medlemmene", "en-GB": "The members" });

  it("resolves only the locales that are actually present", () => {
    expect(resolveContentVariants(partial).sort()).toEqual(["Medlemmene", "The members"]);
  });

  it("scores a selection made in either present locale as correct", () => {
    expect(matchesLocalizedContentVariant(partial, "Medlemmene")).toBe(true);
    expect(matchesLocalizedContentVariant(partial, "The members")).toBe(true);
  });

  it("still rejects an answer that is not one of the stored variants", () => {
    expect(matchesLocalizedContentVariant(partial, "Styret")).toBe(false);
  });

  it("falls back to another language rather than rendering blank for the missing locale", () => {
    // Degrading to a language the participant may not read is bad — which is exactly why the
    // publish gate exists. Rendering nothing at all would be worse.
    expect(localizeContentText("nn", partial)).toBe("The members");
  });
});
