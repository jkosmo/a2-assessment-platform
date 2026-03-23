import { buildAppealSlaSnapshot } from "./appealSla.js";
import { localizeContentText } from "../../i18n/content.js";
import { normalizeLocale } from "../../i18n/locale.js";
import type { appealRepository } from "./appealRepository.js";

type AppealWorkspaceRecord = NonNullable<Awaited<ReturnType<typeof appealRepository.findAppealWorkspace>>>;

export function toAppealWorkspaceView(workspace: AppealWorkspaceRecord, locale: string) {
  const normalizedLocale = normalizeLocale(locale) ?? "en-GB";

  return {
    appeal: {
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
