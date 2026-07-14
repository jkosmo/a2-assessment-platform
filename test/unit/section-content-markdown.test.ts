import { describe, expect, it } from "vitest";
import {
  ALLOWED_VIDEO_IFRAME_HOSTS,
  isAllowedVideoEmbed,
  renderSectionMarkdown,
  sanitizeSectionHtml,
} from "../../src/modules/course/sectionContent.js";

describe("renderSectionMarkdown — basic rendering", () => {
  it("renders headings and emphasis", () => {
    const html = renderSectionMarkdown("# Tittel\n\nDette er **viktig**.");
    expect(html).toContain("<h1");
    expect(html).toContain("Tittel");
    expect(html).toContain("<strong>viktig</strong>");
  });

  it("renders lists and https links", () => {
    const html = renderSectionMarkdown("- a\n- b\n\n[lenke](https://a-2.no)");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain('href="https://a-2.no"');
  });

  it("returns empty string for empty or non-string input", () => {
    expect(renderSectionMarkdown("")).toBe("");
    expect(renderSectionMarkdown(null as unknown as string)).toBe("");
    expect(renderSectionMarkdown(undefined as unknown as string)).toBe("");
  });
});

describe("sanitisation (F3, #482)", () => {
  it("strips <script> tags and their content", () => {
    const html = renderSectionMarkdown("Hei\n\n<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  it("strips inline event handlers", () => {
    const html = sanitizeSectionHtml('<img src="https://a-2.no/x.png" onerror="alert(1)" alt="a">');
    expect(html.toLowerCase()).not.toContain("onerror");
  });

  it("strips javascript: hrefs", () => {
    const html = sanitizeSectionHtml('<a href="javascript:alert(1)">x</a>');
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("preserves images with src and alt text", () => {
    const html = sanitizeSectionHtml('<img src="https://a-2.no/f.png" alt="figur">');
    expect(html).toContain('src="https://a-2.no/f.png"');
    expect(html).toContain('alt="figur"');
  });
});

describe("embedded video iframe allowlist (X1, #493)", () => {
  it("isAllowedVideoEmbed accepts https allowlisted hosts", () => {
    expect(isAllowedVideoEmbed("https://www.youtube.com/embed/abc")).toBe(true);
    expect(isAllowedVideoEmbed("https://youtube.com/embed/abc")).toBe(true);
    expect(isAllowedVideoEmbed("https://www.youtube-nocookie.com/embed/abc")).toBe(true);
    expect(isAllowedVideoEmbed("https://player.vimeo.com/video/123")).toBe(true);
  });

  it("isAllowedVideoEmbed rejects non-https, unknown host, and malformed input", () => {
    expect(isAllowedVideoEmbed("http://www.youtube.com/embed/abc")).toBe(false);
    expect(isAllowedVideoEmbed("https://evil.com/embed/abc")).toBe(false);
    expect(isAllowedVideoEmbed("javascript:alert(1)")).toBe(false);
    expect(isAllowedVideoEmbed("not a url")).toBe(false);
    expect(isAllowedVideoEmbed("")).toBe(false);
  });

  it("keeps an allowlisted iframe embed", () => {
    const html = sanitizeSectionHtml(
      '<iframe src="https://www.youtube.com/embed/abc" title="video" allowfullscreen></iframe>',
    );
    expect(html).toContain("<iframe");
    expect(html).toContain("https://www.youtube.com/embed/abc");
  });

  it("removes an iframe from a non-allowlisted host", () => {
    const html = sanitizeSectionHtml('<iframe src="https://evil.com/x"></iframe>');
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("evil.com");
  });

  it("removes an iframe with a javascript: src", () => {
    const html = sanitizeSectionHtml('<iframe src="javascript:alert(1)"></iframe>');
    expect(html).not.toContain("<iframe");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("exposes a non-empty, frozen-ish host allowlist", () => {
    expect(ALLOWED_VIDEO_IFRAME_HOSTS.length).toBeGreaterThan(0);
    expect(ALLOWED_VIDEO_IFRAME_HOSTS).toContain("player.vimeo.com");
  });
});

describe("asset URL resolution (#483/F4)", () => {
  it("rewrites asset:<id> image sources to the serve endpoint and keeps alt text", () => {
    const html = renderSectionMarkdown("![Et bilde](asset:abc123XYZ)");
    expect(html).toContain('src="/api/content-assets/abc123XYZ"');
    expect(html).toContain('alt="Et bilde"');
    expect(html).not.toContain("asset:abc123XYZ");
  });

  it("leaves normal https image URLs untouched", () => {
    const html = renderSectionMarkdown("![x](https://a-2.no/f.png)");
    expect(html).toContain('src="https://a-2.no/f.png"');
  });

  // #754: the asset-ref grammar allows `-` and `_` (authoring sourceId is [a-zA-Z0-9_-]{1,64}).
  // The render rewrite must match the whole ref, not stop at the first hyphen.
  it("rewrites asset ids containing hyphens and underscores", () => {
    const html = renderSectionMarkdown("![Figur](asset:fig-styringslogikker_2)");
    expect(html).toContain('src="/api/content-assets/fig-styringslogikker_2"');
    expect(html).not.toContain("asset:fig-styringslogikker_2");
  });
});
