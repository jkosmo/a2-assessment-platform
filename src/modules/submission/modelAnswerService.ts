import { assessmentPolicyCodec } from "../../codecs/assessmentPolicyCodec.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { localizeContentText } from "../../i18n/content.js";
import { submissionRepository } from "./submissionRepository.js";

// #1124 del 2: eksempelsvaret etter fritekstvurderingen. Som fasiten i flervalg (#1061) er dette en
// EGEN dør: eksempelsvaret går bare ut herfra, og bare når
//   1. innleveringen er deltakerens egen,
//   2. modulversjonen den ble levert på har `assessmentPolicy.practical.modelAnswerAfterAssessment`,
//   3. vurderingen er ferdig — det finnes en avgjørelse, samme tidspunkt som tilbakemeldingen vises.
// Deltakerens moduloppslag henter aldri feltet, og resultatkallet (`/result`) sier ingenting om det.
// Avslått som standard: den neste som tar testen, kan få eksempelsvaret fra den forrige.

export type ModelAnswerView = {
  enabled: boolean;
  /** Eksempelsvaret på deltakerens språk; null når det ikke skal eller kan vises. */
  modelAnswer: string | null;
  /** Deltakerens eget svar, felt for felt, slik det ble levert — vises ved siden av eksempelsvaret. */
  ownAnswer: string[];
};

/** Tekstfeltene i et levert svar, i rekkefølge. Et svar er et objekt med ett felt per svarfelt. */
function ownAnswerTexts(responseJson: string | null | undefined): string[] {
  if (!responseJson) return [];
  try {
    const parsed: unknown = JSON.parse(responseJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.values(parsed as Record<string, unknown>)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  } catch {
    return [];
  }
}

export async function getOwnedModelAnswer(
  submissionId: string,
  userId: string,
  locale: SupportedLocale,
): Promise<ModelAnswerView | null> {
  const submission = await submissionRepository.findOwnedSubmission(submissionId, userId);
  if (!submission) return null;

  const policy = assessmentPolicyCodec.parse(submission.moduleVersion?.assessmentPolicyJson);
  const enabled = policy?.practical?.modelAnswerAfterAssessment === true;
  const assessed = submission.decisions.length > 0;
  const modelAnswer = localizeContentText(locale, submission.moduleVersion?.modelAnswer)?.trim() ?? "";
  if (!enabled || !assessed || !modelAnswer) return { enabled, modelAnswer: null, ownAnswer: [] };

  return { enabled, modelAnswer, ownAnswer: ownAnswerTexts(submission.responseJson) };
}
