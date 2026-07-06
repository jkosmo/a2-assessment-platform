import { Router, type Request, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import {
  createSection,
  updateSectionTitle,
  updateSectionContent,
  getSection,
  listSections,
  publishSection,
  unpublishSection,
  archiveSection,
  restoreSection,
  deleteSection,
  createSectionAsset,
  listSectionAssets,
  localizeSectionAssets,
  MAX_ASSET_BYTES,
} from "../modules/course/index.js";
import { findCoursesForSections } from "../modules/course/contentLifecycle.js";
import { localizedTextPatchSchema, generationLocaleSchema, clientRefSchema, agentRunIdSchema } from "../modules/adminContent/adminContentSchemas.js";
import { sectionAdminLinks } from "../modules/adminContent/adminUiLinks.js";
import { localizedTextCodec } from "../codecs/localizedTextCodec.js";
import { NotFoundError } from "../errors/AppError.js";
import { renderSectionMarkdown } from "../modules/course/sectionContent.js";
import { localizeSectionContent } from "../modules/adminContent/llmContentGenerationService.js";
import { generateLimiter } from "../middleware/rateLimiting.js";

const adminSectionsRouter = Router();

// In-memory upload (buffer streamed to blob). Multer errors (incl. file-too-large) → 400.
const uploadAssetMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ASSET_BYTES, files: 1 },
}).single("file");
const uploadAsset: RequestHandler = (request, response, next) => {
  uploadAssetMiddleware(request, response, (err: unknown) => {
    if (err) {
      response.status(400).json({ error: "upload_error", message: err instanceof Error ? err.message : "Upload failed." });
      return;
    }
    next();
  });
};

const createSectionSchema = z.object({
  title: localizedTextPatchSchema,
  bodyMarkdown: localizedTextPatchSchema,
  // AA-2 (#650): agents create sections as drafts (activeVersionId stays null)
  // and get their plan-ref echoed back. Default keeps auto-publish-on-save.
  draft: z.boolean().optional(),
  clientRef: clientRefSchema.optional(),
  // AA-5 (#653): stamped into the create's audit event (source: agent_authoring).
  agentRunId: agentRunIdSchema.optional(),
});
const titleSchema = z.object({ title: localizedTextPatchSchema });
const contentSchema = z.object({ bodyMarkdown: localizedTextPatchSchema });
const previewSchema = z.object({ markdown: z.string(), locale: generationLocaleSchema.optional() });
const localizeSchema = z.object({
  title: z.string().trim().min(1).optional(),
  bodyMarkdown: z.string().trim().min(1).optional(),
  sourceLocale: generationLocaleSchema,
  targetLocale: generationLocaleSchema,
}).refine((v) => Boolean(v.title || v.bodyMarkdown), { message: "At least one field is required." });

type SectionWithActiveVersion = {
  id: string;
  title: string;
  activeVersionId: string | null;
  archivedAt: Date | null;
  updatedAt: Date;
  activeVersion?: { bodyMarkdown?: string; versionNo: number } | null;
};

function toDetail(section: SectionWithActiveVersion) {
  return {
    id: section.id,
    title: section.title,
    activeVersionId: section.activeVersionId,
    versionNo: section.activeVersion?.versionNo ?? null,
    bodyMarkdown: section.activeVersion?.bodyMarkdown ?? null,
    updatedAt: section.updatedAt.toISOString(),
    archivedAt: section.archivedAt?.toISOString() ?? null,
  };
}

adminSectionsRouter.post("/", async (request, response, next) => {
  const parsed = createSectionSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const section = await createSection({
      title: localizedTextCodec.serialize(parsed.data.title),
      bodyMarkdown: localizedTextCodec.serialize(parsed.data.bodyMarkdown),
      actorId: request.context?.userId,
      draft: parsed.data.draft,
      agent: { clientRef: parsed.data.clientRef, agentRunId: parsed.data.agentRunId },
    });
    response.status(201).json({
      section: toDetail(section),
      links: sectionAdminLinks(section.id),
      ...(parsed.data.clientRef !== undefined ? { clientRef: parsed.data.clientRef } : {}),
    });
  } catch (error) {
    next(error);
  }
});

// Live preview for the editor (U1) — renders markdown to sanitised HTML with the
// exact same F3/X1 policy the participant view will use, so authors see the truth.
adminSectionsRouter.post("/preview", async (request, response, next) => {
  const parsed = previewSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    response.json({ html: renderSectionMarkdown(parsed.data.markdown, parsed.data.locale) });
  } catch (error) {
    next(error);
  }
});

