import { localizedTextCodec } from "../../codecs/localizedTextCodec.js";

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
      return {
        id: question.id,
        stem: decodeLocalizedText(question.stem) ?? question.stem,
        options: Array.isArray(parsedOptions) ? parsedOptions.map((option) => decodeMcqOption(option)) : [],
        correctAnswer: decodeLocalizedText(question.correctAnswer) ?? question.correctAnswer,
        rationale: decodeLocalizedText(question.rationale) ?? question.rationale,
        active: question.active,
        createdAt: question.createdAt,
        updatedAt: question.updatedAt,
      };
    }),
  };
}
