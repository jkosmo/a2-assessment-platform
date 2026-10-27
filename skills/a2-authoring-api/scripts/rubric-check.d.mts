// Typer for rubric-check.mjs (samme mønster som mcq-cue-check.d.mts).
export interface Steps {
  min: number;
  max: number | null;
  described: number[];
}

export declare function criterionText(criterion: unknown, primary?: string): string;
export declare function describedSteps(criterion: unknown, primary?: string): Steps;
export declare function scaleIsDescribed(steps: Steps): boolean;
export declare function stepTexts(
  criterion: unknown,
  primary?: string,
  options?: { defaultMax?: number | null },
): { min: number; max: number | null; intro: string | null; steps: Array<{ step: number; text: string }> };
export declare function checkRubricScales(
  criteria: Record<string, unknown> | null | undefined,
  options?: { primary?: string },
): Array<{ criterion: string; kind: "scale_not_described"; detail: string }>;
export declare function collectRubrics(doc: unknown): Array<{ path: string; title?: unknown; criteria: Record<string, unknown> }>;
