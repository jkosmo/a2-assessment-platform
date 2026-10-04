// Type surface for draw-flow-figure.mjs (consumed by the TypeScript unit test).

export interface FlowPhase {
  /** Shown over the phase's steps, with a line. Left out: no line. */
  label?: string;
  /** The colour a step rests in. Opaque hex. */
  grunn: string;
  /** The colour a step lights up in, and the colour of the phase line. Opaque hex. */
  lys: string;
  /** The colour of the phase label. Opaque hex. */
  tekst?: string;
}

export interface FlowStep {
  /** One or two short lines. */
  label: string[];
  /** A key of `phases`. */
  phase: string;
}

export interface FlowDescription {
  name: string;
  title: string;
  desc: string;
  phases: Record<string, FlowPhase>;
  steps: FlowStep[];
}

export function describeProblems(description: unknown): string[];
export function drawFlowFigure(description: FlowDescription): { wide: string; narrow: string };
