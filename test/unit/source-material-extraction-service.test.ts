import { describe, expect, it } from "vitest";
import {
  detectSourceMaterialFormat,
  extractSourceMaterialText,
  SourceMaterialExtractionError,
  SOURCE_MATERIAL_MAX_BYTES,
  SourceMaterialTooLargeError,
  UnsupportedSourceMaterialFormatError,
} from "../../src/modules/adminContent/sourceMaterialExtractionService.js";

function toBase64(value: string | Buffer) {
  return Buffer.isBuffer(value)
    ? value.toString("base64")
    : Buffer.from(value, "utf8").toString("base64");
}

function fakePdfBuffer() {
  return Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n", "utf8");
}

function fakeOleBuffer() {
  return Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

function fakeOoxmlBuffer() {
  return Buffer.from([
    0x50, 0x4b, 0x03, 0x04,
    0x50, 0x4b, 0x05, 0x06,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00,
  ]);
}

describe("source material extraction service", () => {
  it("detects the expanded minimum file-type set", () => {
    expect(detectSourceMaterialFormat("notes.txt")).toBe("txt");
    expect(detectSourceMaterialFormat("brief.md")).toBe("md");
    expect(detectSourceMaterialFormat("handbook.pdf")).toBe("pdf");
    expect(detectSourceMaterialFormat("template.docx")).toBe("docx");
    expect(detectSourceMaterialFormat("legacy.doc")).toBe("doc");
    expect(detectSourceMaterialFormat("slides.pptx")).toBe("pptx");
    expect(detectSourceMaterialFormat("legacy.ppt")).toBe("ppt");
    expect(detectSourceMaterialFormat("memo.rtf")).toBe("rtf");
    expect(detectSourceMaterialFormat("notes.odt")).toBe("odt");
    expect(detectSourceMaterialFormat("deck.odp")).toBe("odp");
    expect(detectSourceMaterialFormat("matrix.ods")).toBe("ods");
  });

  it("extracts UTF-8 text directly from markdown files", async () => {
    const result = await extractSourceMaterialText(
      {
        fileName: "brief.md",
        mimeType: "text/markdown",
        contentBase64: toBase64("# Heading\n\nBody text"),
      },
      {
        parseOffice: async () => "",
        parseLegacyDoc: async () => "",
        parseLegacyPpt: async () => "",
      },
    );

    expect(result.format).toBe("md");
    expect(result.extractedText).toBe("# Heading\n\nBody text");
  });

  it("routes office-backed formats through the unified office parser adapter", async () => {
    const result = await extractSourceMaterialText(
      {
        fileName: "slides.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        contentBase64: toBase64(fakeOoxmlBuffer()),
      },
      {
        parseOffice: async (_buffer, format) => `parsed:${format}`,
        parseLegacyDoc: async () => "",
        parseLegacyPpt: async () => "",
      },
    );

    expect(result.format).toBe("pptx");
    expect(result.extractedText).toBe("parsed:pptx");
  });

  it("routes legacy word files through the legacy doc adapter", async () => {
    const result = await extractSourceMaterialText(
      {
        fileName: "legacy.doc",
        contentBase64: toBase64(fakeOleBuffer()),
      },
      {
        parseOffice: async () => "",
        parseLegacyDoc: async () => "legacy doc body",
        parseLegacyPpt: async () => "",
      },
    );

    expect(result.format).toBe("doc");
    expect(result.extractedText).toBe("legacy doc body");
  });

  it("routes legacy powerpoint files through the legacy ppt adapter", async () => {
    const result = await extractSourceMaterialText(
      {
        fileName: "legacy.ppt",
        contentBase64: toBase64(fakeOleBuffer()),
      },
      {
        parseOffice: async () => "",
        parseLegacyDoc: async () => "",
        parseLegacyPpt: async () => "legacy ppt body",
      },
    );

    expect(result.format).toBe("ppt");
    expect(result.extractedText).toBe("legacy ppt body");
  });

  it("rejects unsupported file formats", async () => {
    await expect(() =>
      extractSourceMaterialText(
        {
          fileName: "archive.zip",
          contentBase64: toBase64("zip"),
        },
        {
          parseOffice: async () => "",
          parseLegacyDoc: async () => "",
          parseLegacyPpt: async () => "",
        },
      ),
    ).rejects.toBeInstanceOf(UnsupportedSourceMaterialFormatError);
  });

  it("rejects oversized files before parsing", async () => {
    await expect(() =>
      extractSourceMaterialText(
        {
          fileName: "notes.txt",
          contentBase64: Buffer.alloc(SOURCE_MATERIAL_MAX_BYTES + 1, 65).toString("base64"),
        },
        {
          parseOffice: async () => "",
          parseLegacyDoc: async () => "",
          parseLegacyPpt: async () => "",
        },
      ),
    ).rejects.toBeInstanceOf(SourceMaterialTooLargeError);
  });

  it("rejects files when extraction yields no readable text", async () => {
    await expect(() =>
      extractSourceMaterialText(
        {
          fileName: "notes.pdf",
          contentBase64: toBase64(fakePdfBuffer()),
        },
        {
          parseOffice: async () => "   \n\n   ",
          parseLegacyDoc: async () => "",
          parseLegacyPpt: async () => "",
        },
      ),
    ).rejects.toBeInstanceOf(SourceMaterialExtractionError);
  });
});