// Explicit LLM translation assist (#514) — translate title + bodyMarkdown from
// one locale to another; the author reviews/edits the result before saving.
adminSectionsRouter.post("/localize", generateLimiter, async (request, response, next) => {
  const parsed = localizeSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    if (parsed.data.sourceLocale === parsed.data.targetLocale) {
      response.json({ title: parsed.data.title, bodyMarkdown: parsed.data.bodyMarkdown });
      return;
    }
    const result = await localizeSectionContent(parsed.data);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

adminSectionsRouter.get("/", async (_request, response, next) => {
  try {
    const sections = await listSections();
    // #705-UX(G): «Brukt i kurs»-kolonne med popover (likt modul-biblioteket).
    const coursesBySection = await findCoursesForSections(sections.map((s) => s.id));
    response.json({
      sections: sections.map((s) => {
        const courses = coursesBySection.get(s.id) ?? [];
        return {
          id: s.id,
          title: s.title,
          // #705: status-merkelappen i lista trenger activeVersionId (Publisert vs Utkast).
          activeVersionId: s.activeVersionId,
          versionNo: s.activeVersion?.versionNo ?? null,
          updatedAt: s.updatedAt.toISOString(),
          archivedAt: s.archivedAt?.toISOString() ?? null,
          courseCount: courses.length,
          courses,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

adminSectionsRouter.get("/:sectionId", async (request, response, next) => {
  try {
    const section = await getSection(request.params.sectionId);
    if (!section) {
      throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
    }
    response.json({ section: toDetail(section) });
  } catch (error) {
    next(error);
  }
});

adminSectionsRouter.patch("/:sectionId/title", async (request, response, next) => {
  const parsed = titleSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const section = await updateSectionTitle(
      request.params.sectionId,
      localizedTextCodec.serialize(parsed.data.title),
    );
    response.json({ section: toDetail(section) });
  } catch (error) {
    next(error);
  }
});

adminSectionsRouter.put("/:sectionId/content", async (request, response, next) => {
  const parsed = contentSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const section = await updateSectionContent(
      request.params.sectionId,
      localizedTextCodec.serialize(parsed.data.bodyMarkdown),
      request.context?.userId,
    );
    response.json({ section: toDetail(section) });
  } catch (error) {
    next(error);
  }
});

// Asset upload (#483/F4) — multipart image upload to a section's blob storage.
adminSectionsRouter.post("/:sectionId/assets", uploadAsset, async (request: Request<{ sectionId: string }>, response, next) => {
  const file = request.file;
  if (!file) {
    response.status(400).json({ error: "validation_error", message: "Missing file (field name 'file')." });
    return;
  }
  try {
    const asset = await createSectionAsset({
      sectionId: request.params.sectionId,
      filename: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
    });
    // The author references the asset in markdown as ![alt](asset:<id>).
    response.status(201).json({ asset: { ...asset, ref: `asset:${asset.id}` } });
  } catch (error) {
    next(error);
  }
});

adminSectionsRouter.get("/:sectionId/assets", async (request, response, next) => {
  try {
    response.json({ assets: await listSectionAssets(request.params.sectionId) });
  } catch (error) {
    next(error);
  }
});

// #657: generate translated SVG variants for the section's SVG assets. Triggered explicitly by the
// author's "Translate" action (never implicit on save), consistent with module/MCQ localisation.
const localizeAssetsSchema = z.object({ sourceLocale: generationLocaleSchema });
adminSectionsRouter.post("/:sectionId/assets/localize", generateLimiter, async (request: Request<{ sectionId: string }>, response, next) => {
  const parsed = localizeAssetsSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const result = await localizeSectionAssets(request.params.sectionId, parsed.data.sourceLocale);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

// #705: enhetlig livssyklus — seksjoner får samme Publiser/Avpubliser/Arkiver/Gjenopprett som
// moduler/kurs. Bruk-lås (G2) håndheves i kommandolaget og gir 400 med navngitte kurs.
adminSectionsRouter.post("/:sectionId/publish", async (request, response, next) => {
  try {
    const section = await publishSection(request.params.sectionId, request.context?.userId);
    response.json({ section: toDetail(section) });
  } catch (error) {
    next(error);
  }
});

adminSectionsRouter.post("/:sectionId/unpublish", async (request, response, next) => {
  try {
    const section = await unpublishSection(request.params.sectionId, request.context?.userId);
    response.json({ section: toDetail(section) });
  } catch (error) {
    next(error);
  }
});

adminSectionsRouter.post("/:sectionId/archive", async (request, response, next) => {
  try {
    const section = await archiveSection(request.params.sectionId, request.context?.userId);
    response.json({ section: toDetail(section) });
  } catch (error) {
    next(error);
  }
});

adminSectionsRouter.post("/:sectionId/restore", async (request, response, next) => {
  try {
    const section = await restoreSection(request.params.sectionId, request.context?.userId);
    response.json({ section: toDetail(section) });
  } catch (error) {
    next(error);
  }
});

adminSectionsRouter.delete("/:sectionId", async (request, response, next) => {
  try {
    await deleteSection(request.params.sectionId);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

export { adminSectionsRouter };
