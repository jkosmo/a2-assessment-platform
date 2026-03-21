export type AssessmentRedFlag = {
  code: string;
  severity: string;
  description: string;
};

export const redFlagsCodec = {
  /** Parses a stored red flags JSON string. Returns an empty array on error. */
  parse(raw: string | null | undefined): AssessmentRedFlag[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as AssessmentRedFlag[];
      }
      return [];
    } catch {
      return [];
    }
  },

  serialize(value: AssessmentRedFlag[]): string {
    return JSON.stringify(value);
  },
};
