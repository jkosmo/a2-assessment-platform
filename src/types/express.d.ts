import type { RequestContext } from "../auth/principal.js";

declare global {
  namespace Express {
    interface RateLimitInfo {
      limit: number;
      used: number;
      remaining: number;
      resetTime?: Date;
    }

    interface Request {
      context?: RequestContext;
      rateLimit?: RateLimitInfo;
    }
  }
}

export {};
