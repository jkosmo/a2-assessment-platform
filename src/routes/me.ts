import { Router } from "express";

const meRouter = Router();

meRouter.get("/", async (request, response) => {
  const principal = request.context?.principal;
  if (!principal) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  response.json({
    user: {
      externalId: principal.externalId,
      email: principal.email,
      name: principal.name,
      department: principal.department,
      roles: request.context?.roles ?? [],
    },
  });
});

export { meRouter };
