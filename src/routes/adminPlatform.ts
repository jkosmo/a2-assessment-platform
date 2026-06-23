import { Router, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import {
  getActiveConsentVersion,
  bumpConsentVersion,
  upsertConsentConfig,
} from "../modules/platformConfig/consentConfigService.js";
import { platformConfigRepository } from "../modules/platformConfig/platformConfigRepository.js";
import {
  setCertificateBackground,
  clearCertificateBackground,
  hasCertificateBackground,
  CERTIFICATE_BACKGROUND_MAX_BYTES,
} from "../modules/platformConfig/certificateBackgroundService.js";
import { AppError } from "../errors/AppError.js";
import { DEFAULT_CONSENT_BODY } from "../config/consent.js";

const adminPlatformRouter = Router();

// In-memory upload for the platform-wide certificate background (#580). Multer errors
// (incl. file-too-large) → 400.
const uploadBackgroundMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CERTIFICATE_BACKGROUND_MAX_BYTES, files: 1 },
}).single("file");
const uploadBackground: RequestHandler = (request, response, next) => {
  uploadBackgroundMiddleware(request, response, (err: unknown) => {
    if (err) {
      response.status(400).json({ error: "upload_error", message: err instanceof Error ? err.message : "Upload failed." });
      return;
    }
    next();
  });
};

// ── GET /api/admin/platform ──────────────────────────────────────────────────
// Returns current platform configuration for the admin settings page.
adminPlatformRouter.get("/", async (_request, response, next) => {
  try {
    const keys = ["platform.name", "dpo.name", "dpo.email", "consent.body.en-GB", "consent.body.nb", "consent.body.nn"];
    const [config, consentVersion, certificateBackground] = await Promise.all([
      platformConfigRepository.getMany(keys),
      getActiveConsentVersion(),
      hasCertificateBackground(),
    ]);

    response.json({
      platformName: config["platform.name"] ?? "",
      dpoName: config["dpo.name"] ?? "",
      dpoEmail: config["dpo.email"] ?? "",
      certificateBackground,
      consentVersion,
      consentBody: {
        "en-GB": config["consent.body.en-GB"] ?? DEFAULT_CONSENT_BODY["en-GB"] ?? "",
        nb: config["consent.body.nb"] ?? DEFAULT_CONSENT_BODY["nb"] ?? "",
        nn: config["consent.body.nn"] ?? DEFAULT_CONSENT_BODY["nn"] ?? "",
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── PUT /api/admin/platform ──────────────────────────────────────────────────
// Updates platform configuration. All fields are optional.
adminPlatformRouter.put("/", async (request, response, next) => {
  const userId = request.context?.userId;

  const bodySchema = z.object({
    platformName: z.string().optional(),
    dpoName: z.string().optional(),
    dpoEmail: z.string().email().or(z.literal("")).optional(),
    consentBody: z
      .object({
        "en-GB": z.string().optional(),
        nb: z.string().optional(),
        nn: z.string().optional(),
      })
      .optional(),
    bumpVersion: z.boolean().optional(),
  });

  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const { platformName, dpoName, dpoEmail, consentBody, bumpVersion } = parsed.data;

  try {
    await upsertConsentConfig(
      {
        platformName,
        dpoName,
        dpoEmail,
        bodyEnGb: consentBody?.["en-GB"],
        bodyNb: consentBody?.nb,
        bodyNn: consentBody?.nn,
      },
      userId ?? "system",
    );

    let newConsentVersion: string | undefined;
    if (bumpVersion) {
      newConsentVersion = await bumpConsentVersion(userId ?? "system");
    }

    response.json({ saved: true, ...(newConsentVersion !== undefined ? { consentVersion: newConsentVersion } : {}) });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/admin/platform/certificate-background (#580) ────────────────────
// Upload/replace the platform-wide diploma background shown behind every course certificate.
adminPlatformRouter.post("/certificate-background", uploadBackground, async (request, response, next) => {
  const userId = request.context?.userId;
  if (!request.file) {
    response.status(400).json({ error: "no_file", message: "No image uploaded (field 'file')." });
    return;
  }
  try {
    await setCertificateBackground(
      { filename: request.file.originalname, mimeType: request.file.mimetype, buffer: request.file.buffer },
      userId ?? "system",
    );
    response.status(201).json({ saved: true });
  } catch (error) {
    if (error instanceof AppError) {
      response.status(error.httpStatus).json({ error: error.code, message: error.message });
      return;
    }
    next(error);
  }
});

// ── DELETE /api/admin/platform/certificate-background (#580) ───────────────────
adminPlatformRouter.delete("/certificate-background", async (request, response, next) => {
  try {
    await clearCertificateBackground(request.context?.userId ?? "system");
    response.json({ removed: true });
  } catch (error) {
    next(error);
  }
});

export { adminPlatformRouter };
