import { Router } from "express";

const meRouter = Router();

meRouter.get("/", async (request, response) => {
  const context = request.context;
  if (!context) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  response.json({
    user: {
      externalId: context.principal.externalId,
      email: context.principal.email,
      name: context.principal.name,
      department: context.principal.department,
      roles: context.roles,
    },
  });
});

export { meRouter };

