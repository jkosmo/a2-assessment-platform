import type { AppRole as AppRoleType } from "@prisma/client";
import { AppRole } from "../../db/prismaRuntime.js";
import { hasAnyRole, MODULE_ADMIN_READERS } from "../../auth/roleSets.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { localizeContentText } from "../../i18n/content.js";
import { renderModuleTextMarkdown } from "../course/sectionContent.js";
import { assessmentPolicyCodec } from "../../codecs/assessmentPolicyCodec.js";
import { submissionSchemaCodec } from "../../codecs/submissionSchemaCodec.js";
import { buildParticipantCriteria } from "../assessment/participantCriteria.js";
import {
  queryModules,
  queryModuleById,
  queryModuleVersion,
} from "../../repositories/moduleRepository.js";
import { queryLatestSubmissionsForModules } from "../submission/submissionRepository.js";
import { withShownVersions, type ModuleReader } from "./participantModuleVersion.js";

// #962: settet bor nå i `src/auth/roleSets.ts`, sammen med de nitten andre rollesjekkene. Det er
// UENDRET — poenget med flyttingen er at man skal kunne lese hele policyen ett sted og se hvor
// settene er uenige, ikke at noen skal miste eller få tilgang.
function hasAdminRead(roles: AppRoleType[]) {
  return hasAnyRole(roles, MODULE_ADMIN_READERS);
}

type ListModulesOptions = {
  includeCompleted?: boolean;
  participantFacing?: boolean;
  /** #1140: gruppene fra innloggingen, for kursene leseren har tilgang til gjennom en Entra-klasse. */
  groupIds?: string[];
  /** #1140: kurset modulene åpnes fra. Det kurset bestemmer versjonen for modulene leseren har i det. */
  courseId?: string;
};

/**
 * #1140 etappe 1: den som leser deltakervendt, får versjonen kursene sine viser (`participantModuleVersion.ts`). Forfatter- og
 * administratorlesing (`participantFacing: false`) og et kall uten bruker får modulens nyeste, som før.
 */
function shownVersionReader(roles: AppRoleType[], participantFacing: boolean, userId?: string, groupIds?: string[]): ModuleReader | null {
  return participantFacing && userId ? { userId, roles, groupIds } : null;
}

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
    taskTextHtml: typeof taskText === "string" ? renderModuleTextMarkdown(taskText, locale) : null,
    candidateTaskConstraints,
    candidateTaskConstraintsHtml:
      typeof candidateTaskConstraints === "string" ? renderModuleTextMarkdown(candidateTaskConstraints, locale) : null,
  };
}

/**
 * #1124: modulversjonen slik den sendes, og kriteriene deltakeren ser før levering.
 *
 * ⚠️ `...module` sprer `activeVersion` slik den kom fra databasen. Den har alltid hatt med
 * `assessorExpectedContent` — toppfeltet ble holdt unna deltakeren (#387), men den samme teksten lå
 * urørt ett nivå ned, i `activeVersion.assessorExpectedContent`. Nå tas den ut her for deltakeren, og
 * den rå `rubricVersion` (med skjulte kriterier) tas ut for alle: det eneste som sendes av
 * kriteriene, er `assessmentCriteria`, bygget av `buildParticipantCriteria`.
 */
function versionFields<V extends { assessorExpectedContent?: unknown; rubricVersion?: { criteriaJson: string } | null }>(
  activeVersion: V | null,
  locale: SupportedLocale,
  participantFacing: boolean,
) {
  if (!activeVersion) return { activeVersion, assessmentCriteria: [] };
  const { rubricVersion, assessorExpectedContent, ...rest } = activeVersion;
  return {
    activeVersion: participantFacing ? rest : { ...rest, assessorExpectedContent },
    assessmentCriteria: buildParticipantCriteria(rubricVersion?.criteriaJson, locale),
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
  const reader = shownVersionReader(roles, participantFacing, userId, options.groupIds);
  const published = await queryModules(adminRead, now);
  const modules = reader ? await withShownVersions(published, reader, options.courseId) : published;

  if (!userId) {
    return modules.map((module) => ({
      ...module,
      ...versionFields(module.activeVersion, locale, participantFacing),
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
      ...versionFields(module.activeVersion, locale, participantFacing),
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

export async function getModuleById(
  moduleId: string,
  roles: AppRoleType[],
  locale: SupportedLocale = "en-GB",
  options: { participantFacing?: boolean; userId?: string; groupIds?: string[]; courseId?: string } = {},
) {
  const now = new Date();
  const participantFacing = options.participantFacing ?? false;
  const adminRead = participantFacing ? false : hasAdminRead(roles);
  const found = await queryModuleById(moduleId, adminRead, now);

  if (!found) {
    return null;
  }
  const reader = shownVersionReader(roles, participantFacing, options.userId, options.groupIds);
  const module = reader ? (await withShownVersions([found], reader, options.courseId))[0]! : found;

  return {
    ...module,
    ...versionFields(module.activeVersion, locale, participantFacing),
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
  options: { participantFacing?: boolean; userId?: string; groupIds?: string[]; courseId?: string } = {},
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
