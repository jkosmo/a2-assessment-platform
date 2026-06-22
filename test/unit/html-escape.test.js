import { describe, it, expect } from "vitest";
import { escapeHtml } from "../../public/static/html-escape.js";

// #596 slice 1: pins the consolidated escapeHtml behaviour — including what it deliberately does
// NOT do (single quotes), which is the documented divergence from the sections variant.
describe("escapeHtml (shared, #596)", () => {
  it("escapes the four dangerous HTML chars", () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });

  it("escapes ampersand first so existing entities are not double-mangled inconsistently", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("null/undefined become an empty string (the ?? \"\" guard)", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("coerces non-string values via String()", () => {
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(0)).toBe("0");
  });

  it("does NOT escape single quotes (matches the 6 consolidated variants, not sections)", () => {
    expect(escapeHtml("it's a 'quote'")).toBe("it's a 'quote'");
  });

  it("leaves safe text unchanged", () => {
    expect(escapeHtml("Fagforeninger og tariff")).toBe("Fagforeninger og tariff");
  });
});
