import { Router } from "express";
import { SUPPORTED_LOCALES } from "../i18n/locale.js";

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
      locale: request.context?.locale ?? "en-GB",
    },
    supportedLocales: SUPPORTED_LOCALES,
  });
});

export { meRouter };
