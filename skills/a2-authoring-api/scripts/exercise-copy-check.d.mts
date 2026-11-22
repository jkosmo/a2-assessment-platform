// Typer for exercise-copy-check.mjs (samme mønster som mcq-cue-check.d.mts).
export declare const SHARE_MAX: number;
export declare const WRITE_RUN: number;
export declare const PAIRS_RUN: number;

export interface Exercise {
  kind: "skriv" | "par" | "sjekk";
  line: number;
  opener: string;
  inner: string[];
  above: string;
}

export declare function readExercises(markdown: unknown): Exercise[];
export declare function checkExerciseCopies(markdown: unknown): Array<{ line: number; kind: Exercise["kind"]; detail: string }>;
