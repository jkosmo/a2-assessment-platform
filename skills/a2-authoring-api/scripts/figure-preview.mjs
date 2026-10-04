// Makes a figure something the author can SEE — in any chat, with or without this repository.
//
// The failure it targets (reported by the product owner from a ChatGPT chat, 2026-10-04): the skill
// said "show the SVG rendered", the chat printed the SVG as tags, and the author was asked to
// approve a figure nobody had seen. The only renderer the skill named was Playwright "in the
// repo", which a sandboxed chat does not have.
//
// What it writes, for one or more figures:
//
//   <out>.html         one self-contained page. Each figure is shown the way the platform shows
//                      it — as an image — in a wide column and in a phone-width column, with a
//                      button that plays the animation again. Open it in a browser, or show it in
//                      the host's preview pane (a Claude artifact, a ChatGPT canvas).
//   <name>.still.svg   the figure AT REST, with no <style> block: colours written straight on the
//                      steps. For renderers that are not browsers (cairosvg, rsvg-convert,
//                      ImageMagick, Inkscape): they do not read CSS variables or animations, and
//                      draw an animated figure with black steps. The still file is what you hand
//                      them when you need a PNG to look at.
//
// Node stdlib only, pure functions, repo-testable. Usage:
//   node figure-preview.mjs figure.svg [figure.narrow.svg ...] [--out preview.html]
//   import { buildPreviewHtml, stillFigure } from "./figure-preview.mjs"

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { checkFigureMotion } from "./figure-motion-check.mjs";

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The figure at rest, without its <style> block. Only an animated figure — one that IS the flow
 * template, so its style block is known exactly — is rewritten; anything else is returned as it is.
 * At rest a step has the base fill and the stroke of its rule (or of its phase), so those are
 * written on the element as attributes, and the block is removed.
 */
export function stillFigure(svg) {
  const source = String(svg ?? "");
  if (!checkFigureMotion(source).animated) return source;

  const css = /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? "";
  const base = /\.steg\s*\{\s*fill:\s*([^;]+?)\s*;\s*stroke:\s*([^;}]+?)\s*;?\s*\}/.exec(css);
  if (!base) return source;
  const phases = new Map([...css.matchAll(/\.([a-z][a-z0-9-]*)\s*\{\s*--grunn:\s*(#[0-9a-fA-F]{3,6})\s*;\s*--lys:\s*(#[0-9a-fA-F]{3,6})/g)].map((m) => [m[1], { grunn: m[2], lys: m[3] }]));

  const flattened = source.replace(/<(rect|circle)\b([^>]*?)\sclass="([^"]*)"([^>]*?)(\/?)>/g, (tag, name, before, classes, after, slash) => {
    const names = classes.split(/\s+/);
    if (!names.includes("steg")) return tag;
    const phase = names.map((n) => phases.get(n)).find(Boolean);
    const fill = base[1].startsWith("var(") ? phase?.grunn : base[1];
    const stroke = base[2].startsWith("var(") ? phase?.lys : base[2];
    if (!fill || !stroke) return tag;
    return `<${name}${before} class="${classes}" fill="${fill}" stroke="${stroke}"${after}${slash}>`;
  });
  // Marked as a deliberate still picture, and as what it is: a file for looking at, not for the
  // package. The package carries the figure itself, with its animation.
  return flattened
    .replace(/\s*<style>[\s\S]*?<\/style>/, "\n  <!-- Preview only: the figure at rest. Do not put this file in the package. -->")
    .replace(/<svg\b/, '<svg data-motion="static"');
}

/**
 * One self-contained HTML page showing each figure as the platform shows it: as an image.
 * @param {Array<{ name: string, svg: string }>} figures
 */
export function buildPreviewHtml(figures, { title = "Figurer" } = {}) {
  const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  const sections = figures.map(({ name, svg }, index) => {
    const motion = checkFigureMotion(svg);
    const kind = motion.animated ? `animert, ca. ${Math.round((motion.totalSeconds ?? 0) * 10) / 10} s, går én gang` : "stillestående";
    return `<section>
  <h2>${esc(name)}</h2>
  <p class="meta">${kind} · ${Buffer.byteLength(svg, "utf8")} byte</p>
  <div class="columns">
    <figure class="wide"><figcaption>Bred spalte (PC)</figcaption><img alt="${esc(name)}" data-figure="${index}" src="${uri(svg)}"></figure>
    <figure class="phone"><figcaption>Smal spalte (telefon, 360 px)</figcaption><img alt="${esc(name)}" data-figure="${index}" src="${uri(svg)}"></figure>
  </div>
  ${motion.animated ? `<button type="button" data-replay="${index}">Spill av animasjonen på nytt</button>` : ""}
</section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --bg: #f4f2ee; --panel: #fffdf9; --fg: #1c2330; --muted: #5b6577; --line: #d9d4c8; }
  @media (prefers-color-scheme: dark) { :root { --bg: #14181f; --panel: #1b212b; --fg: #e6e9ef; --muted: #9aa4b5; --line: #2c3442; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 1000px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  h2 { font-size: 1.1rem; margin: 32px 0 0; }
  .meta, figcaption { color: var(--muted); font-size: .9rem; }
  .columns { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; margin: 8px 0; }
  figure { margin: 0; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: #fffdf9; box-sizing: border-box; }
  figure.wide { flex: 1 1 520px; min-width: 0; }
  figure.phone { width: 360px; max-width: 100%; }
  figure img { display: block; width: 100%; height: auto; margin-top: 8px; }
  button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="meta">Figurene vises som bilder, slik plattformen viser dem. Den smale spalten viser hvor liten figuren blir på en telefon.</p>
${sections}
</main>
<script>
  // An image plays its animation when it is loaded. Loading it again plays it again.
  for (const button of document.querySelectorAll("[data-replay]")) {
    button.addEventListener("click", () => {
      for (const img of document.querySelectorAll('img[data-figure="' + button.dataset.replay + '"]')) {
        const src = img.src;
        img.src = "";
        img.src = src;
      }
    });
  }
</script>
</body>
</html>
`;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : null;
  const files = outIndex >= 0 ? args.filter((arg, i) => i !== outIndex && i !== outIndex + 1) : args;
  if (files.length === 0 || (outIndex >= 0 && !out)) {
    console.error("usage: node figure-preview.mjs figure.svg [more.svg ...] [--out preview.html]");
    process.exit(2);
  }
  const figures = files.map((file) => ({ file, name: basename(file), svg: readFileSync(file, "utf8") }));
  const target = out ?? join(dirname(files[0]), "figure-preview.html");
  writeFileSync(target, buildPreviewHtml(figures), "utf8");
  console.log(`preview ${target}`);
  for (const { file, svg } of figures) {
    const stillPath = file.replace(/\.svg$/i, "") + ".still.svg";
    writeFileSync(stillPath, stillFigure(svg), "utf8");
    console.log(`still   ${stillPath}`);
  }
}
