import { describe, expect, it } from "vitest";
import {
  SECTION_EDITOR_LOCALES,
  nonEmptyLocales,
  hasSavableContent,
  detectSectionRoute,
} from "../../public/static/admin-content-sections-state.js";

// #524 (U1): coverage for the section editor's pure locale-validation logic. This is the class of bug
// the manual retest kept finding — most notably «empty locale → 400»: sending a locale key with an
// empty/whitespace string makes the API reject the save. nonEmptyLocales must drop those; the editor
// must refuse to save until BOTH title and body have at least one real locale.

describe("section editor locale validation (#524)", () => {
  it("exposes the three editor locales", () => {
    expect(SECTION_EDITOR_LOCALES).toEqual(["nb", "nn", "en-GB"]);
  });

  describe("nonEmptyLocales", () => {
    it("keeps only locales with real (trimmed, non-empty) content", () => {
      expect(nonEmptyLocales({ nb: "Hei", nn: "", "en-GB": "   " })).toEqual({ nb: "Hei" });
    });

    it("drops whitespace-only locales (the «empty locale → 400» guard)", () => {
      expect(nonEmptyLocales({ nb: "\n\t ", nn: "", "en-GB": "" })).toEqual({});
    });

    it("keeps all filled locales and never emits an empty string", () => {
      const result = nonEmptyLocales({ nb: "a", nn: "b", "en-GB": "c" });
      expect(result).toEqual({ nb: "a", nn: "b", "en-GB": "c" });
      expect(Object.values(result).every((v) => v.length > 0)).toBe(true);
    });

    it("tolerates missing/undefined input", () => {
      expect(nonEmptyLocales(undefined)).toEqual({});
      expect(nonEmptyLocales({})).toEqual({});
    });
  });

  describe("hasSavableContent", () => {
    it("requires at least one non-empty locale in BOTH title and body", () => {
      expect(hasSavableContent({ nb: "T" }, { nb: "B" })).toBe(true);
      expect(hasSavableContent({ nb: "T" }, { nb: "", nn: "  " })).toBe(false); // body empty
      expect(hasSavableContent({ nb: "" }, { nb: "B" })).toBe(false); // title empty
      expect(hasSavableContent({}, {})).toBe(false);
    });

    it("allows title and body to be filled in different locales (partial object is valid)", () => {
      expect(hasSavableContent({ nb: "Tittel" }, { "en-GB": "Body" })).toBe(true);
    });
  });

  describe("detectSectionRoute", () => {
    it("routes ?new to a blank editor", () => {
      expect(detectSectionRoute("?new")).toEqual({ view: "editor", sectionId: null });
    });

    it("routes ?id=… to the editor for that section", () => {
      expect(detectSectionRoute("?id=sec-123")).toEqual({ view: "editor", sectionId: "sec-123" });
    });

    it("routes an empty/unknown query to the list", () => {
      expect(detectSectionRoute("")).toEqual({ view: "list" });
      expect(detectSectionRoute("?foo=bar")).toEqual({ view: "list" });
      expect(detectSectionRoute(undefined)).toEqual({ view: "list" });
    });
  });
});
