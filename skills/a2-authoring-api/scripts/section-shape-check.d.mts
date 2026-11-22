// Typer for section-shape-check.mjs (samme mønster som rubric-check.d.mts).
export declare const CALLOUT_MAX: number;
export declare const LIST_MAX_ITEMS: number;
export declare function summaryHeadings(markdown: unknown): string[];
export declare function callouts(markdown: unknown): string[];
export declare function longLists(markdown: unknown): Array<{ items: number; first: string }>;
export declare function selfDescription(markdown: unknown): string | null;
export declare const WORDS_PER_CALLOUT: number;
export declare const REVISION_MIN_QUESTIONS: number;
export declare function proseWordCount(markdown: unknown): number;
export declare function calloutsAllowed(words: number): number;
export declare function isRevisionTitle(title: unknown): boolean;
export declare function checkFrameCount(markdown: unknown): number;
