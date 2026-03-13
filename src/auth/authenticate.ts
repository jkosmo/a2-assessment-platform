import type { AppRole } from "@prisma/client";
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import type { AuthPrincipal } from "./principal.js";
import { getActiveRoles, syncEntraGroupRoles, upsertUserFromPrincipal } from "../repositories/userRepository.js";
import { resolveRequestLocale } from "../i18n/locale.js";
import { t } from "../i18n/messages.js";

const entraIssuer = env.ENTRA_TENANT_ID
  ? `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`
  : undefined;

const entraJwks = env.ENTRA_TENANT_ID
  ? createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/discovery/v2.0/keys`),
    )
  : undefined;

function parseRoleNames(input: string[] | undefined): AppRole[] {
  if (!input || input.length === 0) {
    return [];
  }

  const valid = new Set<string>([
    "PARTICIPANT",
    "SUBJECT_MATTER_OWNER",
    "ADMINISTRATOR",
    "APPEAL_HANDLER",
    "REPORT_READER",
    "REVIEWER",
  ]);

  return input
    .map((role) => role.trim().toUpperCase())
    .filter((role) => valid.has(role)) as AppRole[];
}

function principalFromMockHeaders(request: Request): AuthPrincipal {
  const headerRoles = request.header("x-user-roles");
  const roleHints = headerRoles ? headerRoles.split(",") : [];
  const headerGroups = request.header("x-user-groups");
  const groupIds = headerGroups ? headerGroups.split(",").map((value) => value.trim()) : [];

  return {
    externalId: request.header("x-user-id") ?? env.MOCK_DEFAULT_USER_ID,
    email: request.header("x-user-email") ?? env.MOCK_DEFAULT_EMAIL,
    name: request.header("x-user-name") ?? env.MOCK_DEFAULT_NAME,
    department: request.header("x-user-department") ?? env.MOCK_DEFAULT_DEPARTMENT,
    tokenRoles: roleHints,
    groupIds,
  };
}

async function principalFromBearerToken(token: string): Promise<AuthPrincipal> {
  if (!entraIssuer || !entraJwks || !env.ENTRA_AUDIENCE) {
    throw new Error("ENTRA auth mode is not fully configured.");
  }

  const { payload } = await jwtVerify(token, entraJwks, {
    issuer: entraIssuer,
    audience: env.ENTRA_AUDIENCE,
  });

  return principalFromJwtPayload(payload);
}

function principalFromJwtPayload(payload: JWTPayload): AuthPrincipal {
  const externalId = String(payload.oid ?? payload.sub ?? "");
  const email = String(payload.preferred_username ?? payload.upn ?? payload.email ?? "");
  const name = String(payload.name ?? email);

  if (!externalId || !email) {
    throw new Error("JWT token is missing required user claims.");
  }

  const tokenRoles = Array.isArray(payload.roles)
    ? payload.roles.filter((value): value is string => typeof value === "string")
    : [];
  const groupIds = Array.isArray(payload.groups)
    ? payload.groups.filter((value): value is string => typeof value === "string")
    : [];

  return {
    externalId,
    email,
    name,
    tokenRoles,
    groupIds,
  };
}

export async function authenticate(request: Request, response: Response, next: NextFunction) {
  const locale = resolveRequestLocale({
    explicitLocale: request.header("x-locale"),
    acceptLanguage: request.header("accept-language"),
    defaultLocale: env.DEFAULT_LOCALE,
  });

  let principal: AuthPrincipal;
  try {
    principal =
      env.AUTH_MODE === "mock"
        ? principalFromMockHeaders(request)
        : await principalFromBearerToken(extractBearerToken(request));
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "";
    const message =
      rawMessage === "Missing Bearer token."
        ? t(locale, "missing_bearer_token")
        : t(locale, "unauthorized");

    response.status(401).json({
      error: "unauthorized",
      message,
    });
    return;
  }

  try {
    const user = await upsertUserFromPrincipal(principal);
    await syncEntraGroupRoles(user.id, principal);
    let roles = await getActiveRoles(user.id);

    // In mock mode, explicit role hints from the workspace UI should define
    // the effective role set for the current request. This keeps role-switching
    // predictable even if the backing user record has additional assignments.
    if (env.AUTH_MODE === "mock") {
      const hintedRoles = parseRoleNames(principal.tokenRoles);
      if (hintedRoles.length > 0) {
        roles = hintedRoles;
      }
    }

    const correlationId = request.context?.correlationId;
    request.context = {
      correlationId,
      principal,
      userId: user.id,
      roles,
      locale,
    };

    next();
  } catch (error) {
    console.error("Authentication backend failed.", error);
    next(new AppError("internal_error", 500, "Internal server error."));
  }
}

function extractBearerToken(request: Request): string {
  const authorization = request.header("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) {
    throw new Error("Missing Bearer token.");
  }

  return authorization.slice("Bearer ".length);
}
