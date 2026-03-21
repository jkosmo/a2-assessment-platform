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

function escapeCsvValue(value: unknown) {
  if (value == null) {
    return "";
  }
  const asString = value instanceof Date ? value.toISOString() : String(value);
  const escaped = asString.replaceAll('"', '""');
  if (escaped.includes(",") || escaped.includes('"') || escaped.includes("\n")) {
    return `"${escaped}"`;
  }
  return escaped;
}

export function normalizeFilters(filters: ReportFilters) {
  return {
    moduleId: filters.moduleId ?? null,
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
