import { AppRole } from "../db/prismaRuntime.js";
import type { AppRole as AppRoleType } from "@prisma/client";
import { hasAnyRole } from "./roleSets.js";
import type { NextFunction, Request, Response } from "express";
import { t } from "../i18n/messages.js";

export function requireAnyRole(allowed: AppRoleType[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const roles = request.context?.roles ?? [];
    // #962: samme «har minst én av» som alle andre kallsteder. Denne skrev sin egen `some/includes`
    // — den tjuende varianten, i selve middlewaren som skulle vært den delte vakta.
    const authorized = hasAnyRole(roles, allowed);

    if (!authorized) {
      const locale = request.context?.locale ?? "en-GB";
      response.status(403).json({
        error: "forbidden",
        message: t(locale, "forbidden_requires_roles", { roles: allowed }),
      });
      return;
    }

    next();
  };
}
