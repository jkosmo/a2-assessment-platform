import type { AppRole as AppRoleType } from "@prisma/client";
import { AppRole } from "../../db/prismaRuntime.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { localizeContentText } from "../../i18n/content.js";
import { assessmentPolicyCodec } from "../../codecs/assessmentPolicyCodec.js";
import { submissionSchemaCodec } from "../../codecs/submissionSchemaCodec.js";
import {
  queryModules,
  queryModuleById,
  queryModuleVersion,
} from "../../repositories/moduleRepository.js";
import {
  queryLatestSubmissionsForModules,
  queryCompletedSubmissionsForUser,
} from "../submission/submissionRepository.js";
import {
  getCompletedSubmissionStatuses,
  isSubmissionStatusCompleted,
} from "./moduleCompletionPolicyService.js";

const ADMIN_READ_ROLES: AppRoleType[] = [
  AppRole.ADMINISTRATOR,
  AppRole.SUBJECT_MATTER_OWNER,
  AppRole.REVIEWER,
  AppRole.APPEAL_HANDLER,
  AppRole.REPORT_READER,
];

function hasAdminRead(roles: AppRoleType[]) {
  return roles.some((role) => ADMIN_READ_ROLES.includes(role));
}

type ListModulesOptions = {
  includeCompleted?: boolean;
  participantFacing?: boolean;
};

export async function listModules(
  roles: AppRoleType[],
  userId?: string,
  locale: SupportedLocale = "en-GB",
  options: ListModulesOptions = {},
) {
  const now = new Date();
  const adminRead = options.participantFacing ? false : hasAdminRead(roles);
  const modules = await queryModules(adminRead, now);

  if (!userId) {
    return modules.map((module) => ({
      ...module,
      title: localizeContentText(locale, module.title) ?? module.title,
      description: localizeContentText(locale, module.description),
      taskText: localizeContentText(locale, module.activeVersion?.taskText) ?? module.activeVersion?.taskText ?? null,
      guidanceText: localizeContentText(locale, module.activeVersion?.guidanceText),
      submissionSchema: submissionSchemaCodec.parse(module.activeVersion?.submissionSchemaJson),
      assessmentPolicy: assessmentPolicyCodec.parse(module.activeVersion?.assessmentPolicyJson),
    }));
  }

  const moduleIds = modules.map((m) => m.id);
  const latestSubmissions = moduleIds.length > 0
    ? await queryLatestSubmissionsForModules(userId, moduleIds)
    : [];

  const latestByModule = new Map<
    string,
    {
      id: string;
      submittedAt: Date;
      submissionStatus: (typeof latestSubmissions)[number]["submissionStatus"];
      latestDecision: (typeof latestSubmissions)[number]["decisions"][number] | null;
    }
  >();

  for (const submission of latestSubmissions) {
    if (!latestByModule.has(submission.moduleId)) {
      latestByModule.set(submission.moduleId, {
        id: submission.id,
        submittedAt: submission.submittedAt,
        submissionStatus: submission.submissionStatus,
        latestDecision: submission.decisions[0] ?? null,
      });
    }
  }

  const mapped = modules.map((module) => {
    const latest = latestByModule.get(module.id);
    return {
      ...module,
      title: localizeContentText(locale, module.title) ?? module.title,
      description: localizeContentText(locale, module.description),
      taskText: localizeContentText(locale, module.activeVersion?.taskText) ?? module.activeVersion?.taskText ?? null,
      guidanceText: localizeContentText(locale, module.activeVersion?.guidanceText),
      submissionSchema: submissionSchemaCodec.parse(module.activeVersion?.submissionSchemaJson),
      assessmentPolicy: assessmentPolicyCodec.parse(module.activeVersion?.assessmentPolicyJson),
      participantStatus: latest
        ? {
            latestSubmissionId: latest.id,
            latestSubmittedAt: latest.submittedAt,
            latestStatus: latest.submissionStatus,
            latestDecision: latest.latestDecision,
          }
        : null,
    };
  });

  if (options.includeCompleted === true) {
    return mapped;
  }

  return mapped.filter(
    (module) => !isSubmissionStatusCompleted(module.participantStatus?.latestStatus ?? null),
  );
}

export async function listCompletedModulesForUser(
  userId: string,
  locale: SupportedLocale = "en-GB",
  limit = 50,
) {
  const completedStatuses = getCompletedSubmissionStatuses();
  const submissions = await queryCompletedSubmissionsForUser(userId, completedStatuses, limit * 10);

  const modules = new Map<
    string,
    {
      moduleId: string;
      moduleTitle: string;
      latestSubmissionId: string;
      latestCompletedAt: Date;
      latestStatus: string;
      latestDecision: (typeof submissions)[number]["decisions"][number] | null;
    }
  >();

  for (const submission of submissions) {
    if (modules.has(submission.moduleId)) {
      continue;
    }

    modules.set(submission.moduleId, {
      moduleId: submission.module.id,
      moduleTitle: localizeContentText(locale, submission.module.title) ?? submission.module.title,
      latestSubmissionId: submission.id,
      latestCompletedAt: submission.submittedAt,
      latestStatus: submission.submissionStatus,
      latestDecision: submission.decisions[0] ?? null,
    });

    if (modules.size >= limit) {
      break;
    }
  }

  return Array.from(modules.values());
}

export async function getModuleById(
  moduleId: string,
  roles: AppRoleType[],
  locale: SupportedLocale = "en-GB",
  options: { participantFacing?: boolean } = {},
) {
  const now = new Date();
  const adminRead = options.participantFacing ? false : hasAdminRead(roles);
  const module = await queryModuleById(moduleId, adminRead, now);

  if (!module) {
    return null;
  }

  return {
    ...module,
    title: localizeContentText(locale, module.title) ?? module.title,
    description: localizeContentText(locale, module.description),
    taskText: localizeContentText(locale, module.activeVersion?.taskText) ?? module.activeVersion?.taskText ?? null,
    guidanceText: localizeContentText(locale, module.activeVersion?.guidanceText),
  };
}

export async function getActiveModuleVersion(
  moduleId: string,
  roles: AppRoleType[],
  locale: SupportedLocale = "en-GB",
  options: { participantFacing?: boolean } = {},
) {
  const module = await getModuleById(moduleId, roles, locale, options);
  if (!module?.activeVersion) {
    return null;
  }

  const activeVersion = await queryModuleVersion(module.activeVersion.id);
  if (!activeVersion) {
    return null;
  }

  return {
    ...activeVersion,
    taskText: localizeContentText(locale, activeVersion.taskText) ?? activeVersion.taskText,
    guidanceText: localizeContentText(locale, activeVersion.guidanceText),
    submissionSchema: submissionSchemaCodec.parse(activeVersion.submissionSchemaJson),
    assessmentPolicy: assessmentPolicyCodec.parse(activeVersion.assessmentPolicyJson),
  };
}
