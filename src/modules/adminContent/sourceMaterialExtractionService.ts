import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { parseOffice } from "officeparser";

const require = createRequire(import.meta.url);

const WordExtractorCtor = require("word-extractor") as new () => {
  extract: (input: string | Buffer) => Promise<{
    getBody: () => string;
    getHeaders?: (options?: { includeFooters?: boolean }) => string;
    getFooters?: () => string;
    getFootnotes?: () => string;
    getEndnotes?: () => string;
    getAnnotations?: () => string;
    getTextboxes?: (options?: { includeHeadersAndFooters?: boolean; includeBody?: boolean }) => string;
  }>;
};

const pptParser = require("ppt") as {
  readFile: (filename: string, options?: Record<string, unknown>) => unknown;
  utils: {
    to_text: (presentation: unknown) => string[];
  };
};

export const SOURCE_MATERIAL_MAX_BYTES = 2 * 1024 * 1024;

export const SUPPORTED_SOURCE_MATERIAL_EXTENSIONS = [
  ".txt",
  ".md",
  ".pdf",
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".rtf",
  ".odt",
  ".odp",
  ".ods",
] as const;

export type SupportedSourceMaterialFormat =
  | "txt"
  | "md"
  | "pdf"
  | "docx"
  | "doc"
  | "pptx"
  | "ppt"
  | "rtf"
  | "odt"
  | "odp"
  | "ods";

export type SourceMaterialExtractionInput = {
  fileName: string;
  mimeType?: string;
  contentBase64: string;
};

export type SourceMaterialExtractionResult = {
  extractedText: string;
  fileName: string;
  format: SupportedSourceMaterialFormat;
  extractedChars: number;
};

export type SourceMaterialExtractionAdapters = {
  parseOffice: (buffer: Buffer, format: Exclude<SupportedSourceMaterialFormat, "txt" | "md" | "doc" | "ppt">) => Promise<string>;
  parseLegacyDoc: (buffer: Buffer) => Promise<string>;
  parseLegacyPpt: (buffer: Buffer) => Promise<string>;
};

export class UnsupportedSourceMaterialFormatError extends Error {
  constructor(fileName: string) {
    super(`Unsupported source material format for "${fileName}".`);
    this.name = "UnsupportedSourceMaterialFormatError";
  }
}

export class SourceMaterialTooLargeError extends Error {
  constructor(maxBytes = SOURCE_MATERIAL_MAX_BYTES) {
    super(`Source material file exceeds the ${maxBytes}-byte limit.`);
    this.name = "SourceMaterialTooLargeError";
  }
}

export class SourceMaterialExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceMaterialExtractionError";
  }
}

