// #749 (Layer A): unit coverage that the export/import section schema accepts the new OPTIONAL
// `assets[]` block and that old asset-less files still validate. No DB — pure schema checks.

import { describe, expect, it } from "vitest";
import {
  sectionExportPayloadSchema,
  exportEnvelopeSchema,
} from "../../src/modules/adminContent/adminContentSchemas.js";

const svgBase64 = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><text>Hei</text></svg>',
  "utf8",
).toString("base64");

describe("#749 sectionExportPayloadSchema assets[]", () => {
  it("accepts a section WITHOUT assets (old v1 files import unchanged)", () => {
    const result = sectionExportPayloadSchema.safeParse({
      title: { nb: "Intro" },
      bodyMarkdown: { nb: "# Hei" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a section WITH an asset carrying a localized variant", () => {
    const result = sectionExportPayloadSchema.safeParse({
      title: { nb: "Intro" },
      bodyMarkdown: { nb: "# Hei\n\n![Flyt](asset:cmr8src001)" },
      assets: [
        {
          sourceId: "cmr8src001",
          filename: "flyt.svg",
          mimeType: "image/svg+xml",
          sizeBytes: 49,
          contentBase64: svgBase64,
          sourceLocale: "nb",
          localizedVariants: [{ locale: "en-GB", contentBase64: svgBase64 }],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an asset missing required fields (e.g. contentBase64)", () => {
    const result = sectionExportPayloadSchema.safeParse({
      title: { nb: "Intro" },
      bodyMarkdown: { nb: "# Hei" },
      assets: [{ sourceId: "x", filename: "f.png", mimeType: "image/png", sizeBytes: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a full course envelope whose section item carries assets", () => {
    const envelope = {
      exportFormat: "a2-content-export/v1",
      exportedAt: "2026-07-11T00:00:00.000Z",
      scope: "course",
      course: {
        course: {
          title: { "en-GB": "C", nb: "K", nn: "K" },
          certificationLevel: null,
          audit: {},
          items: [
            {
              type: "SECTION",
              sortOrder: 0,
              section: {
                title: { nb: "Intro" },
                bodyMarkdown: { nb: "![Flyt](asset:cmr8src001)" },
                audit: {},
                assets: [
                  {
                    sourceId: "cmr8src001",
                    filename: "flyt.svg",
                    mimeType: "image/svg+xml",
                    sizeBytes: 49,
                    contentBase64: svgBase64,
                  },
                ],
              },
            },
          ],
        },
      },
    };
    expect(exportEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });
});
