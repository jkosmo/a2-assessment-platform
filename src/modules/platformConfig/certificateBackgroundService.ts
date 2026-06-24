import { randomUUID } from "node:crypto";

import { putAsset, getAsset } from "../course/assetStorage.js";
import { platformConfigRepository } from "./platformConfigRepository.js";
import { ValidationError } from "../../errors/AppError.js";

// #580: a single, platform-wide diploma background image rendered behind every course certificate.
// Reuses the F4 blob primitives (putAsset/getAsset) for storage and the platform key-value config
// for the reference — so no new Prisma model/migration is needed. (Per-course templates would be a
// later slice.)
// 15 MB: print-quality diploma backgrounds (e.g. A4 @ 300 DPI PNG) legitimately run large. The same
// constant bounds both the service validation and the multer upload limit (adminPlatform.ts). Note
// the image is downloaded by every participant viewing their certificate, so an optimised file loads
// faster — but the cap is generous so a real diploma export is not rejected.
export const CERTIFICATE_BACKGROUND_MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const KEY_BLOB_PATH = "certificate.background.blobPath";
const KEY_MIME_TYPE = "certificate.background.mimeType";

export async function setCertificateBackground(
  input: { filename: string; mimeType: string; buffer: Buffer },
  userId: string,
): Promise<void> {
  if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
    throw new ValidationError(
      `Unsupported image type (${input.mimeType || "unknown"}). Allowed: PNG, JPEG, GIF, WebP.`,
    );
  }
  if (input.buffer.byteLength > CERTIFICATE_BACKGROUND_MAX_BYTES) {
    throw new ValidationError(
      `Image too large (${input.buffer.byteLength} bytes, max ${CERTIFICATE_BACKGROUND_MAX_BYTES}).`,
    );
  }
  const safeName =
    (input.filename || "background").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "background";
  const blobPath = `platform/certificate-background/${randomUUID()}-${safeName}`;

  // Upload the blob first; only then point the config at it (a failed upload leaves the old
  // background intact). The previous blob is left orphaned — rare, tolerable for a v1 single image.
  await putAsset(blobPath, input.buffer, input.mimeType);
  await platformConfigRepository.setMany(
    { [KEY_BLOB_PATH]: blobPath, [KEY_MIME_TYPE]: input.mimeType },
    userId,
  );
}

export async function getCertificateBackgroundRef(): Promise<{ blobPath: string; mimeType: string } | null> {
  const config = await platformConfigRepository.getMany([KEY_BLOB_PATH, KEY_MIME_TYPE]);
  const blobPath = config[KEY_BLOB_PATH];
  const mimeType = config[KEY_MIME_TYPE];
  if (!blobPath || !mimeType) return null;
  return { blobPath, mimeType };
}

export async function getCertificateBackgroundContent(): Promise<{ mimeType: string; buffer: Buffer } | null> {
  const ref = await getCertificateBackgroundRef();
  if (!ref) return null;
  const buffer = await getAsset(ref.blobPath);
  return { mimeType: ref.mimeType, buffer };
}

export async function clearCertificateBackground(userId: string): Promise<void> {
  // Clear the reference (the blob is left in storage; harmless and avoids a delete dependency).
  await platformConfigRepository.setMany({ [KEY_BLOB_PATH]: "", [KEY_MIME_TYPE]: "" }, userId);
}

export async function hasCertificateBackground(): Promise<boolean> {
  return (await getCertificateBackgroundRef()) !== null;
}
