import { Router } from "express";
import { prisma } from "../db/prisma.js";

// #645/CL-3: user lookup for class membership management. Mounted under /api/admin/content/users,
// so it inherits the SMO/ADMINISTRATOR gate. Read-only; returns a small, capped result set.
const adminUsersRouter = Router();

adminUsersRouter.get("/search", async (request, response, next) => {
  const q = typeof request.query.q === "string" ? request.query.q.trim() : "";
  if (q.length < 2) {
    response.json({ users: [] });
    return;
  }
  try {
    const users = await prisma.user.findMany({
      where: {
        isAnonymized: false,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { name: "asc" },
      take: 20,
      select: { id: true, name: true, email: true },
    });
    response.json({ users });
  } catch (error) {
    next(error);
  }
});

export { adminUsersRouter };
