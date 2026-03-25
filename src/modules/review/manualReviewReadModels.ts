import { localizeContentText } from "../../i18n/content.js";
import { normalizeLocale } from "../../i18n/locale.js";
import type { manualReviewRepository } from "./manualReviewRepository.js";

type ManualReviewWorkspaceRecord = NonNullable<
  Awaited<ReturnType<typeof manualReviewRepository.findManualReviewWorkspace>>
>;

function parseSubmissionResponse(responseJson: string) {
  try {
    return JSON.parse(responseJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function toManualReviewWorkspaceView(workspace: ManualReviewWorkspaceRecord, locale: string) {
  const normalizedLocale = normalizeLocale(locale) ?? "en-GB";
  const sub = workspace.submission;
  const parsedResponse = parseSubmissionResponse(sub.responseJson);

  return {
    review: {
      id: workspace.id,
      submissionId: workspace.submissionId,
      reviewStatus: workspace.reviewStatus,
      triggerReason: workspace.triggerReason,
      reviewerId: workspace.reviewerId,
      reviewedAt: workspace.reviewedAt,
      overrideDecision: workspace.overrideDecision,
      overrideReason: workspace.overrideReason,
      createdAt: workspace.createdAt,
      reviewer: workspace.reviewer,
      submission: {
        id: sub.id,
        submittedAt: sub.submittedAt,
        deliveryType: sub.deliveryType,
        responseJson: sub.responseJson,
        user: sub.user,
        module: {
          id: sub.module.id,
          title: localizeContentText(normalizedLocale, sub.module.title) ?? sub.module.title,
          description:
            localizeContentText(normalizedLocale, sub.module.description ?? null) ??
            sub.module.description,
        },
        moduleVersion: sub.moduleVersion,
        rawText: typeof parsedResponse.response === "string" ? parsedResponse.response : null,
        reflectionText:
          typeof parsedResponse.reflection === "string" ? parsedResponse.reflection : null,
        promptExcerpt:
          typeof parsedResponse.promptExcerpt === "string" ? parsedResponse.promptExcerpt : null,
        mcqAttempts: sub.mcqAttempts,
        llmEvaluations: sub.llmEvaluations,
        decisions: sub.decisions,
        appeals: sub.appeals,
      },
    },
  };
}

export type ManualReviewWorkspaceView = ReturnType<typeof toManualReviewWorkspaceView>;
