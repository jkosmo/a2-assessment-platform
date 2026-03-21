export type SubmissionSchemaField = {
  id: string;
  label: string | Partial<Record<"en-GB" | "nb" | "nn", string>>;
  type: "textarea" | "text";
  required?: boolean;
};

export type SubmissionSchema = {
  fields: SubmissionSchemaField[];
};

export const submissionSchemaCodec = {
  parse(raw: string | null | undefined): SubmissionSchema | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SubmissionSchema;
    } catch {
      return null;
    }
  },

  serialize(value: SubmissionSchema): string {
    return JSON.stringify(value);
  },
};
