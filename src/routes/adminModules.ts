import { Router } from "express";
import { listModules } from "../modules/module/index.js";

const adminModulesRouter = Router();

adminModulesRouter.get("/", async (request, response) => {
  const roles = request.context?.roles ?? [];
  const locale = request.context?.locale ?? "en-GB";
  const modules = await listModules(roles, undefined, locale, { participantFacing: false });
  response.json({ modules });
});

export { adminModulesRouter };
