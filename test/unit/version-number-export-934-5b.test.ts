// #934 skive 5b: kurseksporten har kursets versjon som opplysning, og importen leser den ikke. Uten database. Gjennom ruta står det i
// test/m2-course-export-version-934-5b.test.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { courseExportPayloadSchema } from "../../src/modules/adminContent/adminContentSchemas.js";
import { moduleVersionLabel, moduleVersionNumber } from "../../public/static/version-label.js";

const kurs = (extra: Record<string, unknown> = {}) => ({
  course: {
    title: "Kurset",
    certificationLevel: null,
    audit: { publishedAt: null, publishedBy: null, publishedByEmail: null, sourceVersionNo: null },
    items: [{ type: "SECTION", sortOrder: 0, section: { title: "S", bodyMarkdown: "Tekst" } }],
    ...extra,
  },
});

describe("#934 skive 5b — versjonen i kurseksporten", () => {
  it("skjemaet tar den med, så den ikke forsvinner i en fil som leses og skrives på nytt", () => {
    const parsed = courseExportPayloadSchema.safeParse(kurs({ versionMajor: 3, versionMinor: 2 }));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.course).toMatchObject({ versionMajor: 3, versionMinor: 2 });
  });

  it("en fil fra før 2.136.0, uten feltene, leses som før", () => {
    const parsed = courseExportPayloadSchema.safeParse(kurs());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.course).not.toHaveProperty("versionMajor");
  });

  it("importen leser dem ikke: versjonen hører til kurset der det står", () => {
    const kilde = readFileSync(resolve(__dirname, "../../src/modules/adminContent/contentImportService.ts"), "utf8");
    expect(kilde).not.toMatch(/\bversionMajor\b|\bversionMinor\b/);
  });
});

describe("#934 skive 5b — det forfatter og deltaker ser", () => {
  it("nummeret når det finnes", () => {
    expect(moduleVersionNumber({ versionMajor: 2, versionMinor: 1, versionNo: 5 })).toBe("2.1");
    expect(moduleVersionLabel({ versionMajor: 2, versionMinor: 1, versionNo: 5 })).toBe("v2.1");
    expect(moduleVersionLabel({ versionMajor: 1, versionMinor: 0, versionNo: 1 })).toBe("v1.0");
  });

  it("uten nummer: det som alltid er vist, og aldri «vnull»", () => {
    expect(moduleVersionNumber({ versionMajor: null, versionMinor: null, versionNo: 5 })).toBeNull();
    expect(moduleVersionLabel({ versionMajor: null, versionMinor: null, versionNo: 5 })).toBe("v5");
    expect(moduleVersionLabel({ versionNo: 5 })).toBe("v5");
    expect(moduleVersionLabel(null)).toBe("");
    expect(moduleVersionLabel({})).toBe("");
  });
});
