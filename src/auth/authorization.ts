import { AppRole } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";

export function requireAnyRole(allowed: AppRole[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const roles = request.context?.roles ?? [];
    const authorized = roles.some((role) => allowed.includes(role));

    if (!authorized) {
      response.status(403).json({
        error: "forbidden",
        message: `Requires one of roles: ${allowed.join(", ")}`,
      });
      return;
    }

    next();
  };
}

