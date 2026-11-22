// Typer for text-overlap.mjs.
export declare function wordsOf(text: unknown): string[];
export declare function nGrams(words: string[], n: number): Set<string>;
export declare function sharesRun(text: unknown, grams: Set<string>, n: number): boolean;
export declare function coveredShare(text: unknown, grams: Set<string>, n: number): number;
