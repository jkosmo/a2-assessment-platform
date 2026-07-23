import type { Request } from "express";
import rateLimit, { MemoryStore, type Options, type RateLimitRequestHandler } from "express-rate-limit";

const RATE_LIMIT_WINDOW_MS = 60_000;

const generalApiStore = new MemoryStore();
const submissionCreateStore = new MemoryStore();
const assessmentRunStore = new MemoryStore();
const mcqSubmitStore = new MemoryStore();
const generateStore = new MemoryStore();
const extractStore = new MemoryStore();
const intentLogStore = new MemoryStore();
const discussionWriteStore = new MemoryStore();
const auditTrailStore = new MemoryStore();
const preBodyApiStore = new MemoryStore();

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

// #788: a coarse IP-keyed throttle applied to /api BEFORE the body parsers, so an unauthenticated client
// can't drive unbounded request throughput that gets buffered/parsed before auth even runs. This is the
// pre-auth flood cap; the per-user generalApiLimiter (keyed by userId) still applies after authentication.
export const preBodyApiLimiter = createLimiter({
  store: preBodyApiStore,
  limit: 600,
  message: {
    error: "rate_limited",
    message: "Too many requests. Retry in 60 seconds.",
  },
});

// #797: the participant-reachable submission audit-trail read must be rate-limited — even with the
// indexed query, a scripted refresh shouldn't be able to tie up connections in a tight loop.
export const auditTrailLimiter = createLimiter({
  store: auditTrailStore,
  limit: 30,
  message: {
    error: "rate_limited",
    message: "Too many audit-trail requests. Retry in 60 seconds.",
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

// #454 v1.2.5: dedikert limit for file-parser-ekstraksjon. Multi-fil-flyten (Phase 2)
// kan submitte 5-10 filer i én batch, og hver fil poller resultat 1-30 ganger. Med den
// gamle 10/min generateLimiter ble grensen blåst gjennom på sekunder. Separer extract-
// flow så LLM-generation-budsjettet (10/min) ikke deles med parser-pollingen.
export const extractLimiter = createLimiter({
  store: extractStore,
  limit: 60,
  message: {
    error: "rate_limited",
    message: "Too many file extraction requests. Retry in 60 seconds.",
  },
});

// v1.2.23 (#357 Phase A): intent-classification logging fra Samtale-shell. 60/min per
// bruker — sjelden brukt nok at det ikke skal slå tak, men beskytter mot abuse.
export const intentLogLimiter = createLimiter({
  store: intentLogStore,
  limit: 60,
  message: {
    error: "rate_limited",
    message: "Too many intent-log requests. Retry in 60 seconds.",
  },
});

// #495/T-QA-2: skrive-limiter for diskusjon (opprett tråd/svar, redigering, moderering).
// UGC-skriving er spam-utsatt; 30/min per bruker er romslig for normal bruk men stopper abuse.
export const discussionWriteLimiter = createLimiter({
  store: discussionWriteStore,
  limit: 30,
  message: {
    error: "rate_limited",
    message: "Too many discussion requests. Retry in 60 seconds.",
  },
});

export async function resetRateLimitState() {
  await Promise.all([
    generalApiStore.resetAll?.(),
    submissionCreateStore.resetAll?.(),
    assessmentRunStore.resetAll?.(),
    mcqSubmitStore.resetAll?.(),
    extractStore.resetAll?.(),
    generateStore.resetAll?.(),
    intentLogStore.resetAll?.(),
    discussionWriteStore.resetAll?.(),
  ]);
}
