// Typer for objective-map-check.mjs (samme mønster som section-text-check.d.mts).
export interface ObjectiveMapFinding { severity: "fail" | "note"; ref: string | null; detail: string }
export interface ObjectiveMapResult { objectives: number; linked: number; findings: ObjectiveMapFinding[] }
export declare function checkObjectiveMap(
  state: unknown,
  options?: {
    order?: Array<{ ref: string; type: string | undefined }> | null;
    modules?: Array<{ ref: string; questions: string[]; hasTask: boolean }> | null;
    partial?: boolean;
  },
): ObjectiveMapResult;
export declare function formatObjectiveMap(result: ObjectiveMapResult): string;
