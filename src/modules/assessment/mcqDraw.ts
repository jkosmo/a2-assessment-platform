import type { ModuleAssessmentPolicy } from "../../codecs/assessmentPolicyCodec.js";

// #1062: hvilke spørsmål et forsøk får, og i hvilken rekkefølge — avgjort ÉN gang når forsøket
// opprettes, og lagret på forsøket (`MCQAttempt.questionOrderJson`). Ren funksjon: tilfeldigheten
// kommer inn som parameter, så testene kan gjøre den deterministisk.
//
// Standardene (produkteier 17.09): alle spørsmål når «per forsøk» er tomt; rekkefølgen STOKKES for
// alle flervalgsmoduler — også de som fantes før — med mindre modulen har slått det av.

export type McqDrawPolicy = {
  questionsPerAttempt: number | null;
  shuffleQuestions: boolean;
};

export function resolveMcqDrawPolicy(policy: ModuleAssessmentPolicy | null | undefined): McqDrawPolicy {
  const mcq = policy?.mcq;
  const perAttempt = mcq?.questionsPerAttempt;
  return {
    questionsPerAttempt:
      typeof perAttempt === "number" && Number.isInteger(perAttempt) && perAttempt > 0 ? perAttempt : null,
    shuffleQuestions: mcq?.shuffleQuestions !== false,
  };
}

/** Fisher–Yates over en kopi; `random` gir [0, 1). */
export function shuffleWith<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Trekk spørsmålene til ett forsøk. `questionIds` er de aktive spørsmålene i lagret rekkefølge.
 * Er banken mindre enn «per forsøk», får deltakeren hele banken — aldri en feil.
 */
export function drawQuestionIds(
  questionIds: readonly string[],
  policy: McqDrawPolicy,
  random: () => number = Math.random,
): string[] {
  const shuffled = shuffleWith(questionIds, random);
  const count = policy.questionsPerAttempt !== null ? Math.min(policy.questionsPerAttempt, questionIds.length) : questionIds.length;
  // Utvalget trekkes alltid tilfeldig (ellers ville «de 10 første» blitt de samme hver gang);
  // rekkefølgen til slutt følger valget om stokking.
  const picked = shuffled.slice(0, count);
  if (policy.shuffleQuestions) return picked;
  const order = new Map(questionIds.map((id, index) => [id, index]));
  return picked.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/** Les det lagrede trekket. Eldre forsøk (uten) betyr «alle aktive, lagret rekkefølge». */
export function parseQuestionOrder(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((x) => typeof x === "string") ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

/** Spørsmålene et forsøk gjelder, i forsøkets rekkefølge. Et id som ikke lenger finnes, hoppes over. */
export function questionsForAttempt<T extends { id: string }>(allActive: T[], order: string[] | null): T[] {
  if (!order) return allActive;
  const byId = new Map(allActive.map((q) => [q.id, q]));
  return order.map((id) => byId.get(id)).filter((q): q is T => q !== undefined);
}
