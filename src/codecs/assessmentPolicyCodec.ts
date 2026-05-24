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
