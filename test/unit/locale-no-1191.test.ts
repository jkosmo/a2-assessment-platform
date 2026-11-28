import { describe, expect, it } from "vitest";
import { normalizeLocale, resolveRequestLocale } from "../../src/i18n/locale.js";

// #1191: «no» er norsk uten målform. Før ga tjeneren null for «no», og en nettleser med bare «no» i Accept-Language fikk
// organisasjonens standard i stedet for bokmål, mens klienten sendte engelsk. Begge lag sier nå bokmål.
describe("normalizeLocale: no betyr bokmål (#1191)", () => {
  it("no, no-NO og NO gir nb", () => {
    expect(normalizeLocale("no")).toBe("nb");
    expect(normalizeLocale("no-NO")).toBe("nb");
    expect(normalizeLocale("NO")).toBe("nb");
  });

  it("kontroll: språk som bare begynner på «no» er ikke norsk, og de gamle svarene står", () => {
    expect(normalizeLocale("nog")).toBeNull();
    expect(normalizeLocale("nb-NO")).toBe("nb");
    expect(normalizeLocale("nn-NO")).toBe("nn");
    expect(normalizeLocale("en-US")).toBe("en-GB");
    expect(normalizeLocale("da")).toBeNull();
  });

  it("Accept-Language med bare no gir nb, ikke standardspråket", () => {
    expect(resolveRequestLocale({ acceptLanguage: "no,en;q=0.5", defaultLocale: "nn" })).toBe("nb");
    expect(resolveRequestLocale({ acceptLanguage: "da", defaultLocale: "nn" })).toBe("nn");
  });
});
