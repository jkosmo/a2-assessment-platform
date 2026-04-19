import type { Request } from "express";
import rateLimit, { MemoryStore, type Options, type RateLimitRequestHandler } from "express-rate-limit";

const RATE_LIMIT_WINDOW_MS = 60_000;

const generalApiStore = new MemoryStore();
const submissionCreateStore = new MemoryStore();
const assessmentRunStore = new MemoryStore();
const mcqSubmitStore = new MemoryStore();
const generateStore = new MemoryStore();

function resolveRateLimitKey(request: Request) {
  return request.context?.userId ?? request.ip ?? "unknown";
}

function buildRateLimitHandler(message: Record<string, string>): Options["handler"] {
  return (request, response, _next, options) => {
    const resetTime = request.rateLimit?.resetTime;
    const retryAfterSeconds = resetTime
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : Math.ceil(options.windowMs / 1000);

    response.set("Retry-After", String(retryAfterSeconds));
    response.status(options.statusCode).json(message);
  };
}

function createLimiter(config: {
  store: MemoryStore;
  limit: number;
  message: Record<string, string>;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: config.limit,
    store: config.store,
    keyGenerator: resolveRateLimitKey,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: buildRateLimitHandler(config.message),
  });
}

export const generalApiLimiter = createLimiter({
  store: generalApiStore,
  limit: 120,
  message: {
    error: "rate_limited",
    message: "Too many API requests. Retry in 60 seconds.",
  },
});

export const submissionCreateLimiter = createLimiter({
  store: submissionCreateStore,
  limit: 10,
  message: {
    error: "rate_limited",
    message: "Too many submission requests. Retry in 60 seconds.",
  },
});

export const assessmentRunLimiter = createLimiter({
  store: assessmentRunStore,
  limit: 5,
  message: {
    error: "rate_limited",
    message: "Too many assessment requests. Retry in 60 seconds.",
  },
});

export const mcqSubmitLimiter = createLimiter({
  store: mcqSubmitStore,
  limit: 10,
  message: {
    error: "rate_limited",
    message: "Too many MCQ submissions. Retry in 60 seconds.",
  },
});

export const generateLimiter = createLimiter({
  store: generateStore,
  limit: 10,
  message: {
    error: "rate_limited",
    message: "Too many generation requests. Retry in 60 seconds.",
  },
});

export async function resetRateLimitState() {
  await Promise.all([
    generalApiStore.resetAll?.(),
    submissionCreateStore.resetAll?.(),
    assessmentRunStore.resetAll?.(),
    mcqSubmitStore.resetAll?.(),
    generateStore.resetAll?.(),
  ]);
}
