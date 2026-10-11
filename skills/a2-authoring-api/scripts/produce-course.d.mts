export interface ProductionCheck { name: string; status: "ok" | "fail" | "skipped"; summary: string; details: string[] }
export interface ProductionResult { ok: boolean; checks: ProductionCheck[]; files: Array<{ file: string; importAt: string }> }
export function produceCourse(options: {
  packageFile: string;
  outFile?: string;
  stateFile?: string;
  slidesFile?: string;
  deckDir?: string;
  packageOut?: string;
  now?: Date;
}): Promise<ProductionResult>;
export function formatProduction(result: ProductionResult): string;
