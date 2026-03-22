import { Router } from "express";
import { z } from "zod";
import { getConsentConfig, upsertConsentConfig } from "../modules/platformConfig/consentConfigService.js";
import { platformConfigRepository } from "../modules/platformConfig/platformConfigRepository.js";
import { DEFAULT_CONSENT_BODY } from "../config/consent.js";

const adminPlatformRouter = Router();

// ── GET /api/admin/platform ──────────────────────────────────────────────────
// Returns current platform configuration for the admin settings page.
adminPlatformRouter.get("/", async (_request, response, next) => {
  try {
    const keys = ["platform.name", "dpo.name", "dpo.email"];
    const config = await platformConfigRepository.getMany(keys);

    response.json({
      platformName: config["platform.name"] ?? "",
      dpoName: config["dpo.name"] ?? "",
      dpoEmail: config["dpo.email"] ?? "",
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
  });

  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const { platformName, dpoName, dpoEmail, consentBody } = parsed.data;

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

    response.json({ saved: true });
  } catch (error) {
    next(error);
  }
});

export { adminPlatformRouter };
