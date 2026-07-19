import type { ReportFilters } from "./types.js";

export function toCsv(
  rows: Array<Record<string, unknown>>,
  columnOrder?: string[],
) {
  const columns =
    columnOrder && columnOrder.length > 0
      ? columnOrder
      : Array.from(rows.reduce((set, row) => {
          for (const key of Object.keys(row)) {
            set.add(key);
          }
          return set;
        }, new Set<string>()));

  const header = columns.join(",");
  const dataLines = rows.map((row) => columns.map((column) => escapeCsvValue(row[column])).join(","));
  return [header, ...dataLines].join("\n");
}

// A cell whose text begins with one of these is executed as a formula when the CSV is opened in
// Excel / Google Sheets (CSV formula injection, CWE-1236).
const CSV_FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

function escapeCsvValue(value: unknown) {
  if (value == null) {
    return "";
  }
  const asString = value instanceof Date ? value.toISOString() : String(value);
  // Neutralize formula injection for author/participant-controlled text (module/course titles, names,
  // free-text) by prefixing an apostrophe, which spreadsheets treat as "force text" and hide. Only for
  // string-origin cells, so numeric columns (e.g. a negative number like -5) and dates are untouched.
  const guarded =
    typeof value === "string" && CSV_FORMULA_TRIGGERS.test(asString) ? `'${asString}` : asString;
  const escaped = guarded.replaceAll('"', '""');
  if (escaped.includes(",") || escaped.includes('"') || escaped.includes("\n")) {
    return `"${escaped}"`;
  }
  return escaped;
}

export function normalizeFilters(filters: ReportFilters) {
  return {
    moduleId: filters.moduleId ?? null,
    courseId: filters.courseId ?? null,
    statuses: filters.statuses ?? [],
    dateFrom: filters.dateFrom?.toISOString() ?? null,
    dateTo: filters.dateTo?.toISOString() ?? null,
    orgUnit: filters.orgUnit ?? null,
  };
}

export function round2(input: number) {
  return Number(input.toFixed(4));
}

export function buildDateRangeWhere(filters: ReportFilters) {
  return filters.dateFrom || filters.dateTo
    ? {
        submittedAt: {
          ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
          ...(filters.dateTo ? { lte: filters.dateTo } : {}),
        },
      }
    : {};
}
