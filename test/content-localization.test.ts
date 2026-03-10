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
