import type { AppRole as AppRoleType } from "@prisma/client";
import { AppRole } from "../../db/prismaRuntime.js";
import { hasAnyRole, MODULE_ADMIN_READERS } from "../../auth/roleSets.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { localizeContentText } from "../../i18n/content.js";
import { renderSectionMarkdown } from "../course/sectionContent.js";
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
} from "./moduleCompletionPolicyService.js";

// #962: settet bor nå i `src/auth/roleSets.ts`, sammen med de nitten andre rollesjekkene. Det er
// UENDRET — poenget med flyttingen er at man skal kunne lese hele policyen ett sted og se hvor
// settene er uenige, ikke at noen skal miste eller få tilgang.
function hasAdminRead(roles: AppRoleType[]) {
  return hasAnyRole(roles, MODULE_ADMIN_READERS);
}

type ListModulesOptions = {
  includeCompleted?: boolean;
  participantFacing?: boolean;
};

/**
 * #1051: oppgaveteksten og veiledningen — både som tekst og som rendret HTML.
 *
 * ⚠️ HVORFOR HTML HER, OG IKKE I KLIENTEN. Skill-en skriver oppgaveteksten i markdown, og klienten
 * satte den som `textContent`. Deltakeren så `## Oppgave` og `**uthevet**` som tegn på skjermen.
 *
 * Seksjoner har hatt løsningen hele tiden: `renderSectionMarkdown` — `marked` med sanitisering — og
 * prinsippet står i `sectionContent.ts`: forfatterskrevet markdown stoles aldri på, den rendres til
 * HTML på serveren og saniteres der. Modulens tekst er samme slags innhold fra samme slags
 * forfatter, og skal gjennom samme dør. Rendret vi i klienten, fikk vi to sanitiseringsregimer for
 * samme innhold, og de ville glidd fra hverandre.
 *
 * ⚠️ ÉN KILDE FOR FIRE KALLSTEDER. Feltene ble bygget inline fire steder i denne fila. Å legge til
 * HTML-en på tre av dem hadde vært den samme «N−1»-feilen som har truffet oss sju ganger — derfor
 * bor formen her, og kallstedene sprer den.
 *
 * Råteksten beholdes ved siden av: klienten trenger den til forhåndsvisning og redigering, og en
 * API-konsument uten DOM skal ikke måtte strippe HTML for å lese oppgaven.
 */
function briefFields(
  version: { taskText?: unknown; candidateTaskConstraints?: unknown } | null | undefined,
  locale: SupportedLocale,
) {
  const taskText = localizeContentText(locale, version?.taskText as never) ?? (version?.taskText as string | null | undefined) ?? null;
  const candidateTaskConstraints = localizeContentText(locale, version?.candidateTaskConstraints as never) ?? null;
  return {
    taskText,
    taskTextHtml: typeof taskText === "string" ? renderSectionMarkdown(taskText, locale) : null,
    candidateTaskConstraints,
    candidateTaskConstraintsHtml:
      typeof candidateTaskConstraints === "string" ? renderSectionMarkdown(candidateTaskConstraints, locale) : null,
  };
}

export async function listModules(
  roles: AppRoleType[],
  userId?: string,
  locale: SupportedLocale = "en-GB",
  options: ListModulesOptions = {},
) {
  const now = new Date();
  const participantFacing = options.participantFacing ?? false;
  const adminRead = participantFacing ? false : hasAdminRead(roles);
  const modules = await queryModules(adminRead, now);

  if (!userId) {
    return modules.map((module) => ({
      ...module,
      title: localizeContentText(locale, module.title) ?? module.title,
      description: localizeContentText(locale, module.description),
      ...briefFields(module.activeVersion, locale),
      ...(participantFacing ? {} : { assessorExpectedContent: localizeContentText(locale, module.activeVersion?.assessorExpectedContent) }),
      submissionSchema: submissionSchemaCodec.parse(module.activeVersion?.submissionSchemaJson),
      assessmentPolicy: assessmentPolicyCodec.parse(module.activeVersion?.assessmentPolicyJson),
      assessmentMode: module.activeVersion?.assessmentMode ?? null,
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
      ...briefFields(module.activeVersion, locale),
      ...(participantFacing ? {} : { assessorExpectedContent: localizeContentText(locale, module.activeVersion?.assessorExpectedContent) }),
      submissionSchema: submissionSchemaCodec.parse(module.activeVersion?.submissionSchemaJson),
      assessmentPolicy: assessmentPolicyCodec.parse(module.activeVersion?.assessmentPolicyJson),
      assessmentMode: module.activeVersion?.assessmentMode ?? null,
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

  // #952: lista returnerer nå ALT. Skjulingen av «fullførte» fantes bare for den frittstående
  // modul-lista i deltakerkonsollet, og den flaten er fjernet — deltakeren når moduler gjennom
  // «Mine kurs». Konfigurerbarheten kostet oppmerksomhet uten å gi noen noe: hver leser måtte
  // sjekke kallstedet for å vite om filteret var på.
  return mapped;
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
  const participantFacing = options.participantFacing ?? false;
  const adminRead = participantFacing ? false : hasAdminRead(roles);
  const module = await queryModuleById(moduleId, adminRead, now);

  if (!module) {
    return null;
  }

  return {
    ...module,
    title: localizeContentText(locale, module.title) ?? module.title,
    description: localizeContentText(locale, module.description),
    ...briefFields(module.activeVersion, locale),
    ...(participantFacing ? {} : { assessorExpectedContent: localizeContentText(locale, module.activeVersion?.assessorExpectedContent) }),
    assessmentMode: module.activeVersion?.assessmentMode ?? null,
  };
}

export async function getActiveModuleVersion(
  moduleId: string,
  roles: AppRoleType[],
  locale: SupportedLocale = "en-GB",
  options: { participantFacing?: boolean } = {},
) {
  const participantFacing = options.participantFacing ?? false;
  const module = await getModuleById(moduleId, roles, locale, options);
  if (!module?.activeVersion) {
    return null;
  }

  const activeVersion = await queryModuleVersion(module.activeVersion.id);
  if (!activeVersion) {
    return null;
  }

  const { assessorExpectedContent: _gt, ...activeVersionBase } = activeVersion;
  return {
    ...activeVersionBase,
    ...briefFields(activeVersion, locale),
    ...(participantFacing ? {} : { assessorExpectedContent: localizeContentText(locale, activeVersion.assessorExpectedContent) }),
    submissionSchema: submissionSchemaCodec.parse(activeVersion.submissionSchemaJson),
    assessmentPolicy: assessmentPolicyCodec.parse(activeVersion.assessmentPolicyJson),
  };
}
