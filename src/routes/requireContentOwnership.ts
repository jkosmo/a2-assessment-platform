import type { RequestHandler } from "express";
import type { ContentOwnerType } from "@prisma/client";
import { assertContentOwnership } from "../modules/content/contentOwnershipService.js";

// #787 slice 4b: route middleware that enforces content ownership on a mutation before its handler runs.
// Semantics come from decideOwnershipAccess: ADMINISTRATOR bypasses (universal access); an owner is
// allowed; a non-owner — and unowned content, for non-admins — throws ForbiddenError, which the global
// errorHandlingMiddleware renders as 403 { error: "content_ownership" | "content_unowned" }.
//
// `param` is the route param holding the content id (e.g. "courseId"). Mount it before the handler:
//   adminCoursesRouter.put("/:courseId", requireContentOwnership("COURSE", "courseId"), handler)
// Return type is deliberately `RequestHandler<any>`: a concrete params type here forces Express's
// multi-handler overload to widen the downstream inline handler's `request.params` to string | string[].
// `any` params keeps this middleware transparent to each route's own path-param inference.
export function requireContentOwnership(contentType: ContentOwnerType, param: string): RequestHandler<any> {
  return async (request, _response, next) => {
    try {
      await assertContentOwnership({
        contentType,
        contentId: request.params[param] ?? "",
        actorUserId: request.context?.userId ?? "",
        roles: request.context?.roles ?? [],
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}
