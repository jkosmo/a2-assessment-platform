import { Lexer } from "marked";
import { FRAME_KINDS, compareFrames, describeFrameProblem, type FrameProblem } from "#frame-structure";
import { AppError } from "../../errors/AppError.js";
import { renderSectionBlocks } from "../course/contentBlocks.js";

/**
 * #1109: en oversettelse fra plattformens oversetter skal ha de samme rammene som kilden.
 *
 * Oversetteren ber modellen la `:::sjekk`, `- [x]`, overskriftene i `:::steg` osv. stå urørt — men en
 * regel i en prompt er et ønske, ikke en kontroll. En oversettelse som flyttet `[x]`, mistet en
 * overskrift eller slo sammen to linjer, ble levert til forfatteren og lagret uten at noe sa fra, og
 * deltakeren så feil fasit eller markørene som tekst.
 *
 * To lesinger, begge av det tjeneren faktisk gjør:
 *
 *  1. Formen (`compareFrames` i skills/a2-authoring-api/scripts/frame-structure.mjs — samme tabell som
 *     skillets språkkontroll): like mange rammer av hver type, samme fasit i hver «sjekk deg selv», like
 *     mange steg, kort og sjekkpunkter. Overskriftene telles av markeds egen lesing, som `countItems` i
 *     contentBlocks.ts — en overskrift i en liste eller en kodeblokk begynner ikke et steg.
 *  2. Tegningen: like mange rammer av hver type i HTML-en `renderSectionBlocks` lager. Fanger det formen
 *     ikke kan se — en oversettelse som fjernet den blanke linja over `:::sjekk`, så alternativene ble en
 *     del av lista over og rammen ikke tegnes.
 *
 * ⚠️ En ny ramme legges til i FRAME_KINDS i frame-structure.mjs, ikke her.
 */

/** Overskriftene på øverste nivå i en ramme, lest av marked — det `splitAtHeadings` deler ved. */
export function countTopLevelHeadings(inner: string): number {
  return new Lexer().blockTokens(inner, []).filter((token) => token.type === "heading").length;
}

/** Hvor mange rammer av hver type tjeneren tegner i en tekst. Seksjonsvarianten: alle rammene. */
function drawnFrameCounts(text: string): Map<string, number> {
  const html = renderSectionBlocks(text, undefined, "section");
  return new Map(FRAME_KINDS.map((entry) => [entry.kind, html.split(entry.drawnAs).length - 1]));
}

/** Hva oversettelsen har endret i rammene. Tom liste = samme rammer, samme form. */
export function translationStructureProblems(source: string | null | undefined, translated: string | null | undefined): FrameProblem[] {
  const before = String(source ?? "");
  const after = String(translated ?? "");
  const problems: FrameProblem[] = compareFrames(before, after, { countHeadings: countTopLevelHeadings });
  // Ingen ramme i noen av dem: ingenting å tegne, og ingen grunn til å tegne.
  if (!before.includes(":::") && !after.includes(":::")) return problems;
  const drawnBefore = drawnFrameCounts(before);
  const drawnAfter = drawnFrameCounts(after);
  for (const { kind } of FRAME_KINDS) {
    // Et avvik i antallet er alt meldt av formen; tegningen legger bare til det formen ikke ser.
    if (problems.some((problem) => problem.kind === kind && problem.problem === "count")) continue;
    const expected = drawnBefore.get(kind) ?? 0;
    const actual = drawnAfter.get(kind) ?? 0;
    if (expected !== actual) problems.push({ kind, problem: "drawn", expected, actual });
  }
  return problems;
}

export interface TranslationStructureFieldProblems {
  field: string;
  problems: FrameProblem[];
}

/**
 * 422 `translation_structure_changed`: oversettelsen til `locale` ble forkastet fordi den endret rammene.
 *
 * Svaret bærer språket og avvikene per felt i `details`; klienten formulerer setningen selv (koden er
 * kontrakten, ikke teksten — doc/DECISIONS.md). Klientene behandler språket som ikke oversatt, slik en
 * oversettelse som feilet alltid er behandlet: språket slippes, ingenting kildefylles.
 */
export class TranslationStructureError extends AppError {
  constructor(locale: string, fields: TranslationStructureFieldProblems[]) {
    const summary = fields
      .map(({ field, problems }) => `${field}: ${problems.map((problem) => describeFrameProblem(problem)).join("; ")}`)
      .join(" | ");
    super(
      "translation_structure_changed",
      422,
      `The translation to ${locale} changed the frames in the text and was not used. ${summary}`,
      { locale, fields },
    );
  }
}

/**
 * Kast `TranslationStructureError` hvis ett av feltene har fått andre rammer i oversettelsen. Felter som
 * mangler i oversettelsen, hoppes over — de er ikke oversatt, og det håndteres der de leses.
 */
export function assertTranslationKeepsStructure(
  locale: string,
  fields: Array<{ field: string; source: string | null | undefined; translated: string | null | undefined }>,
): void {
  const changed: TranslationStructureFieldProblems[] = [];
  for (const { field, source, translated } of fields) {
    if (typeof translated !== "string") continue;
    const problems = translationStructureProblems(source, translated);
    if (problems.length > 0) changed.push({ field, problems });
  }
  if (changed.length > 0) throw new TranslationStructureError(locale, changed);
}
