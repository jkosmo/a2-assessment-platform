// Typer for mcq-cue-check.mjs (samme mønster som figure-fit-check.d.mts).
export declare const LENGTH_RATIO: number;
export declare const MIN_OPTIONS: number;
export declare const MIN_SET_FOR_DISTRIBUTION: number;
export declare const POSITION_SHARE_MAX: number;
export declare const LONGEST_SHARE_MAX: number;

export interface McqCueIssue {
  index: number | null;
  kind: "too_few_options" | "catch_all_option" | "answer_not_an_option" | "correct_is_longest" | "position_bias" | "length_bias";
  detail: string;
}

export interface McqCueStats {
  questions: number;
  measured: number;
  correctPositionShare: Record<string, number>;
  correctLongestShare: number;
}

export declare function collectMcqSets(doc: unknown): Array<{ path: string; questions: unknown[] }>;
export declare function checkMcqCues(questions: unknown[], options?: { primary?: string }): { ok: boolean; issues: McqCueIssue[]; stats: McqCueStats };
