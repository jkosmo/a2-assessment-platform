// ACCEPTED TECHNICAL DEBT (#817, closed as won't-fix-proactively 2026-07-25): this barrel is over-wide
// and `course` ↔ `adminContent` import each other (cascade delete, assets, publish, import, agent
// authoring); appeal/review also duplicate assessment's orchestration. No runtime ES cycle — it's a
// maintainability/coupling smell (severity: low · plausible). The clean fix (extract a one-directional
// shared kernel, shrink this barrel to a deliberate surface, lift duplicated orchestration into a shared
// ApplicationService) is a large, risky refactor not worth a dedicated pass for a p4 concern. **Address
// opportunistically:** when you next touch these modules, prefer a narrow import over the wide barrel and
// nudge toward a shared kernel. See doc/design/ARCHITECTURE_REVIEW_2026-07-19.md.
export { checkAndIssueCourseCompletions, checkCourseCompletionForCourse, reconcileCourseCompletionsForUser } from "./courseCompletionService.js";
export { getCourseReport, getCourseLearnerReport } from "./courseReport.js";
export { createCourse, updateCourse, publishCourse, unpublishCourse, archiveCourse, restoreCourse, setCourseModules, setCourseItems, deleteCourse } from "./courseCommands.js";
export type { CourseItemInput } from "./courseCommands.js";
export { getCoursePublishPreview, publishCourseCascade } from "./coursePublishService.js";
export { getCourseCascadeDeletePreview, cascadeDeleteCourse } from "./courseCascadeDeleteService.js";
export type {
  CourseCascadeDeletePreview,
  CascadeDeleteEntry,
  CascadeDeleteSummary,
} from "./courseCascadeDeleteService.js";
export type {
  CoursePublishPreview,
  CourseUnpublishedItem,
  CoursePublishResult,
  PublishBlocker,
} from "./coursePublishService.js";
export {
  createSection,
  createSectionWithAssets,
  remapAssetRefs,
  updateSectionTitle,
  updateSectionContent,
  getSection,
  listSections,
  publishSection,
  unpublishSection,
  archiveSection,
  restoreSection,
  deleteSection,
  SECTION_CREATE_BODY_LIMIT_BYTES,
  type SectionAssetImportInput,
} from "./sectionCommands.js";
export {
  createSectionAsset,
  listSectionAssets,
  getSectionAssetContent,
  localizeSectionAssets,
  loadSectionAssetsForExport,
  importSectionAssets,
  ALLOWED_ASSET_MIME_TYPES,
  MAX_ASSET_BYTES,
  MAX_EXPORT_ASSET_TOTAL_BYTES,
  type ExportedSectionAsset,
} from "./assetCommands.js";
export { courseRepository, createCourseRepository } from "./courseRepository.js";
export { enrollmentRepository, createEnrollmentRepository } from "./enrollmentRepository.js";
export { classRepository, createClassRepository, SYSTEM_ALL_PARTICIPANTS_CLASS_ID } from "./classRepository.js";
export { isClassEntraLinkingEnabled, CLASS_ENTRA_LINKING_KEY } from "./classConfig.js";
export {
  createClass,
  archiveClass,
  restoreClass,
  addMember,
  removeMember,
  listClasses,
  listClassMembers,
  listClassCourseAssignments,
  assignCourseToClass,
  unassignCourseFromClass,
  getUserClassIds,
  getClassAssignedCourseDueDates,
} from "./classService.js";
export type { UserMembershipContext } from "./classService.js";
export { deriveEnrollmentStatus } from "./enrollmentStatus.js";
export type { EnrollmentStatus } from "./enrollmentStatus.js";
export {
  assignEnrollments,
  revokeEnrollment,
  selfEnroll,
  listUserEnrollments,
  listCourseEnrollments,
  filterVisibleCourseIds,
  isCourseVisibleToUser,
  // #959: den ene døra inn til «dette kurset, sett av denne deltakeren».
  findCourseForParticipant,
  isModuleInAccessibleCourse,
  canParticipantReadSection,
  deriveStatus,
} from "./enrollmentService.js";
export type {
  AssignEnrollmentsInput,
  AssignEnrollmentsResult,
  UserEnrollmentView,
  CourseEnrollmentView,
} from "./enrollmentService.js";
export { computeCourseStatus } from "./courseQueries.js";
export type {
  CourseStatus,
  CourseListItem,
  CourseDetail,
  CourseModuleEntry,
  CourseSequenceItem,
  AdminCourseListItem,
  AdminCourseDetail,
} from "./courseReadModels.js";
