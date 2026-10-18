export const TEXT_DRIFT_THRESHOLD: number;
export function textDriftScore(previous: string | null | undefined, next: string | null | undefined): number;
export function isSubstantialTextChange(previous: string | null | undefined, next: string | null | undefined, threshold?: number): boolean;
