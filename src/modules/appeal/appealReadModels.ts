import { buildAppealSlaSnapshot } from "./appealSla.js";
import { localizeContentText } from "../../i18n/content.js";
import { normalizeLocale } from "../../i18n/locale.js";
import type { AppealStatus } from "@prisma/client";

export type AppealWorkspaceRecord = {
  id: string;
  submissionId: string;
  appealStatus: AppealStatus;
  appealReason: string;
  resolutionNote: string | null;
  resolvedById: string | null;
  createdAt: Date;
  claimedAt: Date | null;
  resolvedAt: Date | null;
  appealedBy: { id: string; name: string; email: string; department: string | null };
  resolvedBy: { id: string; name: string; email: string } | null;
  submission: {
    id: string;
    submittedAt: Date;
    user: { id: string; name: string; email: string; department: string | null };
    module: { id: string; title: string; description: string | null };
    moduleVersion: { id: string };
    mcqAttempts: unknown[];
    llmEvaluations: unknown[];
    decisions: unknown[];
    manualReviews: unknown[];
  };
};

export function toAppealWorkspaceView(workspace: AppealWorkspaceRecord, locale: string) {
  const normalizedLocale = normalizeLocale(locale) ?? "en-GB";
  const sub = workspace.submission;

  return {
    appeal: {
      id: workspace.id,
      submissionId: workspace.submissionId,
      appealStatus: workspace.appealStatus,
      appealReason: workspace.appealReason,
      resolutionNote: workspace.resolutionNote,
      resolvedById: workspace.resolvedById,
      createdAt: workspace.createdAt,
      claimedAt: workspace.claimedAt,
      resolvedAt: workspace.resolvedAt,
      appealedBy: workspace.appealedBy,
      resolvedBy: workspace.resolvedBy,
      submission: {
        id: sub.id,
        submittedAt: sub.submittedAt,
        user: sub.user,
        module: {
          id: sub.module.id,
          title: localizeContentText(normalizedLocale, sub.module.title) ?? sub.module.title,
          description:
            localizeContentText(normalizedLocale, sub.module.description ?? null) ??
            sub.module.description,
        },
        moduleVersion: sub.moduleVersion,
        mcqAttempts: sub.mcqAttempts,
        llmEvaluations: sub.llmEvaluations,
        decisions: sub.decisions,
        manualReviews: sub.manualReviews,
      },
    },
    sla: buildAppealSlaSnapshot({
      createdAt: workspace.createdAt,
      claimedAt: workspace.claimedAt,
      resolvedAt: workspace.resolvedAt,
      appealStatus: workspace.appealStatus,
    }),
  };
}

export type AppealWorkspaceView = ReturnType<typeof toAppealWorkspaceView>;
