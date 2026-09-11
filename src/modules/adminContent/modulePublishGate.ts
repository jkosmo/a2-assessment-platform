import { parseInlineLocalizedMap } from "../../i18n/content.js";
import {
  validateModuleVersionForPublish,
  validateTranslationCompleteness,
  validateMcqTranslationCompleteness,
  type ModuleVersionPublishValidation,
} from "./contentValidationService.js";

/**
 * #956: ÉN publiseringsgate for moduler, for alle tre dørene.
 *
 * Tre dører leder til at en modulversjon blir live: publiseringsknappen (`adminContent.ts`),
 * kurskaskaden (`coursePublishService.ts`) og auto-publisering ved import (`contentImportService.ts`).
 * Hver hadde sin egen gate, med sitt eget feltsett og sin egen normalisering:
 *
 *   - knappen flatet ut med «en-GB → nb → nn», kaskaden med en no-op (`value ?? null`), så
 *     lengde- og blueprint-sjekkene der målte på rå `{"nb":"…"}`-JSON;
 *   - importen kjørte IKKE `validateModuleVersionForPublish` i det hele tatt — den eneste blokkerende
 *     regelen der (`MCQ_COUNT_FAR_BELOW_BLUEPRINT`) fantes ikke på den døra;
 *   - importen unntok `taskText` for MCQ_ONLY selv når teksten fantes; de to andre gatet den.
 *
 * Kommentaren i kaskaden sa «feltsettet må matche modulpubliseringsruta nøyaktig». Det gjorde det
 * ikke. Forfatteren fikk tre svar på «kan denne publiseres?» avhengig av hvilken dør hen brukte.
 *
 * ⚠️ Inndata er LAGRINGSFORMATET — den serialiserte strengen slik den ligger i databasen. Døra som
 * har dekodede verdier (knappen, importen) serialiserer FØR den kaller hit; kaskaden sender rått.
 * Da er det én normalisering: `flattenStoredLocalized` for tekstmålingene, og den serialiserte
 * strengen for oversettelsessjekken — som nettopp skal se hullene utflatingen skjuler.
 */

export type StoredModuleForGate = {
  title: string | null;
  description: string | null;
  archivedAt?: Date | string | null;
};

export type StoredVersionForGate = {
  taskText: string | null;
  candidateTaskConstraints: string | null;
  assessorExpectedContent: string | null;
  assessmentBlueprint: string | null;
};

export type StoredMcqQuestionForGate = {
  stem: string | null;
  optionsJson: string | null;
  correctAnswer: string | null;
  rationale: string | null;
};

/**
 * Én representativ tekst for lengde- og blueprint-sjekker: første ikke-tomme språk i fast
 * rekkefølge. Rekkefølgen er ikke «hvilket språk viser vi» (det eier serveren per forespørsel) —
 * den er bare «finn noe å måle på», og må være den SAMME på alle dørene.
 */
export function flattenStoredLocalized(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const map = parseInlineLocalizedMap(raw);
  if (!map) return raw;
  for (const key of ["en-GB", "nb", "nn"]) {
    const v = map[key as keyof typeof map];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  const first = Object.values(map).find((v) => typeof v === "string" && v.trim().length > 0);
  return typeof first === "string" ? first : null;
}

function parseBlueprint(raw: string | null | undefined): unknown {
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function evaluateModulePublishGate(input: {
  module: StoredModuleForGate;
  version: StoredVersionForGate;
  mcqQuestions: StoredMcqQuestionForGate[];
}): ModuleVersionPublishValidation {
  const { module, version, mcqQuestions } = input;

  const validation = validateModuleVersionForPublish({
    taskText: flattenStoredLocalized(version.taskText) ?? "",
    candidateTaskConstraints: flattenStoredLocalized(version.candidateTaskConstraints),
    assessorExpectedContent: flattenStoredLocalized(version.assessorExpectedContent),
    blueprint: parseBlueprint(version.assessmentBlueprint) as never,
    mcqQuestionCount: mcqQuestions.length,
  });

  // Valgfrie felt gates bare når de finnes: et fraværende felt er ikke et uoversatt. `taskText`
  // mangler for MCQ_ONLY — men FINNES den, vises den for deltakeren, og da gjelder den.
  const translationIssues = [
    ...validateTranslationCompleteness([
      { field: "title", raw: module.title },
      ...(module.description ? [{ field: "description", raw: module.description }] : []),
      ...(version.taskText ? [{ field: "taskText", raw: version.taskText }] : []),
      ...(version.assessorExpectedContent
        ? [{ field: "assessorExpectedContent", raw: version.assessorExpectedContent }]
        : []),
      ...(version.candidateTaskConstraints
        ? [{ field: "candidateTaskConstraints", raw: version.candidateTaskConstraints }]
        : []),
    ]),
    ...validateMcqTranslationCompleteness(mcqQuestions),
  ];
  if (translationIssues.length > 0) {
    validation.issues.push(...translationIssues);
    validation.valid = false;
  }

  // #955 I3: «arkivert men publisert» skal aldri finnes — samme kode som de andre stedene (#914).
  if (module.archivedAt) {
    validation.issues.push({
      severity: "blocking",
      code: "item_archived",
      message: "Modulen er arkivert. Gjenopprett den før du publiserer.",
      params: { itemType: "module" },
    });
    validation.valid = false;
  }

  return validation;
}
