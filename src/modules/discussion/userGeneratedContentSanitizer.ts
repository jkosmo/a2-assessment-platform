import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { marked } from "marked";

/**
 * Markdown rendering + sanitisation for user-generated discussion content (#495/T-QA-2).
 *
 * This is deliberately SEPARATE from {@link ../course/sectionContent.ts} and far stricter.
 * Section content is SMO-authored (trusted authors, reviewed) and may embed allowlisted
 * video iframes (#493). Discussion threads/replies are participant-generated content (UGC)
 * from anyone with course access — so the policy here is the most restrictive that still
 * supports basic markdown formatting:
 *
 *   - NO iframes, NO raw HTML passthrough, NO images, NO scripts/event handlers.
 *   - Allowed: paragraphs, line breaks, bold/italic/strikethrough, inline + block code,
 *     blockquotes, ordered/unordered lists, links, and small headings.
 *   - Links are forced to `rel="noopener noreferrer"` + `target="_blank"`; dangerous URI
 *     schemes (`javascript:`, unvetted `data:`) are stripped by DOMPurify.
 *
 * Pure module (no DB, no I/O) so it can be unit-tested in isolation.
 */

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
] as const;

const ugcPurifier = DOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis);

// Harden every surviving link: open in a new tab without leaking the opener, and never
// trust the author's own rel/target. DOMPurify has already stripped javascript:/data: hrefs.
ugcPurifier.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "A") {
    const element = node as Element;
    element.setAttribute("target", "_blank");
    element.setAttribute("rel", "noopener noreferrer");
  }
});

/**
 * Sanitises raw HTML with the strict UGC policy. Exposed separately from
 * {@link renderDiscussionMarkdown} so a caller already holding HTML can reuse the exact
 * same policy. Returns an empty string for empty / non-string input.
 */
export function sanitizeUserGeneratedHtml(html: string): string {
  if (typeof html !== "string" || html.length === 0) return "";
  return ugcPurifier.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: ["href"],
    ALLOW_DATA_ATTR: false,
    // Belt-and-suspenders: even if a tag slipped into ALLOWED_TAGS, never allow these.
    FORBID_TAGS: ["iframe", "script", "style", "img", "form", "input"],
  });
}

/**
 * Renders participant-authored markdown to sanitised HTML safe to inject into the
 * discussion view. Returns an empty string for empty / non-string input.
 */
export function renderDiscussionMarkdown(markdownInput: string): string {
  if (typeof markdownInput !== "string" || markdownInput.length === 0) return "";
  const rawHtml = marked.parse(markdownInput, { async: false }) as string;
  return sanitizeUserGeneratedHtml(rawHtml);
}
