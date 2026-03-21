export type ModuleAssessmentPolicy = {
  scoring?: {
    practicalWeight?: number;
    mcqWeight?: number;
  };
  passRules?: {
    totalMin?: number;
    practicalMinPercent?: number;
    mcqMinPercent?: number;
    borderlineWindow?: {
      min?: number;
      max?: number;
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
