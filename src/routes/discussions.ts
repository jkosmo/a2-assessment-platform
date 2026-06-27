import { Router } from "express";
import { z } from "zod";
import { discussionWriteLimiter } from "../middleware/rateLimiting.js";
import {
  createReply,
  createThread,
  deleteReply,
  deleteThread,
  getThread,
  listThreads,
  setSubscription,
  updateReply,
  updateThread,
  type AccessContext,
} from "../modules/discussion/index.js";

/**
 * Diskusjon / Q&A REST-API (#495/T-QA-2), montert under coursesRouter på
 * `/api/courses/:courseId/discussions` (mergeParams henter :courseId fra forelderen).
 * Rute-gaten på /api/courses (rolesFor("courses")) sikrer allerede at bare deltaker+ kommer hit;
 * finkornet kurs-tilgang og moderering-authz håndheves i service-laget.
 */
const discussionsRouter = Router({ mergeParams: true });

const createThreadSchema = z.object({
  kind: z.enum(["QUESTION", "DISCUSSION"]),
  title: z.string().trim().min(1).max(300),
  bodyMarkdown: z.string().trim().min(1).max(10_000),
  courseItemId: z.string().trim().min(1).optional(),
});

const patchThreadSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    bodyMarkdown: z.string().trim().min(1).max(10_000),
    pinned: z.boolean(),
    lock: z.boolean(),
    acceptedReplyId: z.string().trim().min(1).nullable(),
  })
  .partial();

const replyBodySchema = z.object({
  bodyMarkdown: z.string().trim().min(1).max(5_000),
});

function accessFrom(request: {
  context?: { userId?: string; roles?: AccessContext["roles"]; principal?: { groupIds?: string[] } };
}): AccessContext | null {
  const userId = request.context?.userId;
  if (!userId) return null;
  return {
    userId,
    roles: request.context?.roles ?? [],
    groupIds: request.context?.principal?.groupIds,
  };
}

function badRequest(response: import("express").Response, issues: unknown) {
  response.status(400).json({ error: "validation_error", issues });
}

// GET /api/courses/:courseId/discussions?itemId=  — list (kurs-nivå hvis itemId mangler)
discussionsRouter.get("/", async (request, response, next) => {
  const access = accessFrom(request);
  if (!access) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  const itemId = typeof request.query.itemId === "string" && request.query.itemId.length > 0
    ? request.query.itemId
    : null;
  try {
    const threads = await listThreads({ courseId: (request.params as Record<string, string>).courseId, courseItemId: itemId, access });
    response.json({ threads });
  } catch (error) {
    next(error);
  }
});

// POST /api/courses/:courseId/discussions  — opprett tråd
discussionsRouter.post("/", discussionWriteLimiter, async (request, response, next) => {
  const access = accessFrom(request);
  if (!access) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  const parsed = createThreadSchema.safeParse(request.body);
  if (!parsed.success) {
    badRequest(response, parsed.error.issues);
    return;
  }
  try {
    const thread = await createThread({
      courseId: (request.params as Record<string, string>).courseId,
      courseItemId: parsed.data.courseItemId ?? null,
      kind: parsed.data.kind,
      title: parsed.data.title,
      bodyMarkdown: parsed.data.bodyMarkdown,
      access,
    });
    response.status(201).json({ thread });
  } catch (error) {
    next(error);
  }
});

// GET /api/courses/:courseId/discussions/:threadId  — tråd + svar
discussionsRouter.get("/:threadId", async (request, response, next) => {
  const access = accessFrom(request);
  if (!access) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const thread = await getThread({
      courseId: (request.params as Record<string, string>).courseId,
      threadId: (request.params as Record<string, string>).threadId,
      access,
    });
    response.json({ thread });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/courses/:courseId/discussions/:threadId  — rediger egen / moderering / aksepter svar
discussionsRouter.patch("/:threadId", discussionWriteLimiter, async (request, response, next) => {
  const access = accessFrom(request);
  if (!access) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  const parsed = patchThreadSchema.safeParse(request.body);
  if (!parsed.success) {
    badRequest(response, parsed.error.issues);
    return;
  }
  try {
    const thread = await updateThread({
      courseId: (request.params as Record<string, string>).courseId,
      threadId: (request.params as Record<string, string>).threadId,
      patch: parsed.data,
      access,
    });
    response.json({ thread });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/courses/:courseId/discussions/:threadId  — soft-delete (forfatter/moderator)
discussionsRouter.delete("/:threadId", discussionWriteLimiter, async (request, response, next) => {
  const access = accessFrom(request);
  if (!access) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    await deleteThread({ courseId: (request.params as Record<string, string>).courseId, threadId: (request.params as Record<string, string>).threadId, access });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

// POST /api/courses/:courseId/discussions/:threadId/replies  — svar (auto-abonnerer forfatter)
discussionsRouter.post("/:threadId/replies", discussionWriteLimiter, async (request, response, next) => {
  const access = accessFrom(request);
  if (!access) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  const parsed = replyBodySchema.safeParse(request.body);
  if (!parsed.success) {
    badRequest(response, parsed.error.issues);
    return;
  }
  try {
    const thread = await createReply({
      courseId: (request.params as Record<string, string>).courseId,
      threadId: (request.params as Record<string, string>).threadId,
      bodyMarkdown: parsed.data.bodyMarkdown,
      access,
    });
    response.status(201).json({ thread });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/courses/:courseId/discussions/:threadId/replies/:replyId  — rediger eget svar
discussionsRouter.patch(
  "/:threadId/replies/:replyId",
  discussionWriteLimiter,
  async (request, response, next) => {
    const access = accessFrom(request);
    if (!access) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    const parsed = replyBodySchema.safeParse(request.body);
    if (!parsed.success) {
      badRequest(response, parsed.error.issues);
      return;
    }
    try {
      const thread = await updateReply({
        courseId: (request.params as Record<string, string>).courseId,
        threadId: (request.params as Record<string, string>).threadId,
        replyId: (request.params as Record<string, string>).replyId,
        bodyMarkdown: parsed.data.bodyMarkdown,
        access,
      });
      response.json({ thread });
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /api/courses/:courseId/discussions/:threadId/replies/:replyId  — soft-delete svar
discussionsRouter.delete(
  "/:threadId/replies/:replyId",
  discussionWriteLimiter,
  async (request, response, next) => {
    const access = accessFrom(request);
    if (!access) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      await deleteReply({
        courseId: (request.params as Record<string, string>).courseId,
        threadId: (request.params as Record<string, string>).threadId,
        replyId: (request.params as Record<string, string>).replyId,
        access,
      });
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

// PUT/DELETE /api/courses/:courseId/discussions/:threadId/subscription  — abonner/avslutt
discussionsRouter.put("/:threadId/subscription", discussionWriteLimiter, async (request, response, next) => {
  const access = accessFrom(request);
  if (!access) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const result = await setSubscription({
      courseId: (request.params as Record<string, string>).courseId,
      threadId: (request.params as Record<string, string>).threadId,
      subscribed: true,
      access,
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

discussionsRouter.delete("/:threadId/subscription", discussionWriteLimiter, async (request, response, next) => {
  const access = accessFrom(request);
  if (!access) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const result = await setSubscription({
      courseId: (request.params as Record<string, string>).courseId,
      threadId: (request.params as Record<string, string>).threadId,
      subscribed: false,
      access,
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

export { discussionsRouter };
