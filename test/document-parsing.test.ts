import { describe, expect, it } from "vitest";
import { resolveSubmissionResponseJson, type DocumentParserAdapters } from "../src/services/documentParsingService.js";

const fakeAdapters: DocumentParserAdapters = {
  async parsePdf() {
    return "Parsed PDF text with enough detail for quality checks.";
  },
  async parseDocx() {
    return "Parsed DOCX text with enough detail for quality checks.";
  },
};

describe("Document parsing service", () => {
  it("parses PDF attachment content", async () => {
    const outcome = await resolveSubmissionResponseJson(
      {
        attachmentMimeType: "application/pdf",
        attachmentBase64: Buffer.from("fake-pdf-content").toString("base64"),
      },
      fakeAdapters,
    );

    expect((outcome.resolvedResponseJson.response as string)).toContain("Parsed PDF text");
    expect(outcome.parser.status).toBe("parsed");
    expect(outcome.parser.format).toBe("pdf");
    expect(outcome.parser.reason).toBeNull();
  });

  it("falls back to responseJson when parser fails but fallback responseJson exists", async () => {
    const failingDocxAdapters: DocumentParserAdapters = {
      ...fakeAdapters,
      async parseDocx() {
        throw new Error("DOCX parser failed");
      },
    };

    const outcome = await resolveSubmissionResponseJson(
      {
        attachmentFilename: "submission.docx",
        attachmentBase64: Buffer.from("fake-docx-content").toString("base64"),
        responseJson: { response: "Manual fallback raw text" },
      },
      failingDocxAdapters,
    );

    expect(outcome.resolvedResponseJson.response).toBe("Manual fallback raw text");
    expect(outcome.parser.status).toBe("fallback_raw_text");
    expect(outcome.parser.format).toBe("docx");
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
        {
          attachmentFilename: "submission.pdf",
          attachmentBase64: Buffer.from("fake-pdf-content").toString("base64"),
        },
        failingPdfAdapters,
      ),
    ).rejects.toThrow("Could not parse PDF attachment.");
  });

  it("returns clear feedback for unsupported format without fallback responseJson", async () => {
    await expect(
      resolveSubmissionResponseJson(
        {
          attachmentFilename: "submission.txt",
          attachmentBase64: Buffer.from("plain-text-content").toString("base64"),
        },
        fakeAdapters,
      ),
    ).rejects.toThrow("Only PDF and DOCX are supported.");
  });
});
