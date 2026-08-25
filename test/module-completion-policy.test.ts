import { describe, expect, it } from "vitest";
import {
  getCompletedSubmissionStatuses,
  resolveCompletedHistoryLimit,
} from "../src/modules/module/index.js";

// #952: `isSubmissionStatusCompleted` og `resolveIncludeCompletedForAvailableModules` er fjernet
// sammen med den frittstående modul-lista de tjente. Det som står igjen gjelder «Fullførte
// moduler»-historikken på /profile og «Mine kurs → Fullførte», som er levende flater.

describe("module completion policy service", () => {
  it("leser hvilke statuser som teller som fullført fra konfigurasjonen", () => {
    expect(getCompletedSubmissionStatuses()).toContain("COMPLETED");
  });

  it("bounds completed history limit to config max", () => {
    expect(resolveCompletedHistoryLimit(undefined)).toBe(50);
    expect(resolveCompletedHistoryLimit(10)).toBe(10);
    expect(resolveCompletedHistoryLimit(9999)).toBe(200);
  });
});
