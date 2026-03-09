import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const benchmarkExamplesSchema = z.object({
  maxExamplesPerVersion: z.number().int().positive().default(20),
  maxTextLength: z.number().int().positive().default(4000),
  requiredFields: z.array(z.string().min(1)).default(["anchorId", "input", "expectedOutcome"]),
});

export type BenchmarkExamplesConfig = z.infer<typeof benchmarkExamplesSchema>;

let cached: BenchmarkExamplesConfig | null = null;

export function getBenchmarkExamplesConfig(): BenchmarkExamplesConfig {
  if (cached) {
    return cached;
  }

  const configPath = path.resolve(process.cwd(), "config/benchmark-examples.json");
  const raw = fs.readFileSync(configPath, "utf8");
  cached = benchmarkExamplesSchema.parse(JSON.parse(raw));
  return cached;
}
