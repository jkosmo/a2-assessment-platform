export type ModuleAssessmentPolicy = {
  scoring?: {
    practicalWeight?: number;
    mcqWeight?: number;
  };
  passRules?: {
    totalMin?: number;
    mcqMinPercent?: number;
    practicalMinPercent?: number;
    // v1.2.20 (#464): hvis totalScore er i [min, max], rute til manuell vurdering selv
    // om threshold-rules ellers passerer. Brukes til å fange grensetilfeller som skal
    // ses gjennom av en assessor før endelig pass/fail.
    borderlineWindow?: { min: number; max: number };
  };
  // #475: per-module override of the global aiInfluence rules (config/assessmentRules.ts). A
  // writing-practice module can enable flagging while an application/case module leaves it off —
  // this encodes a *pedagogical policy*, so it belongs with the author. Undefined fields fall back
  // to the global default.
  aiInfluence?: {
    enabled?: boolean;
    shadowMode?: boolean;
    // #475 Phase 2: per-module override of the content-similarity signal.
    contentSimilarity?: {
      enabled?: boolean;
      shadowMode?: boolean;
      similarityThreshold?: number;
    };
  };
};

// #464-standard: grensevinduet FESTES IKKE i modulens policy.
//
// Foerste forsoek gjorde nettopp det — «sett den eksplisitt hver gang en modul redigeres». QA-porten
// fant tre uavhengige feil, og alle tre kom av det samme: vinduet er en AVLEDET verdi (terskelen
// minus baandet i regelfila), og en avledet verdi som skrives inn i innhold blir gammel.
//
//   • Det festede vinduet manglet `exclusiveMax`, saa et resultat paa noeyaktig terskelen ble
//     bestaatt uten policy og sendt til sensor med policy.
//   • Endret forfatteren terskelen fra 70 til 60, sto vinduet igjen paa 60-70 — altsaa OVER
//     terskelen. Hver bestaatt i 60-70 ville da gaatt til sensor, og det tiltenkte baandet 50-60
//     ville blitt strooket automatisk.
//   • Festingen dekket ikke ruta forfatterne faktisk lagrer gjennom.
//
// ⚠️ Aa fikse alle tre ville etterlatt en denormalisert verdi som kan bli utdatert igjen i morgen.
// Standarden gjelder derfor kun i kjoeretid (`decisionService`), der terskelen uansett er kjent.
// Forfatterflaten VISER den gjeldende verdien i stedet for aa lagre den.

export const assessmentPolicyCodec = {
  parse(raw: string | null | undefined): ModuleAssessmentPolicy | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ModuleAssessmentPolicy;
    } catch {
      return null;
    }
  },

  serialize(value: ModuleAssessmentPolicy): string {
    return JSON.stringify(value);
  },
};
