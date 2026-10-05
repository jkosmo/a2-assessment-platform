// Pictures and figures in a working package.
//
// While a course is being written, a section's `assets[]` point at FILES:
//
//   { "sourceId": "fig-flyt", "file": "figures/flyt.svg", "sourceLocale": "nb",
//     "localizedVariants": [{ "locale": "nn", "file": "figures/flyt.nn.svg" }] }
//   { "sourceId": "img-innstillinger", "file": "deck/images/slide-10-1.png" }
//
// The platform's formats carry the bytes inline (filename, mimeType, sizeBytes, contentBase64).
// Turning one into the other is the same every time, so it is done here and not by the model:
// a package with megabytes of base64 in it can no longer be read or edited in a chat, and a
// hand-made base64 string is where a picture silently goes missing.
//
// Node stdlib only. Paths are relative to the folder the package file is in.

import { readFileSync } from "node:fs";
import path from "node:path";

export const ASSET_MIME = Object.freeze({
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
});
export const SVG_MIME = "image/svg+xml";
// The platform's own limits: one picture, and all pictures of a course together (decoded bytes).
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const SOURCE_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const ASSET_REF = /\]\(asset:([^)\s]+)\)/g;

/** The name a picture is known by in the slide list: its file name, without folders. */
export function assetFileName(asset) {
  if (typeof asset?.filename === "string" && asset.filename) return asset.filename;
  if (typeof asset?.file === "string" && asset.file) return path.basename(asset.file);
  return null;
}

/** The media type of an asset, from the field or — while it still points at a file — its extension. */
export function assetMimeType(asset) {
  if (typeof asset?.mimeType === "string" && asset.mimeType) return asset.mimeType;
  if (typeof asset?.file === "string") return ASSET_MIME[path.extname(asset.file).toLowerCase()] ?? null;
  return null;
}

/**
 * A copy of the package with every `file` replaced by the bytes it points at.
 * A file that cannot be read is reported, never skipped: the entry is left without content, so the
 * checks that follow fail on it too.
 *
 * @returns {{ pkg: object, attached: number, problems: Array<{ path: string, message: string }> }}
 */
export function resolvePackageAssets(pkg, { baseDir = ".", readFile = readFileSync } = {}) {
  const resolved = structuredClone(pkg ?? {});
  const problems = [];
  let attached = 0;

  const inline = (entry, where, whole) => {
    if (!entry || typeof entry !== "object") return;
    if (typeof entry.file === "string") {
      const file = entry.file;
      delete entry.file;
      let bytes;
      try {
        bytes = Buffer.from(readFile(path.resolve(baseDir, file)));
      } catch {
        problems.push({ path: where, message: `cannot read the file "${file}" (looked in ${path.resolve(baseDir)})` });
        return;
      }
      attached += 1;
      entry.contentBase64 = bytes.toString("base64");
      if (whole) {
        entry.filename ??= path.basename(file);
        entry.mimeType ??= ASSET_MIME[path.extname(file).toLowerCase()];
        if (!entry.mimeType) {
          problems.push({ path: where, message: `"${file}" is not a picture the platform takes (svg, png, jpg, gif, webp)` });
        }
      }
    }
    if (whole && typeof entry.contentBase64 === "string") {
      entry.sizeBytes = Buffer.from(entry.contentBase64, "base64").length;
    }
  };

  for (const object of resolved.objects ?? []) {
    if (object?.type !== "section" || !Array.isArray(object.payload?.assets)) continue;
    object.payload.assets.forEach((asset, index) => {
      const where = `${object.clientRef}.assets[${index}]`;
      inline(asset, where, true);
      (asset?.localizedVariants ?? []).forEach((variant, i) => inline(variant, `${where}.localizedVariants[${i}]`, false));
      (asset?.layoutVariants ?? []).forEach((layout, l) => {
        inline(layout, `${where}.layoutVariants[${l}]`, false);
        (layout?.localizedVariants ?? []).forEach((variant, i) =>
          inline(variant, `${where}.layoutVariants[${l}].localizedVariants[${i}]`, false),
        );
      });
    });
  }
  return { pkg: resolved, attached, problems };
}

function markdownByLanguage(body) {
  if (typeof body === "string") return { "": body };
  return body && typeof body === "object" ? body : {};
}

function base64Bytes(value) {
  return typeof value === "string" ? Buffer.from(value, "base64").length : 0;
}

/**
 * Do the pictures and the text agree? Run on a package whose files are attached.
 * Every `![…](asset:<id>)` needs a picture, every picture is shown — in every language the section
 * is written in — and the sizes stay within what the platform takes.
 *
 * @returns {{ ok: boolean, count: number, totalBytes: number, problems: Array<{ path: string, message: string }> }}
 */
export function checkAssets(pkg) {
  const problems = [];
  let count = 0;
  let totalBytes = 0;

  for (const object of pkg?.objects ?? []) {
    if (object?.type !== "section") continue;
    const ref = object.clientRef;
    const assets = Array.isArray(object.payload?.assets) ? object.payload.assets : [];
    const bodies = markdownByLanguage(object.payload?.bodyMarkdown);
    const ids = new Set();

    assets.forEach((asset, index) => {
      const where = `${ref}.assets[${index}]`;
      count += 1;
      if (!SOURCE_ID.test(asset?.sourceId ?? "")) {
        problems.push({ path: where, message: `sourceId "${asset?.sourceId ?? ""}" must be 1–64 of a–z, A–Z, 0–9, _ and -` });
      } else if (ids.has(asset.sourceId)) {
        problems.push({ path: where, message: `sourceId "${asset.sourceId}" is used twice in this section` });
      }
      ids.add(asset?.sourceId);
      if (!Object.values(ASSET_MIME).includes(asset?.mimeType)) {
        problems.push({ path: where, message: `media type "${asset?.mimeType ?? "(none)"}" is not one the platform takes` });
      }
      if (typeof asset?.contentBase64 !== "string" || asset.contentBase64.length === 0) {
        problems.push({ path: where, message: "has no content — give it a `file`" });
      }
      const own = base64Bytes(asset?.contentBase64);
      if (own > MAX_ASSET_BYTES) {
        problems.push({ path: where, message: `${(own / 1024 / 1024).toFixed(1)} MB — the platform takes 5 MB per picture. Ask the author for a smaller one` });
      }
      totalBytes += own;
      for (const variant of asset?.localizedVariants ?? []) totalBytes += base64Bytes(variant?.contentBase64);
      for (const layout of asset?.layoutVariants ?? []) {
        totalBytes += base64Bytes(layout?.contentBase64);
        for (const variant of layout?.localizedVariants ?? []) totalBytes += base64Bytes(variant?.contentBase64);
      }
    });

    for (const [language, markdown] of Object.entries(bodies)) {
      const shown = new Set([...String(markdown ?? "").matchAll(ASSET_REF)].map((m) => m[1]));
      const inLanguage = language ? ` in ${language}` : "";
      for (const id of shown) {
        if (!ids.has(id)) problems.push({ path: ref, message: `the text${inLanguage} shows asset:${id}, and the section has no such picture` });
      }
      for (const id of ids) {
        if (id && !shown.has(id)) problems.push({ path: ref, message: `the picture "${id}" is not shown in the text${inLanguage} — add ![…](asset:${id}) or take the picture out` });
      }
    }
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    problems.push({ path: "package", message: `${(totalBytes / 1024 / 1024).toFixed(1)} MB of pictures — the platform takes 25 MB per course` });
  }
  return { ok: problems.length === 0, count, totalBytes, problems };
}
