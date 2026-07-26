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
