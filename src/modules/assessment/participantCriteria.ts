import type { SupportedLocale } from "../../i18n/locale.js";
import { stepTexts } from "#rubric-check";
import {
  isCriterionObject,
  parseRubricCriteriaEntries,
  parseRubricCriteriaForPrompt,
} from "./AssessmentInputFactory.js";

/**
 * #1124: kriteriene slik DELTAKEREN ser dem — før levering (trinnene) og etter vurdering (poengene).
 *
 * ⚠️ ÉN LESER AV KRITERIENE. Etikett, beskrivelse og kriteriets egen skala leses av
 * `parseRubricCriteriaForPrompt` — den samme koden som gir KI-vurdereren kriteriene (#1135). Leste vi
 * dem på nytt her, kunne deltakeren få se et annet kriterium enn det vurdereren brukte, som er nøyaktig
 * feilen #1135 rettet. Trinnene deles opp med `stepTexts` fra `#rubric-check`, med samme syntaks som
 * skillets kriteriekontroll kaller «beskrevet».
 *
 * ⚠️ HVA SOM ALDRI SENDES. Et kriterium merket `candidateVisible: false` er holdt tilbake fordi teksten
 * ville røpe svaret (#896 S1). Det filtreres HER, på serveren — ikke i klienten — fordi et felt som
 * når nettleseren, er sendt. Manglende flagg betyr synlig (produkteier 2026-10-26: «standard: ja»);
 * en hvilken som helst annen verdi enn `true` holder kriteriet tilbake, så en skadet rad lukker
 * heller enn åpner. `assessorExpectedContent` er ikke en del av kriteriene og leses ikke her.
 */

/** Plattformens skala: vurdereren setter 0–4 på hvert kriterium (decisionService klemmer til [0,4]). */
const GRADER_SCALE_MAX = 4;

export type ParticipantCriterionStep = { score: number; text: string };

export type ParticipantCriterion = {
  id: string;
  label: string | null;
  /** Kriteriets egen skala: 0 til dette tallet (0–4 når kriteriet ikke sier noe annet). */
  scaleMax: number;
  /** Det beskrivelsen sier før første trinn, uten skalaen. */
  intro: string | null;
  steps: ParticipantCriterionStep[];
};

export type ParticipantCriterionScore = {
  id: string;
  label: string | null;
  /** Poeng på kriteriets EGEN skala — «1 av 2», ikke vurdererens 0–4. */
  score: number;
  maxScore: number;
  /** Hva toppnivået krever, når deltakeren ikke fikk fullt og trinnet er beskrevet. */
  topStep: string | null;
};

export function isCandidateVisible(criterion: unknown): boolean {
  if (!isCriterionObject(criterion)) return true;
  return criterion.candidateVisible === undefined || criterion.candidateVisible === true;
}

type ReadCriterion = { id: string; label: string | null; scaleMax: number; intro: string | null; steps: ParticipantCriterionStep[] };

function readVisibleCriteria(criteriaJson: string, locale: SupportedLocale): ReadCriterion[] {
  const raw = new Map(parseRubricCriteriaEntries(criteriaJson));
  return parseRubricCriteriaForPrompt(criteriaJson, locale)
    .filter((criterion) => isCandidateVisible(raw.get(criterion.id)))
    .map((criterion) => {
      const source = raw.get(criterion.id);
      const scaleMax = criterion.scaleMax ?? GRADER_SCALE_MAX;
      const maxScore = isCriterionObject(source) ? source.maxScore : undefined;
      const parts = criterion.description
        ? stepTexts({ maxScore, description: criterion.description }, locale, { defaultMax: GRADER_SCALE_MAX })
        : { intro: null, steps: [] };
      return {
        id: criterion.id,
        label: criterion.label,
        scaleMax,
        intro: parts.intro,
        steps: parts.steps.map((s) => ({ score: s.step, text: s.text })),
      };
    });
}

/**
 * #1124 (produkteier 2026-10-27): begrunnelsen for et skjult kriterium vises heller ikke etter
 * vurderingen. Den sier hva kriteriet så etter, og deltakeren kan levere på nytt — så den røper det
 * samme som etiketten. Begrunnelser for ID-er som ikke står i rubrikken (en eldre vurdering, eller en
 * ID modellen fant på), er ikke skjulte kriterier og står som før.
 */
export function withoutHiddenRationales(
  rationales: Record<string, string> | null | undefined,
  criteriaJson: string | null | undefined,
): Record<string, string> | null {
  if (!rationales) return null;
  if (!criteriaJson) return rationales;
  const hidden = new Set(
    parseRubricCriteriaEntries(criteriaJson).filter(([, raw]) => !isCandidateVisible(raw)).map(([id]) => id),
  );
  return Object.fromEntries(Object.entries(rationales).filter(([id]) => !hidden.has(id)));
}

/**
 * Før levering: «Slik vurderes svaret ditt». Et kriterium uten noe å vise (bare en ID eller en vekt,
 * som standardrubrikken) er ikke med — en liste med «Task comprehension, 0–4 poeng» og ingenting mer
 * sier deltakeren ingenting om hva som gir poeng.
 */
export function buildParticipantCriteria(criteriaJson: string | null | undefined, locale: SupportedLocale): ParticipantCriterion[] {
  if (!criteriaJson) return [];
  return readVisibleCriteria(criteriaJson, locale).filter((c) => c.label || c.intro || c.steps.length > 0);
}

/**
 * Etter vurdering: poengene per kriterium, på kriteriets egen skala.
 *
 * Vurdereren setter 0–4 på alle kriterier, og et kriterium på egen skala N rapporteres som nivå × 4/N
 * (`buildRubricCriteriaSection`). Tilbake: round(poeng × N / 4). Et kriterium vurdereren ikke satte
 * poeng på, teller 0 — slik `resolveAssessmentDecision` regnet det inn i totalen.
 *
 * Skjulte kriterier er ikke med: etiketten er det som røper svaret, og deltakeren kan levere på nytt.
 */
export function buildCriterionScores(
  criteriaJson: string | null | undefined,
  rubricScores: Record<string, number> | null | undefined,
  locale: SupportedLocale,
): ParticipantCriterionScore[] {
  if (!criteriaJson || !rubricScores) return [];
  return readVisibleCriteria(criteriaJson, locale).map((criterion) => {
    const graderScore = Math.max(0, Math.min(GRADER_SCALE_MAX, rubricScores[criterion.id] ?? 0));
    const score = Math.round((graderScore * criterion.scaleMax) / GRADER_SCALE_MAX);
    const top = criterion.steps.find((s) => s.score === criterion.scaleMax);
    return {
      id: criterion.id,
      label: criterion.label,
      score,
      maxScore: criterion.scaleMax,
      topStep: score < criterion.scaleMax && top ? top.text : null,
    };
  });
}
