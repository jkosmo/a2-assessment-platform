import { AppRole } from "../db/prismaRuntime.js";
import type { AppRole as AppRoleType } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { t } from "../i18n/messages.js";

export function requireAnyRole(allowed: AppRoleType[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const roles = request.context?.roles ?? [];
    const authorized = roles.some((role) => allowed.includes(role));

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
