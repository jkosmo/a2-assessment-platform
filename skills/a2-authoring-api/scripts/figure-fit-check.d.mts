// Type surface for figure-fit-check.mjs (consumed by the TypeScript unit test).

export interface FigureFitIssue {
  text: string;
  kind: string;
  detail: string;
}

export interface FigureFitResult {
  ok: boolean;
  issues: FigureFitIssue[];
}

export function checkFigureFit(svg: string): FigureFitResult;
export function estimateTextWidth(text: string, fontSize: number): number;
