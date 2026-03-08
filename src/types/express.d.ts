import type { RequestContext } from "../auth/principal.js";

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
    }
  }
}

export {};

