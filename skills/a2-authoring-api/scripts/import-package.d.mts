// Type surface for import-package.mjs (consumed by the TypeScript integration test).

export interface AuthoringCreatedObject {
  clientRef: string;
  type: "section" | "module" | "course";
  id: string;
  links: Record<string, string>;
  // #763 (Layer B): present on sections created with inline figures/images — maps each
  // authoring `sourceId` to the new SectionAsset id the endpoint minted.
  assetMap?: Record<string, string>;
}

export interface AuthoringValidationReport {
  valid: boolean;
  summary: { errors: number; warnings: number; objects: number };
  issues: Array<{ severity: "error" | "warning"; path: string; code: string; message: string }>;
  plan: Array<{ op: string; clientRef: string }>;
}

export interface AuthoringStepStatus {
  op: string;
  clientRef: string;
  status: "done" | "failed" | "skipped";
  id?: string;
  links?: Record<string, string>;
}

export interface AuthoringImportResult {
  ok: boolean;
  runId: string;
  report: AuthoringValidationReport;
  created: AuthoringCreatedObject[];
  steps: AuthoringStepStatus[];
  failedStep: { op: string; clientRef: string } | null;
  error: string | null;
}

export interface AuthoringCallOptions {
  baseUrl: string;
  headers: Record<string, string>;
  pkg: unknown;
  runId?: string;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

export function synthesizeModuleEnvelope(modulePayload: unknown): Record<string, unknown>;
export function validatePackage(options: AuthoringCallOptions): Promise<AuthoringValidationReport>;
export function importPackage(options: AuthoringCallOptions): Promise<AuthoringImportResult>;
