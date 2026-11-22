import { matchesLocalizedContentVariant, resolveContentVariants } from "../../i18n/content.js";

/**
 * #1077: spørsmålstypene, og hvordan et svar på hver rettes. ÉN modul, fordi «er dette svaret
 * riktig?» bare skal besvares ett sted (samme lærdom som mcqPassRule, #949). Se doc/DESIGN_1077.md.
 *
 * Produkteier 2026-10-24: hvert spørsmål er rett eller galt — ingen delpoeng. Poengsum, bestått-grense
 * og alt nedstrøms regner derfor som før; bare avgjørelsen per spørsmål kjenner typen.
 *
 *   single    ett riktig alternativ; fasiten er `correctAnswer` (teksten, per språk), som før.
 *   multiple  «velg alle som stemmer»; fasiten er POSISJONENE til de riktige alternativene i
 *             `optionsJson` (`answerKeyJson = {"correct":[0,2]}`). Posisjoner, ikke tekst: oversettelsen
 *             holder alternativene i samme rekkefølge på alle språk, så fasiten følger med uten å
 *             skrives om. Riktig når de valgte er nøyaktig de riktige — ingen mangler, ingen ekstra.
 *   order     «sett i riktig rekkefølge» (leveranse 2, 2026-10-25); alternativene LAGRES i riktig
 *             rekkefølge, og det er fasiten — `answerKeyJson` er null. Utleveres alltid stokket, og aldri
 *             i riktig rekkefølge (`shuffleOrderItems`). Riktig når hele rekkefølgen stemmer. 3–6 elementer.
 *   fill      «fyll inn ordet som mangler» (leveranse 3, 2026-10-31); stammen har ÉN lukke (`___`), og
 *             alternativene er de GODKJENTE SVARENE (hvert med sine språk) — `answerKeyJson` er null.
 *             Alternativene utleveres derfor aldri til deltakeren: de er fasiten. Riktig når svaret,
 *             normalisert, er et av de godkjente på et av språkene, eller ett tegn unna et godkjent svar
 *             på mer enn seks bokstaver (produkteier 2026-10-31). Ingen KI.
 */
export const MCQ_QUESTION_TYPES = ["single", "multiple", "order", "fill"] as const;

/** «Fyll inn»: lukka i stammen — tre eller flere understreker. Nøyaktig én per språk. */
export const FILL_BLANK_RE = /_{3,}/g;
/** Godkjente svar per spørsmål: ett er nok, flere dekker skrivemåter («tre», «3»). */
export const FILL_MAX_ANSWERS = 6;
/** Ett tegn feil godtas bare i svar lengre enn dette — i korte ord er ett tegn et annet ord. */
export const FILL_TYPO_MIN_LENGTH = 7;

/** «Sett i rekkefølge»: færre er gjetting, flere blir tungt å flytte på telefon (produkteier 2026-10-25). */
export const ORDER_MIN_ITEMS = 3;
export const ORDER_MAX_ITEMS = 6;
export type McqQuestionType = (typeof MCQ_QUESTION_TYPES)[number];

export function isMcqQuestionType(value: unknown): value is McqQuestionType {
  return typeof value === "string" && (MCQ_QUESTION_TYPES as readonly string[]).includes(value);
}

/**
 * Typen et lagret spørsmål har. En type koden ikke kjenner, er en feil — ikke «single»: et spørsmål
 * rettet etter feil regel gir et resultat som ser gyldig ut.
 */
export function questionTypeOf(question: { questionType?: string | null }): McqQuestionType {
  const raw = question.questionType ?? "single";
  if (!isMcqQuestionType(raw)) throw new Error(`Unknown MCQ question type "${raw}".`);
  return raw;
}

export type McqAnswerKey = { correct: number[] };

/** Fasiten for `multiple`: posisjonene, sortert og uten like. Kaster på en fasit som ikke kan brukes. */
export function parseAnswerKey(answerKeyJson: string | null | undefined, optionCount: number): McqAnswerKey {
  const parsed: unknown = answerKeyJson ? JSON.parse(answerKeyJson) : null;
  const correct = (parsed as { correct?: unknown } | null)?.correct;
  if (!Array.isArray(correct) || correct.length === 0 || !correct.every((i) => Number.isInteger(i) && i >= 0 && i < optionCount)) {
    throw new Error("MCQ answer key must list at least one valid option position.");
  }
  return { correct: [...new Set(correct as number[])].sort((a, b) => a - b) };
}

export function serializeAnswerKey(key: McqAnswerKey): string {
  return JSON.stringify({ correct: [...new Set(key.correct)].sort((a, b) => a - b) });
}

/** Et svar slik deltakeren sender det: én tekst (single), flere (multiple), alle i deltakerens rekkefølge (order), eller det hun skrev (fill). */
export type McqSubmittedAnswer = { selectedAnswer?: string; selectedAnswers?: string[]; orderedAnswers?: string[]; textAnswer?: string };

