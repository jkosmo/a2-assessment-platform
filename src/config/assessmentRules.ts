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
  mcqQuality: z
    .object({
      minAttemptCount: z.number().int().positive().default(5),
      difficultyMin: z.number().min(0).max(1).default(0.2),
      difficultyMax: z.number().min(0).max(1).default(0.9),
      discriminationMin: z.number().min(-1).max(1).default(0.1),
    })
    .default({
      minAttemptCount: 5,
      difficultyMin: 0.2,
      difficultyMax: 0.9,
      discriminationMin: 0.1,
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
