import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { NotFoundError, ValidationError } from "../../errors/AppError.js";
import { putAsset, getAsset } from "./assetStorage.js";
import { sanitizeSvg, svgHasText, extractSvgTexts, applySvgTextTranslations } from "./svgSanitizer.js";
import { localizeSvgTexts, type GenerationLocale } from "../adminContent/llmContentGenerationService.js";
import { SUPPORTED_LOCALES, type SupportedLocale } from "../../i18n/locale.js";

export const SVG_MIME_TYPE = "image/svg+xml";
// Raster images plus SVG. SVG is accepted ONLY after server-side sanitisation strips its
// active content (scripts, handlers, foreignObject) — see svgSanitizer.ts (#657). It was
// previously excluded outright (#483/F4) because raw SVG is an XSS vector.
export const ALLOWED_ASSET_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", SVG_MIME_TYPE];
export const MAX_ASSET_BYTES = 5 * 1024 * 1024; // 5 MB
// #749 (Layer A): total decoded-asset budget for one export envelope. Inlined blobs make the
// file large; this caps the whole course export (sum of every section's base + localized-variant
// bytes) so an export can never balloon unbounded. Export throws if exceeded — never silently drops.
export const MAX_EXPORT_ASSET_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB

export async function createSectionAsset(input: {
  sectionId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const section = await prisma.courseSection.findUnique({
    where: { id: input.sectionId },
    select: { id: true },
  });
  if (!section) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }
  if (!ALLOWED_ASSET_MIME_TYPES.includes(input.mimeType)) {
    throw new ValidationError(`Unsupported image type (${input.mimeType || "unknown"}). Allowed: PNG, JPEG, GIF, WebP, SVG.`);
  }
  if (input.buffer.byteLength > MAX_ASSET_BYTES) {
    throw new ValidationError(`Image too large (${input.buffer.byteLength} bytes, max ${MAX_ASSET_BYTES}).`);
  }

  // #657: SVG is sanitised before storage — active content (scripts, handlers, foreignObject)
  // is stripped so the stored bytes are inert. A payload that contains no usable <svg> after
  // sanitisation is rejected rather than stored.
  let storedBuffer = input.buffer;
  if (input.mimeType === SVG_MIME_TYPE) {
    const sanitized = sanitizeSvg(input.buffer.toString("utf8"));
    if (!sanitized) {
      throw new ValidationError("SVG could not be processed (empty or invalid after sanitisation).");
    }
    storedBuffer = Buffer.from(sanitized, "utf8");
  }

  const safeName = (input.filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "file";
  const blobPath = `sections/${input.sectionId}/${randomUUID()}-${safeName}`;

  // Upload binary first; only persist metadata once the blob is stored. A failed upload
  // leaves no row; a failed row-insert leaves an orphan blob (rare, tolerable for v1).
  await putAsset(blobPath, storedBuffer, input.mimeType);

  return prisma.sectionAsset.create({
    data: {
      sectionId: input.sectionId,
      filename: safeName,
      mimeType: input.mimeType,
      blobPath,
      sizeBytes: storedBuffer.byteLength,
    },
    select: { id: true, sectionId: true, filename: true, mimeType: true, sizeBytes: true },
  });
}

export async function listSectionAssets(sectionId: string) {
  return prisma.sectionAsset.findMany({
    where: { sectionId },
    orderBy: { createdAt: "asc" },
    select: { id: true, filename: true, mimeType: true, sizeBytes: true },
  });
}

function readLocalizedBlobPaths(value: unknown): Record<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, string>;
  }
  return {};
}

export async function getSectionAssetContent(
  assetId: string,
  locale?: string,
): Promise<{ mimeType: string; filename: string; buffer: Buffer }> {
  const asset = await prisma.sectionAsset.findUnique({ where: { id: assetId } });
  if (!asset) {
    throw new NotFoundError("SectionAsset", "asset_not_found", "Asset not found.");
  }
  // #657: serve the localized SVG variant for the viewer's locale when one exists; otherwise the
  // original. Raster assets and untranslated SVGs always serve the original blob.
  let blobPath = asset.blobPath;
  if (locale) {
    const variant = readLocalizedBlobPaths(asset.localizedBlobPaths)[locale];
    if (variant) blobPath = variant;
  }
  const buffer = await getAsset(blobPath);
  return { mimeType: asset.mimeType, filename: asset.filename, buffer };
}

export interface LocalizeSectionAssetsResult {
  localizedAssetCount: number;
  skippedAssetCount: number;
  targetLocales: SupportedLocale[];
}

