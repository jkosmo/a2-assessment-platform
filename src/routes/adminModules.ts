import { Router } from "express";
import { listModules } from "../modules/module/index.js";
import { requestLocale } from "../i18n/requestLocale.js";

const adminModulesRouter = Router();

adminModulesRouter.get("/", async (request, response) => {
  const roles = request.context?.roles ?? [];
  const locale = requestLocale(request);
  const modules = await listModules(roles, undefined, locale, { participantFacing: false });
  response.json({ modules });
});

export { adminModulesRouter };
