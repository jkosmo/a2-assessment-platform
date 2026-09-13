export type ReportFilters = {
  moduleId?: string;
  courseId?: string;
  statuses?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  orgUnit?: string;
  // #1058: kursene kalleren har lov til å se (SMO: egne kurs). undefined = alle. Settes av ruta fra
  // roller og bruker (reporting/scope.ts), aldri fra spørrestrengen.
  allowedCourseIds?: string[];
};
