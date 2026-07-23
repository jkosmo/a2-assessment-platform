import path from "node:path";
import { createRequire } from "node:module";
import { withTimeout } from "../../clients/externalCall.js";

// #815: participant submission attachments (PDF/DOCX, base64 within the upload cap) are parsed inline in
// the web request. Without guards a DOCX zip-bomb or pathological file exhausts web memory/CPU below the
// per-minute rate limit. These bounds neutralize that in-process:
//   - a hard byte cap on the decoded attachment,
//   - magic-byte (file-signature) validation so the bytes actually match the claimed PDF/DOCX,
//   - a DOCX decompressed-size + entry-count cap read from the ZIP central directory WITHOUT inflating
//     (the classic zip-bomb defense — a bomb declares a huge uncompressed size that we reject up front),
//   - a wall-clock timeout around the parse.
// Full out-of-process isolation (routing through the parser worker) is deliberately out of scope here.
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // decoded payload cap (matches the ~5MB upload limit)
export const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // a real .docx is well under this; bombs aren't
export const MAX_DOCX_ENTRIES = 512; // a real .docx has tens of parts; bombs pack far more
export const DOCUMENT_PARSE_TIMEOUT_MS = 10_000;

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
    // #815: reject before handing anything to pdf-parse/mammoth.
    assertAttachmentWithinByteCap(payload);
    assertFileSignatureMatches(payload, format);
    if (format === "docx") assertDocxWithinDecompressionLimits(payload);

    const extracted = await withTimeout(
      format === "pdf" ? adapters.parsePdf(payload) : adapters.parseDocx(payload),
      DOCUMENT_PARSE_TIMEOUT_MS,
      `parse_${format}`,
    );
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

// #815: hard cap on the decoded attachment — defense in depth behind the upload body limit.
function assertAttachmentWithinByteCap(payload: Buffer) {
  if (payload.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`attachment_too_large_${payload.length}`);
  }
}

// #815: verify the bytes actually start with the expected file signature, so a file can't be disguised
// (e.g. a zip bomb sent with a .pdf name) to reach the wrong parser. PDF = "%PDF"; DOCX is a ZIP = "PK\x03\x04".
function assertFileSignatureMatches(payload: Buffer, format: "pdf" | "docx") {
  if (format === "pdf") {
    if (!(payload.length >= 4 && payload[0] === 0x25 && payload[1] === 0x50 && payload[2] === 0x44 && payload[3] === 0x46)) {
      throw new Error("pdf_signature_mismatch");
    }
    return;
  }
  // docx → local file header of a ZIP archive.
  if (!(payload.length >= 4 && payload[0] === 0x50 && payload[1] === 0x4b && payload[2] === 0x03 && payload[3] === 0x04)) {
    throw new Error("docx_signature_mismatch");
  }
}

// #815: zip-bomb defense. A .docx is a ZIP; mammoth inflates it into memory. Read the declared uncompressed
// size + entry count from the ZIP central directory WITHOUT inflating, and reject an archive that would
// expand past the caps. Sizes hidden behind a ZIP64 marker (0xFFFFFFFF) are conservatively rejected.
function assertDocxWithinDecompressionLimits(payload: Buffer) {
  const EOCD_SIG = 0x06054b50; // End Of Central Directory record
  const CDH_SIG = 0x02014b50; // Central Directory File Header

  // EOCD sits at the end, before an optional comment (max 64KB). Scan backwards for its signature.
  let eocd = -1;
  const scanFloor = Math.max(0, payload.length - 22 - 0xffff);
  for (let i = payload.length - 22; i >= scanFloor; i--) {
    if (payload.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("docx_zip_eocd_not_found");

  const totalEntries = payload.readUInt16LE(eocd + 10);
  if (totalEntries > MAX_DOCX_ENTRIES) throw new Error(`docx_too_many_entries_${totalEntries}`);
  const cdOffset = payload.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) throw new Error("docx_zip64_unsupported");

  let ptr = cdOffset;
  let totalUncompressed = 0;
  for (let n = 0; n < totalEntries; n++) {
    if (ptr + 46 > payload.length || payload.readUInt32LE(ptr) !== CDH_SIG) {
      throw new Error("docx_central_directory_malformed");
    }
    const uncompressedSize = payload.readUInt32LE(ptr + 24);
    if (uncompressedSize === 0xffffffff) throw new Error("docx_zip64_unsupported");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw new Error(`docx_decompressed_too_large_${totalUncompressed}`);
    }
    const nameLen = payload.readUInt16LE(ptr + 28);
    const extraLen = payload.readUInt16LE(ptr + 30);
    const commentLen = payload.readUInt16LE(ptr + 32);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
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
