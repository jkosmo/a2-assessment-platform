import { getModuleCompletionConfig } from "../../config/moduleCompletion.js";
import type { SubmissionStatus as SubmissionStatusType } from "@prisma/client";

export function isSubmissionStatusCompleted(status: SubmissionStatusType | null | undefined) {
  if (!status) {
    return false;
  }

  const config = getModuleCompletionConfig();
  return config.completedSubmissionStatuses.includes(status);
}

export function resolveIncludeCompletedForAvailableModules(requestedIncludeCompleted?: boolean) {
  if (typeof requestedIncludeCompleted === "boolean") {
    return requestedIncludeCompleted;
  }

  const config = getModuleCompletionConfig();
  return !config.hideCompletedInAvailableByDefault;
}

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