/**
 * #657: generates translated SVG variants for every SVG asset in a section that carries text.
 * The text runs are extracted from the original, translated into each OTHER supported locale, and
 * written back into a positional copy (geometry preserved). Each variant is sanitised again and
 * stored as a sibling blob; the asset row records the source locale and the per-locale blob map.
 *
 * Idempotent (#663): an asset's base SVG is immutable (a re-upload makes a new asset), so an asset
 * that already has variants for every target locale FROM THE SAME source locale is left untouched —
 * re-translating unchanged drawings wastes LLM calls and risks introducing drift. Only newly
 * uploaded SVGs, or assets being translated from a different source locale, are (re)generated.
 */
export async function localizeSectionAssets(
  sectionId: string,
  sourceLocale: SupportedLocale,
): Promise<LocalizeSectionAssetsResult> {
  const section = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { id: true } });
  if (!section) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }

  const assets = await prisma.sectionAsset.findMany({
    where: { sectionId, mimeType: SVG_MIME_TYPE },
    select: { id: true, blobPath: true, filename: true, sourceLocale: true, localizedBlobPaths: true },
  });

  const targetLocales = SUPPORTED_LOCALES.filter((l) => l !== sourceLocale);
  let localizedAssetCount = 0;
  let skippedAssetCount = 0;

  for (const asset of assets) {
    // Already up to date for this source locale → skip (immutable base, nothing to re-translate).
    const existingVariants = readLocalizedBlobPaths(asset.localizedBlobPaths);
    if (asset.sourceLocale === sourceLocale && targetLocales.every((t) => existingVariants[t])) {
      skippedAssetCount += 1;
      continue;
    }

    const baseSvg = (await getAsset(asset.blobPath)).toString("utf8");
    if (!svgHasText(baseSvg)) continue;

    const originals = extractSvgTexts(baseSvg);
    if (originals.length === 0) continue;

    const localizedBlobPaths: Record<string, string> = {};
    for (const target of targetLocales) {
      const translated = await localizeSvgTexts({
        texts: originals,
        sourceLocale: sourceLocale as GenerationLocale,
        targetLocale: target as GenerationLocale,
      });
      const translationMap: Record<string, string> = {};
      originals.forEach((original, index) => {
        const value = translated[index];
        if (typeof value === "string" && value.length > 0) translationMap[original] = value;
      });

      const localizedSvg = applySvgTextTranslations(baseSvg, translationMap);
      if (!localizedSvg) continue;
      const variantPath = `sections/${sectionId}/${randomUUID()}-${target}-${asset.filename}`;
      await putAsset(variantPath, Buffer.from(localizedSvg, "utf8"), SVG_MIME_TYPE);
      localizedBlobPaths[target] = variantPath;
    }

    await prisma.sectionAsset.update({
      where: { id: asset.id },
      data: { sourceLocale, localizedBlobPaths },
    });
    localizedAssetCount += 1;
  }

  return { localizedAssetCount, skippedAssetCount, targetLocales };
}

// =========================================================================
// #749 (Layer A) — asset transport through export / import
// =========================================================================

// One inlined section asset ready to be serialised into an a2-content-export/v1 envelope.
export interface ExportedSectionAsset {
  sourceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
  sourceLocale?: string | null;
  localizedVariants?: Array<{ locale: string; contentBase64: string }>;
}

/**
 * #749: load every SectionAsset of a section with its blob binary (base64) plus each localized
 * SVG variant (#657), ready to inline into an export envelope. Returns the assets and the total
 * decoded byte count (base + variants) so the export builder can enforce the envelope-wide cap.
 * The `sizeBytes` reported per asset is the ACTUAL base-blob byte length (not the stored metadata),
 * so the importer can trust it.
 */
export async function loadSectionAssetsForExport(
  sectionId: string,
): Promise<{ assets: ExportedSectionAsset[]; totalBytes: number }> {
  const rows = await prisma.sectionAsset.findMany({
    where: { sectionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      blobPath: true,
      sourceLocale: true,
      localizedBlobPaths: true,
    },
  });

  const assets: ExportedSectionAsset[] = [];
  let totalBytes = 0;

  for (const row of rows) {
    const buffer = await getAsset(row.blobPath);
    totalBytes += buffer.byteLength;

    const localizedPaths = readLocalizedBlobPaths(row.localizedBlobPaths);
    const localizedVariants: Array<{ locale: string; contentBase64: string }> = [];
    for (const [locale, variantPath] of Object.entries(localizedPaths)) {
      const variantBuffer = await getAsset(variantPath);
      totalBytes += variantBuffer.byteLength;
      localizedVariants.push({ locale, contentBase64: variantBuffer.toString("base64") });
    }

    assets.push({
      sourceId: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: buffer.byteLength,
      contentBase64: buffer.toString("base64"),
      ...(row.sourceLocale ? { sourceLocale: row.sourceLocale } : {}),
      ...(localizedVariants.length > 0 ? { localizedVariants } : {}),
    });
  }

  return { assets, totalBytes };
}

