import { AppRole } from "../db/prismaRuntime.js";
import type { AppRole as AppRoleType } from "@prisma/client";

export function parseEntraGroupRoleMapJson(input: string): Record<string, AppRoleType> {
  const sanitized = input.replace(/^\uFEFF/, "").trim();
  if (!sanitized) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitized);
  } catch {
    throw new Error("ENTRA group role map is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const validRoles = new Set<string>(Object.values(AppRole));
  const map: Record<string, AppRoleType> = {};

  for (const [groupId, rawRole] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof rawRole !== "string") {
      continue;
    }

    const normalized = rawRole.trim().toUpperCase();
    if (validRoles.has(normalized)) {
      map[groupId] = normalized as AppRoleType;
    }
  }

  return map;
}
