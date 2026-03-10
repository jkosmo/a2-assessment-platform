import { describe, expect, it } from "vitest";
import {
  getCompletedSubmissionStatuses,
  isSubmissionStatusCompleted,
  resolveCompletedHistoryLimit,
  resolveIncludeCompletedForAvailableModules,
} from "../src/services/moduleCompletionPolicyService.js";

describe("module completion policy service", () => {
  it("classifies completed submission statuses from config", () => {
    const completedStatuses = getCompletedSubmissionStatuses();
    expect(completedStatuses).toContain("COMPLETED");
    expect(isSubmissionStatusCompleted("COMPLETED")).toBe(true);
    expect(isSubmissionStatusCompleted("UNDER_REVIEW")).toBe(false);
  });

  it("resolves include-completed default and explicit query overrides", () => {
    expect(resolveIncludeCompletedForAvailableModules(undefined)).toBe(false);
    expect(resolveIncludeCompletedForAvailableModules(true)).toBe(true);
    expect(resolveIncludeCompletedForAvailableModules(false)).toBe(false);
  });

  it("bounds completed history limit to config max", () => {
    expect(resolveCompletedHistoryLimit(undefined)).toBe(50);
    expect(resolveCompletedHistoryLimit(10)).toBe(10);
    expect(resolveCompletedHistoryLimit(9999)).toBe(200);
  });
});
