import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { marked } from "marked";

/**
 * Markdown rendering + sanitisation for course learning sections (#476).
 *
 * SMO-authored markdown is never trusted: it is rendered to HTML with `marked`
 * and then sanitised server-side with DOMPurify before it ever reaches a
 * participant. This module is intentionally pure (no DB, no I/O) so it can be
 * unit-tested in isolation.
 *
 * Baseline policy (F3, #482): scripts, inline event handlers, and dangerous
 * URI schemes (`javascript:`, unvetted `data:`) are stripped. Iframes are
 * rejected by default.
 *
 * Embedded video (X1, #493): iframes are permitted ONLY when their `src` is an
 * HTTPS URL whose host is on {@link ALLOWED_VIDEO_IFRAME_HOSTS}. Every other
 * iframe is removed. Blanket iframe support is deliberately avoided because it
 * is an XSS / clickjacking vector.
 */

/**
 * Hosts allowed as embedded `<iframe>` video sources. Kept deliberately small;
 * extend consciously. Tenant-specific hosts (e.g. SharePoint-hosted Stream)
 * are not statically allowlistable and are out of scope here.
 */
export const ALLOWED_VIDEO_IFRAME_HOSTS: readonly string[] = [
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "player.vimeo.com",
];

/**
 * Returns true only for an HTTPS URL whose host is on the video allowlist.
 * Malformed input, non-HTTPS schemes, and unknown hosts all return false.
 */
export function isAllowedVideoEmbed(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return ALLOWED_VIDEO_IFRAME_HOSTS.includes(url.hostname.toLowerCase());
}

const purifier = DOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis);

// Strip any iframe whose src is not an allowlisted video embed. Runs for every
// sanitise call on this single shared instance.
purifier.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName !== "iframe") return;
  const element = node as Element;
  const src = element.getAttribute("src") ?? "";
  if (!isAllowedVideoEmbed(src)) {
    element.parentNode?.removeChild(element);
  }
});

/**
 * Sanitises raw HTML using the course-section policy. Exposed separately from
 * {@link renderSectionMarkdown} so callers that already hold HTML (e.g. a live
 * preview) can reuse the exact same policy.
 */
export function sanitizeSectionHtml(html: string): string {
  if (typeof html !== "string" || html.length === 0) return "";
  return purifier.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling", "title", "target", "rel"],
  });
}

// Rewrites `asset:<id>` image sources (authored as `![alt](asset:<id>)`, #483/F4) to the
// authenticated serve endpoint. Runs BEFORE sanitisation so DOMPurify sees a normal relative
// URL (the `asset:` scheme would otherwise be stripped as an unknown protocol). The indirection
// keeps references portable for cross-environment export/import (ids can be remapped).
// When a locale is supplied (#657), it is appended as `?locale=` so the serve endpoint can return
// the translated SVG variant for that language pane (raster/untranslated assets ignore it).
function resolveAssetUrls(html: string, locale?: string): string {
  const suffix = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  return html.replace(/(<img\b[^>]*\bsrc=")asset:([a-zA-Z0-9]+)(")/gi, `$1/api/content-assets/$2${suffix}$3`);
}

/**
 * Renders SMO-authored markdown to sanitised HTML safe to inject into the
 * participant view. Returns an empty string for empty / non-string input.
 * `locale` (optional) selects translated SVG asset variants for that language.
 */
export function renderSectionMarkdown(markdownInput: string, locale?: string): string {
  if (typeof markdownInput !== "string" || markdownInput.length === 0) return "";
  const rawHtml = marked.parse(markdownInput, { async: false }) as string;
  return sanitizeSectionHtml(resolveAssetUrls(rawHtml, locale));
}
