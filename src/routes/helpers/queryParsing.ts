/**
 * Shared query-parameter parsing helpers used across route files.
 */

/**
 * Parse a date string from a query parameter.
 * Returns null if the input is missing or not a valid date.
 * When `inclusiveEndOfDay` is true and the input is a date-only string (≤10 chars),
 * the time is set to 23:59:59.999 so that `dateTo` is inclusive for the full day.
 */
export function parseQueryDate(input: string | undefined, inclusiveEndOfDay: boolean): Date | null {
  if (!input) {
    return null;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (inclusiveEndOfDay && input.length <= 10) {
    parsed.setHours(23, 59, 59, 999);
  }

  return parsed;
}

/**
 * Parse a comma-separated query parameter into an array of trimmed, uppercased strings.
 * Returns an empty array if the input is missing or produces no non-empty values.
 */
export function parseCsvFilter(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  return input
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);
}
