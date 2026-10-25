// 2.102.0: tema i «Mine kurs» — /api/admin/content/themes.
//
// Lista er åpen for alle i innholdsforvaltningen: den som redigerer et kurs, må kunne velge blant
// temaene. Å lage, endre og slette er administratorens (produkteier 2026-10-25): temaene er én felles
// inndeling for hele plattformen, og lager alle sine egne, ender vi med mange som nesten er like.
import { Router } from "express";
import { z } from "zod";
import { requireAnyRole } from "../auth/authorization.js";
import { ADMIN_ONLY } from "../auth/roleSets.js";
import { localizedTextCodec } from "../codecs/localizedTextCodec.js";
import { listCourseThemes, createCourseTheme, updateCourseTheme, deleteCourseTheme } from "../modules/course/index.js";

const adminThemesRouter = Router();
const adminOnly = requireAnyRole([...ADMIN_ONLY]);

const themeName = z.string().trim().min(1).max(80);
// Bokmål er påkrevd, som for kurs (#1046); de andre språkene kan fylles etterpå.
const themeBodySchema = z.object({
  name: z.object({ nb: themeName, nn: themeName.optional(), "en-GB": themeName.optional() }),
});

adminThemesRouter.get("/", async (_request, response, next) => {
  try {
    response.json({ themes: await listCourseThemes() });
  } catch (error) {
    next(error);
  }
});

adminThemesRouter.post("/", adminOnly, async (request, response, next) => {
  const parsed = themeBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const theme = await createCourseTheme({
      name: localizedTextCodec.serialize(parsed.data.name),
      actorId: request.context?.userId,
    });
    response.status(201).json({ theme: { id: theme.id, name: theme.name } });
  } catch (error) {
    next(error);
  }
});

adminThemesRouter.put("/:themeId", adminOnly, async (request, response, next) => {
  const parsed = themeBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const theme = await updateCourseTheme(String(request.params.themeId), {
      name: localizedTextCodec.serialize(parsed.data.name),
      actorId: request.context?.userId,
    });
    response.json({ theme: { id: theme.id, name: theme.name } });
  } catch (error) {
    next(error);
  }
});

adminThemesRouter.delete("/:themeId", adminOnly, async (request, response, next) => {
  try {
    const result = await deleteCourseTheme(String(request.params.themeId), request.context?.userId);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

export { adminThemesRouter };
