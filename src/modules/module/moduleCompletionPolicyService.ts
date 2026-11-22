import { getModuleCompletionConfig } from "../../config/moduleCompletion.js";
import type { SubmissionStatus as SubmissionStatusType } from "@prisma/client";

// #952: `isSubmissionStatusCompleted` og `resolveIncludeCompletedForAvailableModules` er fjernet
// sammen med den frittstående modul-lista de tjente. 2.141.0: grensen for «Fullførte moduler»-historikken er fjernet
// sammen med `GET /api/modules/completed`; profilen leser beståtte moduler fra `GET /api/me/stats`.

export function getCompletedSubmissionStatuses() {
  return getModuleCompletionConfig().completedSubmissionStatuses;
}
