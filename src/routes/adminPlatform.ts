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
import { assessmentJobRepository } from "../modules/assessment/assessmentJobRepository.js";
import { enqueueAssessmentJob } from "../modules/assessment/AssessmentJobRunner.js";
import { prisma } from "../db/prisma.js";
import { recordAuditEvent } from "../services/auditService.js";
import { auditActions, auditEntityTypes } from "../observability/auditEvents.js";
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

// ── GET /api/admin/platform/failed-assessments (#953) ─────────────────────────
// #953: vurderinger som ga opp etter alle gjenforsøk. Lista er et LESEVINDU inn i jobber som
// allerede er `FAILED` — den oppfinner ingen tilstand og eier ingen kø. Eneste handling er å kjøre
// vurderingen på nytt, og den går gjennom `POST /api/assessments/:submissionId/run`, som fantes fra
// før. Derfor ingen skriveendepunkt her.
adminPlatformRouter.get("/failed-assessments", async (_request, response, next) => {
  try {
    // #953: lista er begrenset, telleren er ikke. Uten `total` ville en administrator sett «140» i
    // merket og 100 rader på siden, og trodd tallene var i utakt igjen.
    const LIST_LIMIT = 100;
    const [stuck, total] = await Promise.all([
      assessmentJobRepository.findStuckFailedAssessments(LIST_LIMIT),
      assessmentJobRepository.countStuckFailedAssessments(),
    ]);
    response.json({
      total,
      shown: stuck.length,
      failedAssessments: stuck.map((submission) => {
        // Nyeste feilede forsøk. Lista er per INNLEVERING, så flere feilede kjøringer er én sak
        // for administratoren — ikke én rad per forsøk.
        const lastFailure = submission.assessmentJobs[0] ?? null;
        return {
          jobId: lastFailure?.id ?? null,
          submissionId: submission.id,
          attempts: lastFailure?.attempts ?? null,
          maxAttempts: lastFailure?.maxAttempts ?? null,
          errorMessage: lastFailure?.errorMessage ?? null,
          failedAt: lastFailure?.updatedAt.toISOString() ?? null,
          submissionStatus: submission.submissionStatus,
          submittedAt: submission.submittedAt.toISOString(),
          participantName: submission.user.name,
          participantEmail: submission.user.email,
          moduleId: submission.module.id,
          moduleTitle: submission.module.title,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/admin/platform/failed-assessments/:submissionId/retry (#953) ────
//
// ⚠️ Hvorfor en EGEN rute og ikke deltakerens `POST /api/assessments/:id/run`:
// den ruten henter innleveringen med `getOwnedSubmission(submissionId, userId)`, som filtrerer på
// `where: { id, userId }` UTEN administrator-unntak. En administrator eier ikke deltakerens
// innlevering, så knappen fikk 404 hver eneste gang — hele handlingsflaten var død ved levering.
//
// Å myke opp eierskapssjekken der ville løst symptomet og svekket en invariant som gjelder alle de
// andre kallerne. Administratorhandlingen hører hjemme på administratorflaten, bak dens egen
// rollegate, og gjør nøyaktig én ting: legger jobben i kø igjen.
adminPlatformRouter.post("/failed-assessments/:submissionId/retry", async (request, response, next) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const submission = await prisma.submission.findUnique({
      where: { id: request.params.submissionId },
      select: { id: true, decisions: { select: { id: true }, take: 1 } },
    });
    if (!submission) {
      response.status(404).json({ error: "not_found", message: "Submission not found." });
      return;
    }
    // Spesifikasjonens krav 2: en innlevering som ALLEREDE har et vedtak skal ikke reprosesseres.
    // Statusen alene duger ikke som predikat — vedtaket er det som avgjør at noen har dømt.
    if (submission.decisions.length > 0) {
      response.status(409).json({
        error: "conflict",
        message: "This submission already has a decision and will not be re-assessed.",
      });
      return;
    }

    const job = await enqueueAssessmentJob(submission.id);
    await recordAuditEvent({
      entityType: auditEntityTypes.assessmentJob,
      entityId: job.id,
      action: auditActions.assessment.assessmentJobEnqueued,
      actorId,
      metadata: { submissionId: submission.id, source: "admin_failed_assessment_retry" },
    });
    response.status(202).json({ queued: true, jobId: job.id });
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
