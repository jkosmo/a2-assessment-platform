// Typer for frame-structure.mjs (samme mønster som skill-provenance.d.mts). Plattformen importerer
// modulen som `#frame-structure` (package.json → "imports").
export type FrameOpener = "text" | "optional" | "none";

export interface FrameKind {
  kind: string;
  words: readonly string[];
  opener: FrameOpener;
  drawnAs: string;
  counts: string;
  shape: (inner: string, read: FrameReadOptions & { countHeadings: (inner: string) => number }) => string | null;
}

export interface FrameReadOptions {
  countHeadings?: (inner: string) => number;
}

export interface Frame {
  kind: string;
  shape: string;
}

export type FrameProblem =
  | { kind: string; problem: "count"; expected: number; actual: number }
  | { kind: string; problem: "drawn"; expected: number; actual: number }
  | { kind: string; problem: "shape"; position: number; expected: string; actual: string };

export declare const FRAME_KINDS: readonly FrameKind[];
export declare function countHeadingLines(text: string): number;
export declare function readFrames(text: string | null | undefined, options?: FrameReadOptions): Frame[];
export declare function frameSignature(text: string | null | undefined, options?: FrameReadOptions): string[];
export declare function compareFrames(source: string | null | undefined, translated: string | null | undefined, options?: FrameReadOptions): FrameProblem[];
export declare function describeFrameProblem(problem: FrameProblem): string;
