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
    // #714: per-type oppdeling så deltaker-UI kan vise «Moduler x/y · Seksjoner x/y» i stedet for
    // den misvisende «x/total moduler» (total = moduler + seksjoner).
    moduleCompleted: number;
    moduleTotal: number;
    sectionCompleted: number;
    sectionTotal: number;
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
// courseItemId + discussionsEnabled (#495/T-QA-3): lar deltaker-UI feste diskusjonstråder på
// det konkrete CourseItem og skjule panelet når diskusjon er avskrudd for elementet.
export type CourseSequenceItem =
  | { type: "MODULE"; sortOrder: number; moduleId: string; courseItemId: string; title: string; moduleStatus: "NOT_STARTED" | "PASSED" | "IN_PROGRESS"; discussionsEnabled: boolean; available: boolean }
  | { type: "SECTION"; sortOrder: number; sectionId: string; courseItemId: string; title: string; read: boolean; discussionsEnabled: boolean };

export interface CourseDetail extends CourseListItem {
  certificationLevel: string | null;
  publishedAt: string | null;
  discussionsEnabled: boolean;
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
  // #705-UX(F): antall deltakere som er midt i kurset (påbegynt, ikke fullført).
  inProgressCount: number;
}

export interface AdminCourseDetail {
  id: string;
  title: string;
  description: string | null;
  certificationLevel: string | null;
  enrollmentPolicy: string;
  discussionsEnabled: boolean;
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
