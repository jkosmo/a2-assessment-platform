import { Router } from "express";
import { z } from "zod";
import {
  createSection,
  updateSectionTitle,
  updateSectionContent,
  getSection,
  listSections,
  deleteSection,
} from "../modules/course/index.js";
import { localizedTextPatchSchema, generationLocaleSchema } from "../modules/adminContent/adminContentSchemas.js";
import { localizedTextCodec } from "../codecs/localizedTextCodec.js";
import { NotFoundError } from "../errors/AppError.js";
import { renderSectionMarkdown } from "../modules/course/sectionContent.js";
import { localizeSectionContent } from "../modules/adminContent/llmContentGenerationService.js";
import { generateLimiter } from "../middleware/rateLimiting.js";

const adminSectionsRouter = Router();

const createSectionSchema = z.object({
  title: localizedTextPatchSchema,
  bodyMarkdown: localizedTextPatchSchema,
});
const titleSchema = z.object({ title: localizedTextPatchSchema });
const contentSchema = z.object({ bodyMarkdown: localizedTextPatchSchema });
const previewSchema = z.object({ markdown: z.string() });
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
    });
    response.status(201).json({ section: toDetail(section) });
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
    response.json({ html: renderSectionMarkdown(parsed.data.markdown) });
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
    response.json({
      sections: sections.map((s) => ({
        id: s.id,
        title: s.title,
        versionNo: s.activeVersion?.versionNo ?? null,
        updatedAt: s.updatedAt.toISOString(),
        archivedAt: s.archivedAt?.toISOString() ?? null,
      })),
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

adminSectionsRouter.delete("/:sectionId", async (request, response, next) => {
  try {
    await deleteSection(request.params.sectionId);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

export { adminSectionsRouter };
