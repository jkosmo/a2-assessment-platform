import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { NotFoundError, ValidationError } from "../../errors/AppError.js";
import { putAsset, getAsset } from "./assetStorage.js";

// SVG is intentionally excluded — it can carry scripts (XSS). Raster images only (#483/F4).
export const ALLOWED_ASSET_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
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
    throw new ValidationError(`Unsupported image type (${input.mimeType || "unknown"}). Allowed: PNG, JPEG, GIF, WebP.`);
  }
  if (input.buffer.byteLength > MAX_ASSET_BYTES) {
    throw new ValidationError(`Image too large (${input.buffer.byteLength} bytes, max ${MAX_ASSET_BYTES}).`);
  }

  const safeName = (input.filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "file";
  const blobPath = `sections/${input.sectionId}/${randomUUID()}-${safeName}`;

  // Upload binary first; only persist metadata once the blob is stored. A failed upload
  // leaves no row; a failed row-insert leaves an orphan blob (rare, tolerable for v1).
  await putAsset(blobPath, input.buffer, input.mimeType);

  return prisma.sectionAsset.create({
    data: {
      sectionId: input.sectionId,
      filename: safeName,
      mimeType: input.mimeType,
      blobPath,
      sizeBytes: input.buffer.byteLength,
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

export async function getSectionAssetContent(assetId: string): Promise<{ mimeType: string; filename: string; buffer: Buffer }> {
  const asset = await prisma.sectionAsset.findUnique({ where: { id: assetId } });
  if (!asset) {
    throw new NotFoundError("SectionAsset", "asset_not_found", "Asset not found.");
  }
  const buffer = await getAsset(asset.blobPath);
  return { mimeType: asset.mimeType, filename: asset.filename, buffer };
}
