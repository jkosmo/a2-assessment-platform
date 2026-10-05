export const ASSET_MIME: Readonly<Record<string, string>>;
export const SVG_MIME: string;
export const MAX_ASSET_BYTES: number;
export const MAX_TOTAL_BYTES: number;
export interface AssetProblem { path: string; message: string }
export function assetFileName(asset: unknown): string | null;
export function assetMimeType(asset: unknown): string | null;
export function resolvePackageAssets(
  pkg: unknown,
  options?: { baseDir?: string; readFile?: (file: string) => Uint8Array | string },
): { pkg: any; attached: number; problems: AssetProblem[] };
export function checkAssets(pkg: unknown): { ok: boolean; count: number; totalBytes: number; problems: AssetProblem[] };
