import { getModuleCompletionConfig } from "../../config/moduleCompletion.js";
import type { SubmissionStatus as SubmissionStatusType } from "@prisma/client";

// #952: `isSubmissionStatusCompleted` og `resolveIncludeCompletedForAvailableModules` er fjernet
// sammen med den frittstående modul-lista de tjente. Det som står igjen gjelder «Fullførte
// moduler»-historikken, som er en levende flate.

export function resolveCompletedHistoryLimit(requestedLimit?: number) {
  const config = getModuleCompletionConfig();
  const fallback = config.defaultCompletedHistoryLimit;
  const max = config.maxCompletedHistoryLimit;
  const value = Number.isFinite(requestedLimit) ? Number(requestedLimit) : fallback;
  const bounded = Math.max(1, Math.min(max, value));
  return Number.isInteger(bounded) ? bounded : Math.floor(bounded);
}

export function getCompletedSubmissionStatuses() {
  return getModuleCompletionConfig().completedSubmissionStatuses;
}
