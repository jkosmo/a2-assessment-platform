export interface FrameLine { text: string; bullet: boolean; bold: boolean; level: number }
export interface Frame {
  x: number; y: number; w: number; h: number;
  heading: string;
  colour: string | null;
  icons: string[];
  lines: FrameLine[];
  highlighted?: boolean;
}
export interface FlowStep { label: string; description: string; icon: string | null; colour: string | null }
export interface FlowPhase { name: string; colour: string | null; steps: number[] }
export interface SlidePicture { file: string; kB: number; width?: number; height?: number; x: number; y: number; w: number; h: number }
export interface Slide {
  number: number;
  title: string;
  subtitle: string;
  layout: string[];
  flow: { steps: FlowStep[]; phases: FlowPhase[] } | null;
  /** Rows of frames: frames at the same height stand side by side. */
  frames: Frame[][];
  tables: string[][][];
  smartArt: string[];
  text: string[];
  notes: string;
  pictures: SlidePicture[];
  icons: string[];
  colours: Array<{ hex: string; uses: number }>;
  words: number;
}
export interface Presentation {
  size: { w: number; h: number };
  slides: Slide[];
  images: Array<{ file: string; slide: number; bytes: Buffer; kB: number; width?: number; height?: number }>;
  icons: Array<{ file: string; svg: string; recoloured: boolean; slides: number[] }>;
}
export function readPresentation(buffer: Buffer): Presentation;
export function describePresentation(presentation: Presentation, options?: { name?: string }): string;
export function darkenLightIcon(svg: string): { svg: string; recoloured: boolean };
export const ICON_SIZE: number;
export function sizeIcon(svg: string): string;
