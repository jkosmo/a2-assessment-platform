import { assessmentPolicyCodec } from "../../codecs/assessmentPolicyCodec.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { localizeContentArray, localizeContentText } from "../../i18n/content.js";
import { mcqRepository } from "../assessment/mcqRepository.js";
import { parseQuestionOrder, questionsForAttempt } from "../assessment/mcqDraw.js";
import { submissionRepository } from "./submissionRepository.js";

// #1061: gjennomgangen av flervalgsdelen — hvert spørsmål deltakeren fikk, med eget svar, riktig svar
// og begrunnelse. Fasit er en EGEN dør (som #903 fastslo): den går bare ut herfra, og bare når
// modulversjonen forsøket ble tatt på har `assessmentPolicy.mcq.reviewAfterSubmit`. Resultatkallet
// (`/result`) sier fortsatt bare prosent og bestått.

export type McqReviewQuestion = {
  id: string;
  stem: string;
  options: string[];
  selectedAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  rationale: string | null;
};

export type McqReview = {
  enabled: boolean;
  questions: McqReviewQuestion[];
};

export async function getOwnedMcqReview(
  submissionId: string,
  userId: string,
  locale: SupportedLocale,
): Promise<McqReview | null> {
  const submission = await submissionRepository.findOwnedSubmission(submissionId, userId);
  if (!submission) return null;

  const policy = assessmentPolicyCodec.parse(submission.moduleVersion?.assessmentPolicyJson);
  const enabled = policy?.mcq?.reviewAfterSubmit === true;
  // Gjennomgangen gjelder et LEVERT forsøk — det siste som er fullført. Et åpent forsøk har ingen
  // fasit å vise, uansett policy.
  const attempt = submission.mcqAttempts.find((candidate) => candidate.completedAt !== null) ?? null;
  if (!enabled || !attempt) return { enabled, questions: [] };

  const asked = questionsForAttempt(
    await mcqRepository.findActiveQuestionsForSet(attempt.mcqSetVersionId),
    parseQuestionOrder(attempt.questionOrderJson),
  );
  const responseByQuestion = new Map(attempt.responses.map((response) => [response.questionId, response]));

  return {
    enabled,
    questions: asked.map((question) => {
      const response = responseByQuestion.get(question.id) ?? null;
      const options = localizeContentArray(locale, JSON.parse(question.optionsJson) as unknown[]);
      return {
        id: question.id,
        stem: localizeContentText(locale, question.stem) ?? question.stem,
        options,
        // Svaret slik deltakeren ga det — på språket forsøket ble tatt på.
        selectedAnswer: response?.selectedAnswer ?? null,
        correctAnswer: localizeContentText(locale, question.correctAnswer) ?? question.correctAnswer,
        // Ubesvart teller som feil: det er slik rettingen så det (ingen respons = ikke riktig).
        isCorrect: response?.isCorrect ?? false,
        rationale: question.rationale ? (localizeContentText(locale, question.rationale) ?? question.rationale) : null,
      };
    }),
  };
}
