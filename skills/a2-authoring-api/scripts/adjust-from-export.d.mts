export interface ConversionResult {
  ok: boolean;
  problems: string[];
  pkg?: Record<string, unknown>;
  state?: { primaryLanguage: string; order: string[]; elements: Array<Record<string, unknown>> };
  changes?: { baseline: string; course?: string; elements: Record<string, string>; refs?: Record<string, { type: string; id: string }> };
  files?: string[];
  primaryLanguage?: string;
  courseRef?: string;
}
export function slugify(text: unknown, fallback?: string): string;
export function convertExport(
  envelope: unknown,
  options: { outDir: string; baselineFile?: string; write?: (file: string, data: string | Buffer) => void },
): ConversionResult;
export function formatConversion(result: ConversionResult, outDir: string): string;
