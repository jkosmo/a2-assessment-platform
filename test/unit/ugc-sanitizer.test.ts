import { describe, expect, it } from "vitest";
import {
  renderDiscussionMarkdown,
  sanitizeUserGeneratedHtml,
} from "../../src/modules/discussion/userGeneratedContentSanitizer.js";

// #495/T-QA-2: UGC i diskusjoner må rendres strammere enn seksjoner — uten iframe/rå-HTML.
describe("renderDiscussionMarkdown (UGC sanitizer)", () => {
  it("renderer grunnleggende markdown (fet, kursiv, lister, kode, lenker)", () => {
    const html = renderDiscussionMarkdown(
      "**fet** og *kursiv*\n\n- a\n- b\n\n`kode` og [lenke](https://example.com)",
    );
    expect(html).toContain("<strong>fet</strong>");
    expect(html).toContain("<em>kursiv</em>");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<code>kode</code>");
    expect(html).toContain('href="https://example.com"');
  });

  it("tvinger trygg rel/target på lenker", () => {
    const html = renderDiscussionMarkdown("[x](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("fjerner iframe (i motsetning til seksjons-render)", () => {
    const html = sanitizeUserGeneratedHtml(
      '<p>hei</p><iframe src="https://www.youtube.com/embed/x"></iframe>',
    );
    expect(html).toContain("<p>hei</p>");
    expect(html.toLowerCase()).not.toContain("<iframe");
  });

  it("stripper script og inline event-handlere", () => {
    const html = sanitizeUserGeneratedHtml(
      '<p onclick="evil()">x</p><script>alert(1)</script>',
    );
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html.toLowerCase()).not.toContain("onclick");
  });

  it("stripper javascript:-lenker", () => {
    const html = sanitizeUserGeneratedHtml('<a href="javascript:alert(1)">x</a>');
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("fjerner bilder (ingen img i UGC)", () => {
    const html = sanitizeUserGeneratedHtml('<img src="https://example.com/a.png">');
    expect(html.toLowerCase()).not.toContain("<img");
  });

  it("returnerer tom streng for tom/ugyldig input", () => {
    expect(renderDiscussionMarkdown("")).toBe("");
    expect(sanitizeUserGeneratedHtml("")).toBe("");
    // @ts-expect-error bevisst feil type
    expect(renderDiscussionMarkdown(null)).toBe("");
  });
});
