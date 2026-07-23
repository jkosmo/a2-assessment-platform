import { describe, expect, it, vi } from "vitest";
import {
  resolveSubmissionResponseJson,
  MAX_DOCX_UNCOMPRESSED_BYTES,
  MAX_DOCX_ENTRIES,
  type DocumentParserAdapters,
} from "../src/modules/assessment/documentParsingService.js";

const fakeAdapters: DocumentParserAdapters = {
  async parsePdf() {
    return "Parsed PDF text with enough detail for quality checks.";
  },
  async parseDocx() {
    return "Parsed DOCX text with enough detail for quality checks.";
  },
};

// #815: build a real PDF signature ("%PDF") in front of arbitrary bytes so the file-signature guard passes.
const pdfBase64 = (text = "body"): string =>
  Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(text)]).toString("base64");

// #815: build a minimal but structurally-valid ZIP (a .docx is a ZIP) whose central directory declares the
// given uncompressed sizes — enough for the signature + zip-bomb guards to read it without any real deflate.
function docxBase64(uncompressedSizes: number[]): string {
  const local = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04 local-file-header signature (for the magic check)
  const cd = Buffer.concat(
    uncompressedSizes.map((size) => {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); // central directory file header signature
      h.writeUInt32LE(size, 24); // uncompressed size
      h.writeUInt16LE(0, 28); // file name length
      h.writeUInt16LE(0, 30); // extra field length
      h.writeUInt16LE(0, 32); // comment length
      return h;
    }),
  );
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(uncompressedSizes.length, 8); // entries on this disk
  eocd.writeUInt16LE(uncompressedSizes.length, 10); // total entries
  eocd.writeUInt32LE(cd.length, 12); // central directory size
  eocd.writeUInt32LE(local.length, 16); // central directory offset
  return Buffer.concat([local, cd, eocd]).toString("base64");
}

describe("Document parsing service", () => {
  it("parses a PDF attachment with a valid signature", async () => {
    const outcome = await resolveSubmissionResponseJson(
      { attachmentMimeType: "application/pdf", attachmentBase64: pdfBase64() },
      fakeAdapters,
    );

    expect(outcome.resolvedResponseJson.response as string).toContain("Parsed PDF text");
    expect(outcome.parser.status).toBe("parsed");
    expect(outcome.parser.format).toBe("pdf");
    expect(outcome.parser.reason).toBeNull();
  });

  it("parses a DOCX attachment with a valid signature and modest size", async () => {
    const outcome = await resolveSubmissionResponseJson(
      { attachmentFilename: "submission.docx", attachmentBase64: docxBase64([4_000, 12_000]) },
      fakeAdapters,
    );
    expect(outcome.parser.status).toBe("parsed");
    expect(outcome.parser.format).toBe("docx");
  });

  it("falls back to responseJson when the parser throws but fallback text exists", async () => {
    const failingDocxAdapters: DocumentParserAdapters = {
      ...fakeAdapters,
      async parseDocx() {
        throw new Error("DOCX parser failed");
      },
    };

    const outcome = await resolveSubmissionResponseJson(
      {
        attachmentFilename: "submission.docx",
        attachmentBase64: docxBase64([4_000]),
        responseJson: { response: "Manual fallback raw text" },
      },
      failingDocxAdapters,
    );

    expect(outcome.resolvedResponseJson.response).toBe("Manual fallback raw text");
    expect(outcome.parser.status).toBe("fallback_raw_text");
    expect(outcome.parser.reason).toContain("DOCX parser failed");
  });

  it("returns clear feedback when parser fails and fallback responseJson is missing", async () => {
    const failingPdfAdapters: DocumentParserAdapters = {
      ...fakeAdapters,
      async parsePdf() {
        throw new Error("PDF parser failed");
      },
    };

    await expect(
      resolveSubmissionResponseJson(
        { attachmentFilename: "submission.pdf", attachmentBase64: pdfBase64() },
        failingPdfAdapters,
      ),
    ).rejects.toThrow("Could not parse PDF attachment.");
  });

  it("returns clear feedback for unsupported format without fallback responseJson", async () => {
    await expect(
      resolveSubmissionResponseJson(
        { attachmentFilename: "submission.txt", attachmentBase64: Buffer.from("plain-text-content").toString("base64") },
        fakeAdapters,
      ),
    ).rejects.toThrow("Only PDF and DOCX are supported.");
  });

  // ── #815 hardening ─────────────────────────────────────────────────────────
  it("rejects a file whose bytes don't match the claimed PDF signature (no parse)", async () => {
    const parsePdf = vi.fn(fakeAdapters.parsePdf);
    const outcome = await resolveSubmissionResponseJson(
      {
        attachmentMimeType: "application/pdf",
        attachmentBase64: Buffer.from("this is not really a pdf").toString("base64"),
        responseJson: { response: "fallback" },
      },
      { ...fakeAdapters, parsePdf },
    );
    expect(parsePdf).not.toHaveBeenCalled();
    expect(outcome.parser.status).toBe("fallback_raw_text");
    expect(outcome.parser.reason).toContain("pdf_signature_mismatch");
  });

  it("rejects a DOCX zip-bomb (declared uncompressed size over the cap) WITHOUT invoking mammoth", async () => {
    const parseDocx = vi.fn(fakeAdapters.parseDocx);
    const outcome = await resolveSubmissionResponseJson(
      {
        attachmentFilename: "bomb.docx",
        attachmentBase64: docxBase64([MAX_DOCX_UNCOMPRESSED_BYTES + 1]),
        responseJson: { response: "fallback" },
      },
      { ...fakeAdapters, parseDocx },
    );
    expect(parseDocx).not.toHaveBeenCalled();
    expect(outcome.parser.reason).toContain("docx_decompressed_too_large");
  });

  it("rejects a DOCX with too many entries WITHOUT invoking mammoth", async () => {
    const parseDocx = vi.fn(fakeAdapters.parseDocx);
    const outcome = await resolveSubmissionResponseJson(
      {
        attachmentFilename: "many.docx",
        attachmentBase64: docxBase64(new Array(MAX_DOCX_ENTRIES + 1).fill(10)),
        responseJson: { response: "fallback" },
      },
      { ...fakeAdapters, parseDocx },
    );
    expect(parseDocx).not.toHaveBeenCalled();
    expect(outcome.parser.reason).toContain("docx_too_many_entries");
  });
});
