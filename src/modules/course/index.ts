export { checkAndIssueCourseCompletions } from "./courseCompletionService.js";
export { createCourse, updateCourse, publishCourse, archiveCourse, setCourseModules } from "./courseCommands.js";
export { courseRepository, createCourseRepository } from "./courseRepository.js";
export { computeCourseStatus } from "./courseQueries.js";
export type {
  CourseStatus,
  CourseListItem,
  CourseDetail,
  CourseModuleEntry,
  AdminCourseListItem,
  AdminCourseDetail,
} from "./courseReadModels.js";
