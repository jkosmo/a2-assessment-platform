import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text?: string }>;
const mammoth = require("mammoth") as {
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value?: string }>;
};

type DocumentFormat = "pdf" | "docx" | "unknown";
type ParseStatus = "skipped" | "parsed" | "fallback_raw_text";
type ParseQuality = "skipped" | "high" | "low" | "empty";

export type DocumentParserAdapters = {
  parsePdf: (buffer: Buffer) => Promise<string>;
  parseDocx: (buffer: Buffer) => Promise<string>;
};

type ResolveDocumentInput = {
  responseJson?: Record<string, unknown>;
  attachmentBase64?: string;
  attachmentFilename?: string;
  attachmentMimeType?: string;
};

export type DocumentParseOutcome = {
  resolvedResponseJson: Record<string, unknown>;
  parser: {
    status: ParseStatus;
    format: DocumentFormat;
    quality: ParseQuality;
    extractedChars: number;
    reason: string | null;
  };
};

const defaultAdapters: DocumentParserAdapters = {
  async parsePdf(buffer) {
    const parsed = await pdfParse(buffer);
    return (parsed.text ?? "").trim();
  },
  async parseDocx(buffer) {
    const parsed = await mammoth.extractRawText({ buffer });
    return (parsed.value ?? "").trim();
  },
};

export async function resolveSubmissionResponseJson(
  input: ResolveDocumentInput,
  adapters: DocumentParserAdapters = defaultAdapters,
): Promise<DocumentParseOutcome> {
  const baseResponseJson = input.responseJson ?? {};
  const hasResponseJson = Object.keys(baseResponseJson).length > 0;
  const attachmentBase64 = input.attachmentBase64?.trim();
  if (!attachmentBase64) {
    return {
      resolvedResponseJson: baseResponseJson,
      parser: {
        status: "skipped",
        format: "unknown",
        quality: "skipped",
        extractedChars: 0,
        reason: "no_attachment_payload",
      },
    };
  }

  const format = detectDocumentFormat(input.attachmentMimeType, input.attachmentFilename);
  if (format === "unknown") {
    if (hasResponseJson) {
      return {
        resolvedResponseJson: baseResponseJson,
        parser: {
          status: "fallback_raw_text",
          format,
          quality: "low",
          extractedChars: JSON.stringify(baseResponseJson).length,
          reason: "unsupported_attachment_format",
        },
      };
    }
    throw new Error(
      "Could not parse attachment. Only PDF and DOCX are supported. Provide fallback text in Raw text.",
    );
  }

  const payload = decodeAttachmentBase64(attachmentBase64);

  try {
    const extracted =
      format === "pdf" ? await adapters.parsePdf(payload) : await adapters.parseDocx(payload);
    const normalized = extracted.trim();
    if (!normalized) {
      if (hasResponseJson) {
        return {
          resolvedResponseJson: baseResponseJson,
          parser: {
            status: "fallback_raw_text",
            format,
            quality: "low",
            extractedChars: JSON.stringify(baseResponseJson).length,
            reason: "parser_returned_empty_text",
          },
        };
      }
      throw new Error(
        `Could not parse readable ${format.toUpperCase()} content. Provide fallback text in Raw text.`,
      );
    }

    return {
      resolvedResponseJson: { ...baseResponseJson, response: normalized },
      parser: {
        status: "parsed",
        format,
        quality: qualityFromText(normalized),
        extractedChars: normalized.length,
        reason: null,
      },
    };
  } catch (error) {
    if (hasResponseJson) {
      return {
        resolvedResponseJson: baseResponseJson,
        parser: {
          status: "fallback_raw_text",
          format,
          quality: "low",
          extractedChars: JSON.stringify(baseResponseJson).length,
          reason: error instanceof Error ? error.message : "parser_failed",
        },
      };
    }
    throw new Error(
      `Could not parse ${format.toUpperCase()} attachment. Provide a readable file or fallback text in Raw text.`,
    );
  }
}

function detectDocumentFormat(mimeType: string | undefined, fileName: string | undefined): DocumentFormat {
  const normalizedMime = (mimeType ?? "").toLowerCase();
  if (normalizedMime.includes("application/pdf")) {
    return "pdf";
  }
  if (normalizedMime.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
    return "docx";
  }

  const extension = path.extname(fileName ?? "").toLowerCase();
  if (extension === ".pdf") {
    return "pdf";
  }
  if (extension === ".docx") {
    return "docx";
  }
  return "unknown";
}

function decodeAttachmentBase64(input: string) {
  const normalized = input.replace(/\s+/g, "");
  if (!normalized) {
    throw new Error("Attachment payload is empty.");
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new Error("Attachment payload is not valid base64.");
  }
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.length === 0) {
    throw new Error("Attachment payload decoded to empty content.");
  }
  return decoded;
}

function qualityFromText(text: string): ParseQuality {
  const normalizedLength = text.trim().length;
  if (normalizedLength === 0) {
    return "empty";
  }
  return normalizedLength >= 80 ? "high" : "low";
}
