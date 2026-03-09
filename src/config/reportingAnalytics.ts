import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const analyticsSchema = z.object({
  kpiDefinitions: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      formula: z.string().min(1),
    }),
  ),
  trends: z.object({
    defaultGranularity: z.enum(["day", "week", "month"]).default("week"),
    allowedGranularities: z.array(z.enum(["day", "week", "month"])).default(["day", "week", "month"]),
  }),
  cohorts: z.object({
    defaultCohortBy: z.enum(["month", "department"]).default("month"),
    allowedCohortBy: z.array(z.enum(["month", "department"])).default(["month", "department"]),
  }),
  dataQuality: z.object({
    maxMissingDecisionRate: z.number().min(0).max(1).default(0.1),
    maxDecisionWithoutEvaluationRate: z.number().min(0).max(1).default(0.05),
  }),
});

export type ReportingAnalyticsConfig = z.infer<typeof analyticsSchema>;

let cached: ReportingAnalyticsConfig | null = null;

export function getReportingAnalyticsConfig() {
  if (cached) {
    return cached;
  }

  const configPath = path.resolve(process.cwd(), "config/reporting-analytics.json");
  const raw = fs.readFileSync(configPath, "utf8");
  cached = analyticsSchema.parse(JSON.parse(raw));
  return cached;
}
