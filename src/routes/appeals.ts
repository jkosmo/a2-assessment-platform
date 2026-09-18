import { Router } from "express";
import { z } from "zod";
import { claimAppeal, getAppealWorkspaceView, listAppealQueue, resolveAppeal } from "../modules/appeal/index.js";
import { requestLocale } from "../i18n/requestLocale.js";

const appealsRouter = Router();

const APPEAL_STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED", "SUPERSEDED"] as const;
type AppealStatusFilter = (typeof APPEAL_STATUSES)[number];

// #1008: en ukjent verdi ble stille filtrert BORT — og en tom liste betydde «ikke filtrer», så
// `?status=TULLEVERDI` ga hele køen. Samme klasse som #938/#944/#945/#958: uoppramset input skal
// avvises, ikke bli en snill standard.
const listQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((value, ctx): AppealStatusFilter[] => {
      if (!value) return ["OPEN", "IN_REVIEW"];
      const items = value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
      const unknown = items.filter((item) => !(APPEAL_STATUSES as readonly string[]).includes(item));
      if (unknown.length > 0) {
        ctx.addIssue({ code: "custom", message: `Unknown status: ${unknown.join(", ")}. Allowed: ${APPEAL_STATUSES.join(", ")}.`, path: ["status"] });
        return z.NEVER;
      }
      return items as AppealStatusFilter[];
    }),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const resolveBodySchema = z.object({
  passFailTotal: z.boolean(),
  decisionReason: z.string().trim().min(5),
  resolutionNote: z.string().trim().min(5),
});

appealsRouter.get("/", async (request, response) => {
  const parsed = listQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const appeals = await listAppealQueue({
    statuses:
      parsed.data.status.length > 0
        ? parsed.data.status
        : (["OPEN", "IN_REVIEW"] as Array<"OPEN" | "IN_REVIEW">),
    limit: parsed.data.limit,
    // #1027: behandlerens språk. Uten dette lokaliserer tjenesten til engelsk uansett.
    locale: request.context?.locale,
  });
  response.json({ appeals });
});

appealsRouter.get("/:appealId", async (request, response) => {
  const appeal = await getAppealWorkspaceView(request.params.appealId, requestLocale(request));
  if (!appeal) {
    response.status(404).json({ error: "not_found", message: "Appeal not found." });
    return;
  }
  response.json(appeal);
});

appealsRouter.post("/:appealId/claim", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const isAdmin = (request.context?.roles ?? []).includes("ADMINISTRATOR");
  try {
    const appeal = await claimAppeal(request.params.appealId, userId, isAdmin);
    response.json({ appeal });
  } catch (error) {
    next(error);
  }
});

appealsRouter.post("/:appealId/resolve", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = resolveBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const isAdmin = (request.context?.roles ?? []).includes("ADMINISTRATOR");
  try {
    const result = await resolveAppeal({
      appealId: request.params.appealId,
      handlerId: userId,
      isAdmin,
      ...parsed.data,
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

export { appealsRouter };
