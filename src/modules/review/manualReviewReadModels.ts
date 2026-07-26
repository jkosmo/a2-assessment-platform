import { localizeContentText } from "../../i18n/content.js";
import { normalizeLocale } from "../../i18n/locale.js";

export type ManualReviewWorkspaceRecord = {
  id: string;
  submissionId: string;
  reviewStatus: string;
  triggerReason: string;
  reviewerId: string | null;
  reviewedAt: Date | null;
  overrideDecision: string | null;
  overrideReason: string | null;
  createdAt: Date;
  reviewer: { id: string; name: string; email: string } | null;
  submission: {
    id: string;
    submittedAt: Date;
    deliveryType: string;
    responseJson: string;
    // #475: aggregate-only AI-use declaration (nullable). Surfaced to the reviewer, never scored.
    processSignalsJson: string | null;
    user: { id: string; name: string; email: string; department: string | null };
    module: { id: string; title: string; description: string | null };
    moduleVersion: { id: string };
    mcqAttempts: unknown[];
    llmEvaluations: unknown[];
    decisions: unknown[];
    appeals: unknown[];
  };
};

function parseSubmissionResponse(responseJson: string) {
  try {
    return JSON.parse(responseJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseAiDeclaration(processSignalsJson: string | null) {
  if (!processSignalsJson) return { declaration: null as string | null, declarationText: null as string | null };
  try {
    const parsed = JSON.parse(processSignalsJson) as Record<string, unknown>;
    return {
      declaration: typeof parsed.declaration === "string" ? parsed.declaration : null,
      declarationText: typeof parsed.declarationText === "string" ? parsed.declarationText : null,
    };
  } catch {
    return { declaration: null, declarationText: null };
  }
}

export function toManualReviewWorkspaceView(workspace: ManualReviewWorkspaceRecord, locale: string) {
  const normalizedLocale = normalizeLocale(locale) ?? "en-GB";
  const sub = workspace.submission;
  const parsedResponse = parseSubmissionResponse(sub.responseJson);
  const aiDeclaration = parseAiDeclaration(sub.processSignalsJson);

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
        // #475: the participant's AI-use declaration, for the reviewer to weigh integrity.
        aiDeclaration: aiDeclaration.declaration,
        aiDeclarationText: aiDeclaration.declarationText,
        mcqAttempts: sub.mcqAttempts,
        llmEvaluations: sub.llmEvaluations,
        decisions: sub.decisions,
        appeals: sub.appeals,
      },
    },
  };
}

export type ManualReviewWorkspaceView = ReturnType<typeof toManualReviewWorkspaceView>;
