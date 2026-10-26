// Typer for section-text-check.mjs (samme mønster som rubric-check.d.mts).
export declare const ALT_MIN_WORDS: number;
export declare function checkAltTexts(markdown: unknown): Array<{ alt: string; words: number }>;
export declare function checkLeftovers(markdown: unknown): Array<{ kind: "note" | "section_number"; text: string }>;
export declare function checkFigureNumbers(markdowns: unknown[]): Array<{ expected: number; actual: number; order: number[] }>;
