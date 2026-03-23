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
  const parsedResponse = parseSubmissionResponse(workspace.submission.responseJson);

  return {
    review: {
      ...workspace,
      submission: {
        ...workspace.submission,
        module: {
          ...workspace.submission.module,
          title:
            localizeContentText(normalizedLocale, workspace.submission.module.title) ??
            workspace.submission.module.title,
          description:
            localizeContentText(normalizedLocale, workspace.submission.module.description ?? null) ??
            workspace.submission.module.description,
        },
        rawText: typeof parsedResponse.response === "string" ? parsedResponse.response : null,
        reflectionText:
          typeof parsedResponse.reflection === "string" ? parsedResponse.reflection : null,
        promptExcerpt:
          typeof parsedResponse.promptExcerpt === "string" ? parsedResponse.promptExcerpt : null,
      },
    },
  };
}

export type ManualReviewWorkspaceView = ReturnType<typeof toManualReviewWorkspaceView>;