/**
 * «Fyll inn»: svaret og et godkjent svar sammenlignes slik — store og små bokstaver, mellomrom og
 * tegnsetting på slutten teller ikke («Tre uker.» = «tre uker»). Ingenting annet tolkes.
 */
export function normalizeFillAnswer(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ").replace(/[.,;:!?]+$/u, "").trim().toLocaleLowerCase();
}

/** Er `a` og `b` høyst ett tegn fra hverandre (ett tegn byttet, lagt til eller borte)? */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i += 1;
  // Like lange: resten etter forskjellen må være lik (ett byttet). Ulik lengde: lik etter ett hoppet over.
  return short.length === long.length ? short.slice(i + 1) === long.slice(i + 1) : short.slice(i) === long.slice(i + 1);
}

/** Er det deltakeren skrev, et godkjent svar? `answers` er de lagrede alternativene (språkkart eller tekst). */
export function isAcceptedFillAnswer(answers: string[], written: string): boolean {
  const given = normalizeFillAnswer(written);
  if (!given) return false;
  return answers.some((stored) => resolveContentVariants(stored).some((variant) => {
    const accepted = normalizeFillAnswer(variant);
    return accepted === given || (accepted.length >= FILL_TYPO_MIN_LENGTH && withinOneEdit(accepted, given));
  }));
}

export type McqGradedAnswer = {
  isCorrect: boolean;
  /** Lesbar tekst: det valgte alternativet, eller de valgte, skilt med « · ». */
  selectedAnswer: string;
  /** For typene som ikke er én tekst: {"selected":[posisjoner]} (multiple), {"order":[posisjoner]} (order). Null for single. */
  answerJson: string | null;
};

type GradableQuestion = {
  questionType?: string | null;
  optionsJson: string;
  correctAnswer: string;
  answerKeyJson?: string | null;
};

/** Posisjonen til alternativet deltakeren valgte — samme sammenligning som `single` alltid har brukt. */
function optionPosition(options: string[], selected: string): number {
  return options.findIndex((option) => matchesLocalizedContentVariant(option, selected));
}

/**
 * Elementene i en «sett i rekkefølge» stokket — og aldri i riktig rekkefølge, for da er fasiten det
 * deltakeren ser. Med færre enn to elementer finnes det ingen annen rekkefølge (skjemaet krever tre).
 * @param random  for tester; standard er Math.random
 */
export function shuffleOrderItems<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const shuffled = [...items];
  // Ingen annen rekkefølge finnes når alle elementene er like (lagringen avviser like elementer, men en
  // tekst kan bli lik på ett språk) — da ville løkka gått for alltid.
  if (shuffled.length < 2 || shuffled.every((item) => item === shuffled[0])) return shuffled;
  do {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  } while (shuffled.every((item, i) => item === items[i]));
  return shuffled;
}

export function gradeMcqAnswer(question: GradableQuestion, answer: McqSubmittedAnswer): McqGradedAnswer {
  const type = questionTypeOf(question);
  if (type === "single") {
    const selected = answer.selectedAnswer ?? "";
    return { isCorrect: matchesLocalizedContentVariant(question.correctAnswer, selected), selectedAnswer: selected, answerJson: null };
  }

  const options = JSON.parse(question.optionsJson) as string[];

  if (type === "fill") {
    // Alternativene er de godkjente svarene. Svaret lagres som skrevet — det er det deltakeren ser igjen.
    const written = answer.textAnswer ?? "";
    return {
      isCorrect: isAcceptedFillAnswer(options, written),
      selectedAnswer: written.trim(),
      answerJson: JSON.stringify({ text: written.trim() }),
    };
  }

  if (type === "order") {
    // Posisjonen i FASITEN til hvert element, i den rekkefølgen deltakeren satte dem. Riktig når den er
    // 0, 1, 2, … — og bare da: et element som mangler, står to ganger eller ikke er et av elementene,
    // gjør svaret galt.
    const texts = answer.orderedAnswers ?? [];
    const positions = texts.map((text) => optionPosition(options, text));
    const isCorrect = positions.length === options.length
      && new Set(positions).size === options.length
      && positions.every((p, i) => p === i);
    return {
      isCorrect,
      selectedAnswer: texts.join(" → "),
      answerJson: JSON.stringify({ order: positions }),
    };
  }

  // multiple
  const key = parseAnswerKey(question.answerKeyJson, options.length);
  const texts = answer.selectedAnswers ?? [];
  const positions = texts.map((text) => optionPosition(options, text));
  // Et valg som ikke er et av alternativene, gjør svaret galt — det teller ikke bare som «ikke valgt».
  const unknownChoice = positions.some((p) => p < 0);
  const chosen = [...new Set(positions.filter((p) => p >= 0))].sort((a, b) => a - b);
  const isCorrect = !unknownChoice && chosen.length === key.correct.length && chosen.every((p, i) => p === key.correct[i]);
  return {
    isCorrect,
    selectedAnswer: texts.join(" · "),
    answerJson: JSON.stringify({ selected: chosen }),
  };
}