const defaultAdapters: SourceMaterialExtractionAdapters = {
  async parseOffice(buffer) {
    const ast = await parseOffice(buffer, {
      outputErrorToConsole: false,
      extractAttachments: false,
      includeRawContent: false,
      newlineDelimiter: "\n",
    });
    return ast.toText();
  },
  async parseLegacyDoc(buffer) {
    const extractor = new WordExtractorCtor();
    const document = await extractor.extract(buffer);
    return compactTextSections([
      safeSection(() => document.getBody()),
      safeSection(() => document.getTextboxes?.({ includeHeadersAndFooters: true, includeBody: true })),
      safeSection(() => document.getHeaders?.({ includeFooters: false })),
      safeSection(() => document.getFooters?.()),
      safeSection(() => document.getFootnotes?.()),
      safeSection(() => document.getEndnotes?.()),
      safeSection(() => document.getAnnotations?.()),
    ]);
  },
  async parseLegacyPpt(buffer) {
    const tempPath = path.join(os.tmpdir(), `a2-admin-content-${randomUUID()}.ppt`);
    await fs.writeFile(tempPath, buffer);
    try {
      const presentation = pptParser.readFile(tempPath);
      const segments = pptParser.utils.to_text(presentation);
      return compactTextSections(segments);
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  },
};

export async function extractSourceMaterialText(
  input: SourceMaterialExtractionInput,
  adapters: SourceMaterialExtractionAdapters = defaultAdapters,
): Promise<SourceMaterialExtractionResult> {
  const fileName = input.fileName.trim();
  if (!fileName) {
    throw new SourceMaterialExtractionError("Source material file name is required.");
  }

  const format = detectSourceMaterialFormat(fileName, input.mimeType);
  if (!format) {
    throw new UnsupportedSourceMaterialFormatError(fileName);
  }

  const content = decodeBase64Payload(input.contentBase64);
  if (content.byteLength > SOURCE_MATERIAL_MAX_BYTES) {
    throw new SourceMaterialTooLargeError();
  }

  let extractedText = "";

  try {
    switch (format) {
      case "txt":
      case "md":
        extractedText = content.toString("utf8");
        break;
      case "doc":
        extractedText = await adapters.parseLegacyDoc(content);
        break;
      case "ppt":
        extractedText = await adapters.parseLegacyPpt(content);
        break;
      case "pdf":
      case "docx":
      case "pptx":
      case "rtf":
      case "odt":
      case "odp":
      case "ods":
        extractedText = await adapters.parseOffice(content, format);
        break;
      default:
        throw new UnsupportedSourceMaterialFormatError(fileName);
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : `Could not extract readable text from ${fileName}.`;
    throw new SourceMaterialExtractionError(message);
  }

  const normalized = normalizeExtractedText(extractedText);
  if (!normalized) {
    throw new SourceMaterialExtractionError(`Could not extract readable text from ${fileName}.`);
  }

  return {
    extractedText: normalized,
    fileName,
    format,
    extractedChars: normalized.length,
  };
}

export function detectSourceMaterialFormat(
  fileName: string,
  mimeType?: string,
): SupportedSourceMaterialFormat | null {
  const extension = path.extname(fileName).toLowerCase();
  const normalizedMime = (mimeType ?? "").toLowerCase();

  if (extension === ".txt" || normalizedMime === "text/plain") return "txt";
  if (extension === ".md" || normalizedMime === "text/markdown" || normalizedMime === "text/x-markdown") return "md";
  if (extension === ".pdf" || normalizedMime === "application/pdf") return "pdf";
  if (
    extension === ".docx" ||
    normalizedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (extension === ".doc" || normalizedMime === "application/msword") return "doc";
  if (
    extension === ".pptx" ||
    normalizedMime === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }
  if (extension === ".ppt" || normalizedMime === "application/vnd.ms-powerpoint") return "ppt";
  if (extension === ".rtf" || normalizedMime === "application/rtf" || normalizedMime === "text/rtf") return "rtf";
  if (extension === ".odt" || normalizedMime === "application/vnd.oasis.opendocument.text") return "odt";
  if (extension === ".odp" || normalizedMime === "application/vnd.oasis.opendocument.presentation") return "odp";
  if (extension === ".ods" || normalizedMime === "application/vnd.oasis.opendocument.spreadsheet") return "ods";
  return null;
}

function decodeBase64Payload(contentBase64: string): Buffer {
  const normalized = contentBase64.replace(/\s+/g, "");
  if (!normalized) {
    throw new SourceMaterialExtractionError("Source material payload is empty.");
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new SourceMaterialExtractionError("Source material payload is not valid base64.");
  }
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.byteLength === 0) {
    throw new SourceMaterialExtractionError("Source material payload decoded to empty content.");
  }
  return decoded;
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactTextSections(sections: Array<string | undefined>): string {
  return sections
    .map((section) => normalizeExtractedText(section ?? ""))
    .filter(Boolean)
    .join("\n\n");
}

function safeSection(factory: () => string | undefined): string | undefined {
  try {
    return factory();
  } catch {
    return undefined;
  }
}
