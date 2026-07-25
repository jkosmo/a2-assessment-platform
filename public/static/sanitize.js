// #814: client-side re-sanitization of learning-section HTML — defense-in-depth.
//
// The section HTML is ALREADY sanitized server-side (src/modules/course/sectionContent.ts, the "F3/X1"
// policy: DOMPurify + `ADD_TAGS:["iframe"]` + a video-embed host allowlist). This module re-applies the
// SAME policy in the browser before the string reaches an innerHTML sink, so a server bug / an
// unsanitized response can't inject markup. The server CSP is `script-src 'self'` with no inline script,
// so injected <script>/on*-handlers can't execute anyway — the residual risk this closes is markup/UI
// injection (content spoofing, layout/link injection), not script XSS.
//
// It must MATCH the server allowlist (NOT a blanket DOMPurify default, which would strip the allowed
// YouTube/Vimeo section embeds). DOMPurify is vendored locally (CSP forbids external CDNs).
import DOMPurify from "/static/vendor/purify-3.4.10.es.js";

// Mirror of src/modules/course/sectionContent.ts ALLOWED_VIDEO_IFRAME_HOSTS — keep in sync.
const ALLOWED_VIDEO_IFRAME_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "player.vimeo.com",
]);

function isAllowedVideoEmbed(src) {
  try {
    const url = new URL(src, window.location.origin);
    return url.protocol === "https:" && ALLOWED_VIDEO_IFRAME_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

// Drop any <iframe> whose src is not an allowed https video embed (mirrors the server's
// uponSanitizeElement hook). Registered only around a sanitize() call so it never leaks to other callers.
function iframeGuard(node, data) {
  if (data.tagName === "iframe" && !isAllowedVideoEmbed(node.getAttribute("src") || "")) {
    node.parentNode?.removeChild(node);
  }
}

/**
 * Sanitize server-rendered learning-section HTML with the same allowlist the server uses.
 * @param {string} html
 * @returns {string} sanitized HTML safe to assign to innerHTML
 */
export function sanitizeSectionHtml(html) {
  DOMPurify.addHook("uponSanitizeElement", iframeGuard);
  try {
    return DOMPurify.sanitize(html ?? "", {
      // Match sectionContent.ts: default allowlist PLUS iframe + the embed attributes.
      ADD_TAGS: ["iframe"],
      ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling", "title", "target", "rel"],
    });
  } finally {
    DOMPurify.removeHook("uponSanitizeElement");
  }
}
