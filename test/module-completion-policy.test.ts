import { describe, expect, it } from "vitest";
import { getCompletedSubmissionStatuses } from "../src/modules/module/index.js";

// #952: `isSubmissionStatusCompleted` og `resolveIncludeCompletedForAvailableModules` er fjernet
// sammen med den frittstående modul-lista de tjente. 2.141.0: grensen for «Fullførte moduler»-historikken
// (`resolveCompletedHistoryLimit`) er fjernet sammen med `GET /api/modules/completed`.

describe("module completion policy service", () => {
  it("leser hvilke statuser som teller som fullført fra konfigurasjonen", () => {
    expect(getCompletedSubmissionStatuses()).toContain("COMPLETED");
  });
});
