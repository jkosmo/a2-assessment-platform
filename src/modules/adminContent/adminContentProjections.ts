import { localizedTextCodec } from "../../codecs/localizedTextCodec.js";
import { parseAnswerKey, questionTypeOf } from "../assessment/mcqQuestionTypes.js";

export function decodeLocalizedText(input: string | null | undefined) {
  return localizedTextCodec.parse(input);
}

export function safeParseJson(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

export function decodeMcqOption(option: unknown) {
  if (typeof option === "string") {
    return decodeLocalizedText(option) ?? option;
  }

  return option;
}

export function mapMcqSetVersion(version: {
  id: string;
  versionNo: number;
  title: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  questions: Array<{
    id: string;
    stem: string;
    optionsJson: string;
    correctAnswer: string;
    rationale: string | null;
    questionType?: string | null;
    answerKeyJson?: string | null;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  return {
    id: version.id,
    versionNo: version.versionNo,
    title: decodeLocalizedText(version.title) ?? version.title,
    active: version.active,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    questions: version.questions.map((question) => {
      const parsedOptions = safeParseJson(question.optionsJson);
      const options = Array.isArray(parsedOptions) ? parsedOptions.map((option) => decodeMcqOption(option)) : [];
      // #1077: «multiple» går ut med typen og de riktige alternativene (`correctAnswers`), i samme form
      // som forfatteren sendte dem inn — så editoren og eksport → import får spørsmålet tilbake
      // uendret. «single» går ut som før, uten typefelt, så eldre importfiler og skillet kjenner den.
      // `correctAnswer` går ut for begge: for «multiple» det første riktige, som lagret. Klientveier som
      // ennå ikke kjenner typen (utfylling av språk ved publisering, oversettelse) leter etter det, og
      // stoppet uten (QA 2.99.0). Det er ikke fasiten for «multiple» — det er `correctAnswers`.
      const correctAnswer = decodeLocalizedText(question.correctAnswer) ?? question.correctAnswer;
      // «order» går ut med typen og elementene i riktig rekkefølge (`options`) — det er hele fasiten.
      const type = questionTypeOf(question);
      const typed = type === "multiple"
        ? { questionType: "multiple" as const, correctAnswer, correctAnswers: parseAnswerKey(question.answerKeyJson, options.length).correct.map((i) => options[i]) }
        : type === "order"
          ? { questionType: "order" as const, correctAnswer }
          : { correctAnswer };
      return {
        id: question.id,
        stem: decodeLocalizedText(question.stem) ?? question.stem,
        options,
        ...typed,
        rationale: decodeLocalizedText(question.rationale) ?? question.rationale,
        active: question.active,
        createdAt: question.createdAt,
        updatedAt: question.updatedAt,
      };
    }),
  };
}
