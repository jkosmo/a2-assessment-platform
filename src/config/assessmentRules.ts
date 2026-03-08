import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "./env.js";

const rulesSchema = z.object({
  thresholds: z.object({
    totalMin: z.number().min(0).max(100),
    practicalMinPercent: z.number().min(0).max(100),
    mcqMinPercent: z.number().min(0).max(100),
  }),
  weights: z.object({
    practicalMaxScore: z.number().min(1),
    mcqMaxScore: z.number().min(1),
  }),
  manualReview: z.object({
    borderlineWindow: z.object({
      min: z.number(),
      max: z.number(),
    }),
    redFlagSeverities: z.array(z.string().min(1)),
  }),
});

export type AssessmentRules = z.infer<typeof rulesSchema>;

let cached: AssessmentRules | null = null;

export function getAssessmentRules(): AssessmentRules {
  if (cached) {
    return cached;
  }

  const rulesPath = path.resolve(process.cwd(), env.ASSESSMENT_RULES_FILE);
  const raw = fs.readFileSync(rulesPath, "utf8");
  const parsedJson = JSON.parse(raw);
  cached = rulesSchema.parse(parsedJson);
  return cached;
}