// Decode + validate a single inlined blob: enforce the per-asset size cap and (for SVG) run the
// sanitiser (defence in depth — the source may be a hand-crafted or tampered file). Returns the
// bytes to store. Throws a clear ValidationError (naming the asset) on any failure.
function decodeAndValidateAssetBytes(input: {
  label: string;
  mimeType: string;
  contentBase64: string;
}): Buffer {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.contentBase64, "base64");
  } catch {
    throw new ValidationError(`Asset "${input.label}" has invalid base64 content.`);
  }
  if (buffer.byteLength === 0) {
    throw new ValidationError(`Asset "${input.label}" decoded to zero bytes.`);
  }
  if (buffer.byteLength > MAX_ASSET_BYTES) {
    throw new ValidationError(
      `Asset "${input.label}" too large (${buffer.byteLength} bytes, max ${MAX_ASSET_BYTES}).`,
    );
  }
  if (input.mimeType === SVG_MIME_TYPE) {
    const sanitized = sanitizeSvg(buffer.toString("utf8"));
    if (!sanitized) {
      throw new ValidationError(`Asset "${input.label}" SVG is empty or invalid after sanitisation.`);
    }
    return Buffer.from(sanitized, "utf8");
  }
  return buffer;
}

/**
 * #749: recreate one section's exported assets in the destination. For each asset the blob is
 * decoded, its mime is checked against the allowlist, the per-asset size cap is enforced, SVG is
 * re-sanitised (base + every localized variant), the binary is written to a FRESH blob path under
 * the new section, and a SectionAsset row is created (preserving sourceLocale + localizedBlobPaths
 * when present). Returns a `sourceId -> newAssetId` map so the caller can remap the section's
 * `asset:<sourceId>` markdown refs. Any invalid asset throws (no silent skip); the thrown error
 * names the offending asset.
 */
export async function importSectionAssets(
  sectionId: string,
  assets: ReadonlyArray<{
    sourceId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    contentBase64: string;
    sourceLocale?: string | null;
    localizedVariants?: Array<{ locale: string; contentBase64: string }>;
  }>,
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  for (const asset of assets) {
    const label = asset.filename || asset.sourceId;
    if (!ALLOWED_ASSET_MIME_TYPES.includes(asset.mimeType)) {
      throw new ValidationError(
        `Asset "${label}" has unsupported type (${asset.mimeType || "unknown"}). Allowed: PNG, JPEG, GIF, WebP, SVG.`,
      );
    }

    const storedBuffer = decodeAndValidateAssetBytes({
      label,
      mimeType: asset.mimeType,
      contentBase64: asset.contentBase64,
    });

    const safeName = (asset.filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "file";
    const blobPath = `sections/${sectionId}/${randomUUID()}-${safeName}`;
    await putAsset(blobPath, storedBuffer, asset.mimeType);

    // Localized SVG variants (#657): each becomes a sibling blob, re-sanitised for defence in depth.
    const localizedBlobPaths: Record<string, string> = {};
    for (const variant of asset.localizedVariants ?? []) {
      const variantBuffer = decodeAndValidateAssetBytes({
        label: `${label} (${variant.locale})`,
        mimeType: asset.mimeType,
        contentBase64: variant.contentBase64,
      });
      const variantPath = `sections/${sectionId}/${randomUUID()}-${variant.locale}-${safeName}`;
      await putAsset(variantPath, variantBuffer, asset.mimeType);
      localizedBlobPaths[variant.locale] = variantPath;
    }

    const created = await prisma.sectionAsset.create({
      data: {
        sectionId,
        filename: safeName,
        mimeType: asset.mimeType,
        blobPath,
        sizeBytes: storedBuffer.byteLength,
        sourceLocale: asset.sourceLocale ?? null,
        localizedBlobPaths: Object.keys(localizedBlobPaths).length > 0 ? localizedBlobPaths : undefined,
      },
      select: { id: true },
    });
    idMap.set(asset.sourceId, created.id);
  }

  return idMap;
}
