import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const submissionStatusSchema = z.enum([
  "SUBMITTED",
  "PROCESSING",
  "SCORED",
  "UNDER_REVIEW",
  "COMPLETED",
  "REJECTED",
]);

const moduleCompletionConfigSchema = z.object({
  completedSubmissionStatuses: z.array(submissionStatusSchema).min(1),
});

export type ModuleCompletionConfig = z.infer<typeof moduleCompletionConfigSchema>;

let cached: ModuleCompletionConfig | null = null;

export function getModuleCompletionConfig(): ModuleCompletionConfig {
  if (cached) {
    return cached;
  }

  const configPath = path.resolve(process.cwd(), "config/module-completion.json");
  const raw = fs.readFileSync(configPath, "utf8");
  cached = moduleCompletionConfigSchema.parse(JSON.parse(raw));
  return cached;
}

export function resetModuleCompletionConfigCacheForTests() {
  cached = null;
}
