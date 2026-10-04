// Type surface for figure-motion-check.mjs (consumed by the TypeScript unit test).

export interface FigureMotionIssue {
  kind: string;
  detail: string;
}

export interface FigureMotionResult {
  ok: boolean;
  animated: boolean;
  sequence: boolean;
  totalSeconds: number | null;
  issues: FigureMotionIssue[];
}

export const MAX_TOTAL_SECONDS: number;
export function checkFigureMotion(svg: string): FigureMotionResult;
