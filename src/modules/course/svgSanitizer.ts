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

const purifierWindow = new JSDOM("").window;
const svgPurifier = DOMPurify(purifierWindow as unknown as Window & typeof globalThis);

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

  // The sanitised TREE, not a string: what is written out below is decided here, not by
  // DOMPurify's own serialiser.
  const cleanTree = svgPurifier.sanitize(rawSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [...FORBIDDEN_SVG_TAGS],
    // Never resolve external/data documents; keep everything self-contained.
    ADD_URI_SAFE_ATTR: [],
    RETURN_DOM: true,
  }) as unknown as Element | null;

  // A non-SVG payload yields no <svg> root, which we reject rather than store. (DOMPurify can also
  // return null, on pathologically deep nesting.)
  //
  // ⚠️ getElementsByTagName, NOT querySelector. The tree belongs to a jsdom window that lives as long
  // as the process, and a querySelector on it pins the whole tree for good: measured 2026-10-04, about
  // 1.5 MB retained per call for a 5 kB figure, against nothing with getElementsByTagName. The app
  // runs on one small instance; a course import with figures would have filled it. The guard is
  // test/unit/svg-sanitizer-memory-1083.test.ts, which measures the heap rather than the spelling.
  const root = cleanTree?.getElementsByTagName("svg")[0];
  if (!root) return "";

  // #1083: the file is served as image/svg+xml, so the browser reads it as XML — and it has to be
  // WRITTEN as XML. DOMPurify's string output is HTML serialisation, and the two disagree in ways
  // that leave the figure unreadable and therefore invisible, with no error anywhere:
  //   · a non-breaking space becomes `&nbsp;`, an entity XML does not have («§ 12», «10 %»);
  //   · a `<` in an attribute value is left bare, which XML forbids.
  // Serialising the sanitised tree as XML removes the whole class rather than its known members,
  // and declares the SVG namespace on the root as a matter of course.
  const xml = new purifierWindow.XMLSerializer().serializeToString(root);

  // The guard that makes the promise in the doc comment true: what is stored can be read back as
  // an image. A figure that cannot is rejected here, where the author is told — not stored and
  // found missing by a participant.
  return isSvgReadableAsImage(xml) ? xml : "";
}

/**
 * True when an XML parser accepts the text — which is what a browser needs to show the file as an
 * image. Exported for the #1083 repair of figures stored before sanitizeSvg wrote XML.
 */
export function isSvgReadableAsImage(xml: string): boolean {
  // Parsed in the one long-lived window: a new JSDOM per figure costs a window each time and was
  // measured to retain memory unless closed. A parser error does not throw here — it comes back as a
  // document whose root is <parsererror>, so the root is what is checked. (No querySelector: see above.)
  try {
    const root = new purifierWindow.DOMParser().parseFromString(xml, "image/svg+xml").documentElement;
    return root?.localName === "svg" && root.namespaceURI === "http://www.w3.org/2000/svg";
  } catch {
    return false;
  }
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
