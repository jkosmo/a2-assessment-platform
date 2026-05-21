export {
  createModule,
  updateModuleTitle,
  deleteModule,
  createRubricVersion,
  ensureRubricVersion,
  createPromptTemplateVersion,
  createMcqSetVersion,
  createModuleVersion,
  createBenchmarkExampleVersion,
  publishModuleVersion,
  unpublishModule,
  archiveModule,
  restoreModule,
  publishModuleVersionWithThresholds,
} from "./adminContentCommands.js";

export {
  listAdminModules,
  listArchivedModules,
  getModuleContentBundle,
  listLibraryModules,
  buildModuleExportEnvelope,
  buildCourseExportEnvelope,
} from "./adminContentQueries.js";
export type { ModuleLibraryStatus } from "./adminContentQueries.js";

export { adminContentRepository, createAdminContentRepository } from "./adminContentRepository.js";
