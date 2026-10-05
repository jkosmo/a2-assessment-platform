export interface CaseSlide {
  nr: number;
  form: string;
  hva?: string;
  forventet: string[];
  nøkkelord?: string[];
  bildetekst?: string[];
  valgfri?: boolean;
  personopplysninger?: boolean;
}
export interface EvalCase {
  navn: string;
  kilde?: string;
  preg?: string;
  ikonerIKilden?: number;
  lysark: CaseSlide[];
  manuellSjekk?: string[];
}
export interface ScoredSlide {
  nr: number;
  form: string;
  forventet: string[];
  funnet: "figur" | "tabell" | "bilde" | "prompt-som-tekst" | "tekst" | "borte";
  somForventet: boolean;
  valgfri: boolean;
  innholdMed: boolean;
  nøkkelord: string;
  bildetekst: string | null;
  figur: { fil: string; form: string } | null;
}
export interface ScoreResult {
  navn: string;
  lysark: ScoredSlide[];
  sum: {
    lysarkMedInnhold: number;
    innholdMed: number;
    somForventet: number;
    venterPåInnholdsblokker: number;
    figurer: number;
    figurformer: string[];
    figurerMedSmaltOppsett: number;
    figurerMedTegning: number;
    ikonerIKilden: number;
    tabeller: number;
    rasterbilder: number;
    rasterKB: number;
    tungeBilder: string[];
    tekstFraBilder: string;
    seksjoner: number;
    moduler: number;
    ord: number;
  };
}
export function readCourse(pakke: unknown): {
  tekst: string;
  ord: number;
  seksjoner: number;
  moduler: number;
  figurer: Array<{ fil: string; svg: boolean; form: string; tekst: string; smaltOppsett: boolean; animert: boolean; harTegning: boolean; byte: number }>;
  tabeller: string[];
};
export function scoreCourse(tilfelle: EvalCase, pakke: unknown): ScoreResult;
export function formatScore(resultat: ScoreResult): string;
