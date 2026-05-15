import type { AppRole as AppRoleType } from "@prisma/client";
import type { AuthPrincipal } from "../auth/principal.js";
import { parseEntraGroupRoleMapJson } from "../auth/entraRoleMap.js";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import fs from "node:fs";
import path from "node:path";

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code === "P2002"
  );
}

export class IdentityReconciliationError extends Error {
  code = "identity_reconciliation_conflict";

  constructor(message = "Email is already linked to a different external identity.") {
    super(message);
    this.name = "IdentityReconciliationError";
  }
}

export async function upsertUserFromPrincipal(principal: AuthPrincipal) {
  const existingByExternalId = await prisma.user.findUnique({
    where: { externalId: principal.externalId },
    select: { id: true, email: true, activeStatus: true, isAnonymized: true },
  });
  const existingByEmail = await prisma.user.findUnique({
    where: { email: principal.email },
    select: { id: true, externalId: true },
  });

  const now = new Date();

  if (existingByExternalId) {
    if (existingByExternalId.isAnonymized) {
      return existingByExternalId;
    }

    const emailTakenByDifferentUser =
      existingByEmail && existingByEmail.id !== existingByExternalId.id;

    return prisma.user.update({
      where: { id: existingByExternalId.id },
      data: {
        ...(emailTakenByDifferentUser ? {} : { email: principal.email }),
        name: principal.name,
        department: principal.department,
        lastLoginAt: now,
      },
    });
  }

  if (existingByEmail) {
    if (env.AUTH_MODE === "mock") {
      return prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          externalId: principal.externalId,
          name: principal.name,
          department: principal.department,
          lastLoginAt: now,
        },
      });
    }
    throw new IdentityReconciliationError();
  }

  try {
    return await prisma.user.create({
      data: {
        externalId: principal.externalId,
        email: principal.email,
        name: principal.name,
        department: principal.department,
        activeStatus: true,
        lastLoginAt: now,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const createdByExternalId = await prisma.user.findUnique({
      where: { externalId: principal.externalId },
      select: { id: true },
    });

    if (!createdByExternalId) {
      const createdByEmail = await prisma.user.findUnique({
        where: { email: principal.email },
        select: { id: true },
      });
      if (createdByEmail) {
        if (env.AUTH_MODE === "mock") {
          return prisma.user.update({
            where: { id: createdByEmail.id },
            data: {
              externalId: principal.externalId,
              email: principal.email,
              name: principal.name,
              department: principal.department,
              lastLoginAt: now,
            },
          });
        }
        throw new IdentityReconciliationError();
      }
      throw error;
    }

    return prisma.user.update({
      where: { id: createdByExternalId.id },
      data: {
        externalId: principal.externalId,
        email: principal.email,
        name: principal.name,
        department: principal.department,
        lastLoginAt: now,
      },
    });
  }
}

export async function getActiveRoles(userId: string, at = new Date()): Promise<AppRoleType[]> {
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

export async function findUserForOrgSyncByExternalId(externalId: string) {
  return prisma.user.findUnique({
    where: { externalId },
    select: {
      id: true,
      externalId: true,
      email: true,
      name: true,
      department: true,
      manager: true,
      activeStatus: true,
    },
  });
}

export async function findUserForOrgSyncByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      externalId: true,
      email: true,
      name: true,
      department: true,
      manager: true,
      activeStatus: true,
    },
  });
}

export async function updateUserForOrgSync(
  userId: string,
  data: {
    externalId?: string;
    email: string;
    name: string;
    department: string | null;
    manager: string | null;
    activeStatus: boolean;
  },
) {
  return prisma.user.update({
    where: { id: userId },
    data,
  });
}

export async function createUserForOrgSync(data: {
  externalId: string;
  email: string;
  name: string;
  department: string | null;
  manager: string | null;
  activeStatus: boolean;
}) {
  return prisma.user.create({
    data,
  });
}

function parseRoleMap(): Record<string, AppRoleType> {
  if (env.ENTRA_GROUP_ROLE_MAP_FILE) {
    const roleMapPath = path.resolve(process.cwd(), env.ENTRA_GROUP_ROLE_MAP_FILE);
    if (!fs.existsSync(roleMapPath)) {
      throw new Error(`ENTRA_GROUP_ROLE_MAP_FILE not found: ${roleMapPath}`);
    }
    return parseEntraGroupRoleMapJson(fs.readFileSync(roleMapPath, "utf8"));
  }

  if (!env.ENTRA_GROUP_ROLE_MAP_JSON.trim()) {
    return {};
  }

  return parseEntraGroupRoleMapJson(env.ENTRA_GROUP_ROLE_MAP_JSON);
}

export async function syncEntraGroupRoles(userId: string, principal: AuthPrincipal, at = new Date()) {
  if (!env.ENTRA_SYNC_GROUP_ROLES) {
    return;
  }

  const map = parseRoleMap();
  const groupIds = principal.groupIds ?? [];
  const desiredRoles = new Set<AppRoleType>();
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

  const activeRoles = new Set<AppRoleType>(activeAssignments.map((assignment) => assignment.appRole));

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
