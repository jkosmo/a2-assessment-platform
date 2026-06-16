export type CourseStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export interface CourseListItem {
  id: string;
  title: string;
  description: string | null;
  moduleCount: number;
  progress: {
    completed: number;
    total: number;
    courseStatus: CourseStatus;
  };
}

export interface CourseModuleEntry {
  moduleId: string;
  sortOrder: number;
  title: string;
  moduleStatus: "NOT_STARTED" | "PASSED" | "IN_PROGRESS";
}

// A single step in the participant course sequence — either a module or a
// learning section (#491/P1), in sortOrder.
export type CourseSequenceItem =
  | { type: "MODULE"; sortOrder: number; moduleId: string; title: string; moduleStatus: "NOT_STARTED" | "PASSED" | "IN_PROGRESS" }
  | { type: "SECTION"; sortOrder: number; sectionId: string; title: string };

export interface CourseDetail extends CourseListItem {
  certificationLevel: string | null;
  publishedAt: string | null;
  modules: CourseModuleEntry[];
  items: CourseSequenceItem[];
}

export interface AdminCourseListItem {
  id: string;
  title: string;
  description: string | null;
  certificationLevel: string | null;
  moduleCount: number;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
}

export interface AdminCourseDetail {
  id: string;
  title: string;
  description: string | null;
  certificationLevel: string | null;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  modules: Array<{
    moduleId: string;
    sortOrder: number;
    moduleTitle: string;
    moduleArchivedAt: string | null;
  }>;
}
