export {
  createModule,
  updateModuleTitle,
  deleteModule,
  createRubricVersion,
  ensureRubricVersion,
  syncActiveRubricBlueprintHash,
  createPromptTemplateVersion,
  createMcqSetVersion,
  createModuleVersion,
  createBenchmarkExampleVersion,
  publishModuleVersion,
  restoreModuleVersion,
  unpublishModule,
  archiveModule,
  restoreModule,
  publishModuleVersionWithThresholds,
  listUnpublishedPurgeCandidates,
  purgeUnpublishedModules,
} from "./adminContentCommands.js";

export {
  listAdminModules,
  listArchivedModules,
  getModuleContentBundle,
  listLibraryModules,
  buildModuleExportEnvelope,
  buildCourseExportEnvelope,
  buildSectionExportEnvelope,
} from "./adminContentQueries.js";
export type { ModuleLibraryStatus } from "./adminContentQueries.js";

export { adminContentRepository, createAdminContentRepository } from "./adminContentRepository.js";

export { hashBlueprint } from "./blueprintHash.js";
