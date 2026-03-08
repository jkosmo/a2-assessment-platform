import { AppRole } from "@prisma/client";
import type { AuthPrincipal } from "../auth/principal.js";
import { prisma } from "../db/prisma.js";

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

