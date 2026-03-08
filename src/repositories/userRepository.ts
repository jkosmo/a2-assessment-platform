import { AppRole } from "@prisma/client";
import type { AuthPrincipal } from "../auth/principal.js";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import fs from "node:fs";
import path from "node:path";

export async function upsertUserFromPrincipal(principal: AuthPrincipal) {
  return prisma.user.upsert({
    where: { externalId: principal.externalId },
    update: {
      email: principal.email,
      name: principal.name,
      department: principal.department,
      activeStatus: true,
    },
    create: {
      externalId: principal.externalId,
      email: principal.email,
      name: principal.name,
      department: principal.department,
      activeStatus: true,
    },
  });
}

export async function getActiveRoles(userId: string, at = new Date()): Promise<AppRole[]> {
  const assignments = await prisma.roleAssignment.findMany({
    where: {
      userId,
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gte: at } }],
    },
    select: { appRole: true },
  });

  return assignments.map((assignment) => assignment.appRole);
}

function parseRoleMap(): Record<string, AppRole> {
  let parsed: unknown;

  if (env.ENTRA_GROUP_ROLE_MAP_FILE) {
    const roleMapPath = path.resolve(process.cwd(), env.ENTRA_GROUP_ROLE_MAP_FILE);
    if (!fs.existsSync(roleMapPath)) {
      throw new Error(`ENTRA_GROUP_ROLE_MAP_FILE not found: ${roleMapPath}`);
    }
    parsed = JSON.parse(fs.readFileSync(roleMapPath, "utf8"));
  } else {
    if (!env.ENTRA_GROUP_ROLE_MAP_JSON.trim()) {
      return {};
    }
    parsed = JSON.parse(env.ENTRA_GROUP_ROLE_MAP_JSON);
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const validRoles = new Set<string>(Object.values(AppRole));
  const map: Record<string, AppRole> = {};

  for (const [groupId, rawRole] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof rawRole !== "string") {
      continue;
    }

    const normalized = rawRole.trim().toUpperCase();
    if (validRoles.has(normalized)) {
      map[groupId] = normalized as AppRole;
    }
  }

  return map;
}

export async function syncEntraGroupRoles(userId: string, principal: AuthPrincipal, at = new Date()) {
  if (!env.ENTRA_SYNC_GROUP_ROLES) {
    return;
  }

  const map = parseRoleMap();
  const groupIds = principal.groupIds ?? [];
  const desiredRoles = new Set<AppRole>();
  for (const groupId of groupIds) {
    const role = map[groupId];
    if (role) {
      desiredRoles.add(role);
    }
  }

  const activeAssignments = await prisma.roleAssignment.findMany({
    where: {
      userId,
      createdBy: "entra-group-sync",
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gte: at } }],
    },
  });

  const activeRoles = new Set<AppRole>(activeAssignments.map((assignment) => assignment.appRole));

  for (const role of desiredRoles) {
    if (!activeRoles.has(role)) {
      await prisma.roleAssignment.create({
        data: {
          userId,
          appRole: role,
          validFrom: at,
          createdBy: "entra-group-sync",
        },
      });
    }
  }

  for (const assignment of activeAssignments) {
    if (!desiredRoles.has(assignment.appRole)) {
      await prisma.roleAssignment.update({
        where: { id: assignment.id },
        data: { validTo: at },
      });
    }
  }
}
