import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";

/**
 * Server-side SVG sanitisation for section assets (#657 / #483/F4).
 *
 * SVG is XML and can carry active content — `<script>`, inline `on*` event
 * handlers, `javascript:` URIs, `<foreignObject>` (embeds XHTML/iframes), and
 * external references. Raster images cannot. Because section images render via
 * `<img src="/api/content-assets/<id>">`, an `<img>`-loaded SVG already runs in
 * the browser's "secure static" mode (no scripts), but a victim navigated
 * DIRECTLY to the asset URL would get the SVG rendered as a same-origin document
 * where scripts WOULD run. This module is the primary defence: every uploaded SVG
 * is sanitised here before it is ever stored, so the bytes on disk are inert.
 * (The serve endpoint adds CSP + nosniff as defence-in-depth.)
 *
 * Intentionally pure (no DB, no I/O) so it can be unit-tested against XSS vectors
 * in isolation.
 */

const svgPurifier = DOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis);

// `<a>`, `<foreignObject>`, and `<script>` are removed outright. Drawings do not need
// hyperlinks, and both foreignObject (embeds arbitrary XHTML/iframes) and script are
// classic SVG XSS vectors. DOMPurify already strips `on*` handlers and `javascript:`
// URIs by default; forbidding these tags closes the remaining holes.
const FORBIDDEN_SVG_TAGS = ["script", "foreignObject", "a"] as const;

/**
 * Sanitises a raw SVG document, returning safe SVG markup or an empty string if
 * the input is not a usable SVG. The returned markup is guaranteed to contain a
 * root `<svg>` element with an `xmlns` so it renders when loaded via `<img>`.
 */
export function sanitizeSvg(rawSvg: string): string {
  if (typeof rawSvg !== "string" || rawSvg.trim().length === 0) return "";

  const clean = svgPurifier.sanitize(rawSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [...FORBIDDEN_SVG_TAGS],
    // Never resolve external/data documents; keep everything self-contained.
    ADD_URI_SAFE_ATTR: [],
  });

  // DOMPurify returns a string in HTML serialisation; a non-SVG payload yields no
  // <svg> root, which we reject rather than store.
  if (!/<svg[\s>]/i.test(clean)) return "";

  // Some DOMPurify/jsdom versions drop the SVG namespace when serialising in HTML
  // mode; re-add it so the file renders as an image. No-op when already present.
  return ensureSvgNamespace(clean);
}

function ensureSvgNamespace(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/i, (match, attrs: string) => {
    if (/\bxmlns\s*=/.test(attrs)) return match;
    return `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>`;
  });
}

// ---------------------------------------------------------------------------
// SVG text localisation (#657)
// ---------------------------------------------------------------------------
// Section drawings may carry baked-in <text>/<tspan> labels. To localise an SVG we extract those
// text runs in document order, translate them, and write them back into the same positions — the
// geometry is untouched, so layout is preserved (the author still verifies per-locale visually,
// because translated strings do not reflow). Extraction and re-application share the same ordered
// walk so indices line up exactly.

const SVG_TEXT_SELECTOR = "text, tspan, textPath, title";

function svgTextNodes(doc: Document): Element[] {
  const svg = doc.querySelector("svg");
  if (!svg) return [];
  // Only leaf-level text content: a <text> that contains <tspan> children contributes its tspans,
  // not its own concatenated text, so we never translate the same run twice.
  return Array.from(svg.querySelectorAll(SVG_TEXT_SELECTOR)).filter((el) => {
    const hasElementChildren = Array.from(el.children).some((child) =>
      /^(tspan|textPath)$/i.test(child.tagName),
    );
    return !hasElementChildren && (el.textContent ?? "").trim().length > 0;
  });
}

function parseSvgDoc(svg: string): Document {
  // jsdom parses SVG inside an HTML document fine for our read/write needs.
  return new JSDOM(svg, { contentType: "text/html" }).window.document;
}

/** True if the SVG has at least one non-empty translatable text run. */
export function svgHasText(svg: string): boolean {
  if (typeof svg !== "string" || svg.trim().length === 0) return false;
  try {
    return svgTextNodes(parseSvgDoc(svg)).length > 0;
  } catch {
    return false;
  }
}

/** Extracts translatable text runs in document order (deduplicated for a smaller translation payload). */
export function extractSvgTexts(svg: string): string[] {
  if (typeof svg !== "string" || svg.trim().length === 0) return [];
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const node of svgTextNodes(parseSvgDoc(svg))) {
    const value = (node.textContent ?? "").trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      texts.push(value);
    }
  }
  return texts;
}

/**
 * Returns a new SVG with each original text run replaced by its translation. `translations` maps
 * the trimmed original string → translated string; runs without a mapping are left as-is. The
 * result is re-sanitised so a localisation round-trip can never reintroduce active content.
 */
export function applySvgTextTranslations(svg: string, translations: Record<string, string>): string {
  if (typeof svg !== "string" || svg.trim().length === 0) return "";
  const doc = parseSvgDoc(svg);
  for (const node of svgTextNodes(doc)) {
    const original = (node.textContent ?? "").trim();
    const translated = translations[original];
    if (translated !== undefined && translated !== "") {
      node.textContent = translated;
    }
  }
  const svgEl = doc.querySelector("svg");
  const serialized = svgEl ? svgEl.outerHTML : "";
  return sanitizeSvg(serialized);
}
