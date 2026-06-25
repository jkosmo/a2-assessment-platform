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
  targetLocales: SupportedLocale[];
}

/**
 * #657: generates translated SVG variants for every SVG asset in a section that carries text.
 * The text runs are extracted from the original, translated into each OTHER supported locale, and
 * written back into a positional copy (geometry preserved). Each variant is sanitised again and
 * stored as a sibling blob; the asset row records the source locale and the per-locale blob map.
 * Idempotent: re-running re-translates from the (new) source locale and overwrites the variants.
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
    select: { id: true, blobPath: true, filename: true },
  });

  const targetLocales = SUPPORTED_LOCALES.filter((l) => l !== sourceLocale);
  let localizedAssetCount = 0;

  for (const asset of assets) {
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

  return { localizedAssetCount, targetLocales };
}
