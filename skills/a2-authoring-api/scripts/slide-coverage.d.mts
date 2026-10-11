export const FORMS: readonly string[];
export interface FormCounts { prompt: number; table: number; callout: number; cards: number }
export function countForms(markdown: unknown): FormCounts;
export interface CoverageRow { slide: unknown; becomes: string[]; in: string | null; problems: string[] }
export interface CoverageResult { ok: boolean; rows: CoverageRow[]; problems: string[] }
export interface Deck { slides: Array<{ number: number; pictures?: Array<{ file: string }> }> }
export function describeObjects(
  pkg: unknown,
  options?: { baseDir?: string },
): Map<string, { type: string; text: string; have: FormCounts & { figure: number }; pictures: Map<string, { shown: boolean; sourceId: string }> }>;
export function checkSlideCoverage(treatment: unknown, pkg: unknown, options?: { deck?: Deck | null; baseDir?: string }): CoverageResult;
export function formatCoverage(result: CoverageResult): string;
export function readDeck(deckDir: string | undefined): Deck | null;
