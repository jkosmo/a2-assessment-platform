import { Router } from "express";
import { listModules, getModuleById, getActiveModuleVersion } from "../repositories/moduleRepository.js";

const modulesRouter = Router();

modulesRouter.get("/", async (request, response) => {
  const roles = request.context?.roles ?? [];
  const modules = await listModules(roles);
  response.json({ modules });
});

modulesRouter.get("/:moduleId", async (request, response) => {
  const roles = request.context?.roles ?? [];
  const module = await getModuleById(request.params.moduleId, roles);

  if (!module) {
    response.status(404).json({ error: "not_found", message: "Module not found." });
    return;
  }

  response.json({ module });
});

modulesRouter.get("/:moduleId/active-version", async (request, response) => {
  const roles = request.context?.roles ?? [];
  const activeVersion = await getActiveModuleVersion(request.params.moduleId, roles);

  if (!activeVersion) {
    response
      .status(404)
      .json({ error: "not_found", message: "Active module version not found." });
    return;
  }

  response.json({ activeVersion });
});

export { modulesRouter };

