// AA-6 (#762): unit tests for the fallback-export validation checks (bundled, no src import).
// The REAL-schema round-trip lives in agent-authoring-export-schema-roundtrip.test.ts.

import { describe, expect, it } from "vitest";
import {
  toIsoZ,
  isStrictDatetime,
  strictDatetimeFieldsOk,
  normalizeEnvelopeDates,
  validateExportEnvelopeStructure,
  buildFallbackEnvelope,
  roundTripFallbackExport,
  claimsImportValidated,
  describeChecks,
  // @ts-expect-error — .mjs skill script consumed as a library
} from "../../skills/a2-authoring-api/scripts/export-validate.mjs";

// A minimal in-memory filesystem so the round-trip (write -> read back -> parse) is exercised
// without touching disk.
function memoryFs() {
  const files = new Map<string, string>();
  return {
    files,
    writeFileImpl: async (path: string, data: string) => void files.set(path, data),
    readFileImpl: async (path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path)!;
    },
  };
}

const pkg = {
  packageFormat: "a2-authoring-package/v1",
  objects: [
    {
      clientRef: "intro",
      type: "section",
      payload: { title: "Introduksjon", bodyMarkdown: "## Intro\n\nPersonvern." },
    },
    {
      clientRef: "modul-mcq",
      type: "module",
      payload: {
        module: { title: "Prinsipper", certificationLevel: "basic" },
        activeVersion: {
          assessmentMode: "MCQ_ONLY",
          mcqSet: {
            title: "Kontroll",
            questions: [{ stem: "Hva?", options: ["A", "B"], correctAnswer: "A", rationale: "A er riktig." }],
          },
        },
      },
    },
    {
      clientRef: "kurs",
      type: "course",
      payload: {
        course: { title: "Personvern", description: "Grunnkurs", certificationLevel: "basic" },
        items: [
          { type: "SECTION", ref: "intro" },
          { type: "MODULE", ref: "modul-mcq" },
        ],
      },
    },
  ],
};

describe("#762 datetime normalisation (Issue 2)", () => {
  it("7. a valid exportedAt with Z is accepted as strict", () => {
    const z = "2026-07-10T21:05:15.364Z";
    expect(isStrictDatetime(z)).toBe(true);
    expect(toIsoZ(z)).toBe(z);
  });

  it("8. an offset+microseconds datetime is rejected raw, and normalised to strict Z", () => {
    const bad = "2026-07-10T21:01:25.216841+00:00"; // the real rejected value
    expect(isStrictDatetime(bad)).toBe(false);
    const normalised = toIsoZ(bad);
    expect(isStrictDatetime(normalised)).toBe(true);
    expect(normalised).toBe("2026-07-10T21:01:25.216Z");
  });

  it("collects and flags every at-risk datetime field, and normalises them all", () => {
    const envelope = buildFallbackEnvelope(pkg);
    // Re-inject bad values (the generator normalises exportedAt itself) to prove BOTH the
    // top-level exportedAt and a nested audit.publishedAt are collected and flagged.
    envelope.exportedAt = "2026-07-10T21:01:25.216841+00:00";
    envelope.course.course.audit = { publishedAt: "2026-07-10T21:01:25.216841+00:00" };
    const before = strictDatetimeFieldsOk(envelope);
    expect(before.ok).toBe(false);
    expect(before.offenders.map((o: { path: string }) => o.path)).toEqual(
      expect.arrayContaining(["exportedAt", "course.course.audit.publishedAt"]),
    );
    const after = strictDatetimeFieldsOk(normalizeEnvelopeDates(envelope));
    expect(after.ok).toBe(true);
  });

  it("toIsoZ throws on an unparseable value rather than emitting garbage", () => {
    expect(() => toIsoZ("not-a-date")).toThrow();
  });
});

describe("#762 bundled structural validator", () => {
  it("accepts a well-formed generated envelope", () => {
    const envelope = buildFallbackEnvelope(pkg);
    expect(validateExportEnvelopeStructure(envelope).valid).toBe(true);
  });

  it("rejects an MCQ whose correctAnswer is not one of the options", () => {
    const envelope = buildFallbackEnvelope(pkg);
    const mcq = envelope.course.course.items[1].module.activeVersion.mcqSet;
    mcq.questions[0].correctAnswer = "Z"; // not in options
    const result = validateExportEnvelopeStructure(envelope);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i: { message: string }) => /options/.test(i.message))).toBe(true);
  });

  it("rejects a scope/payload mismatch", () => {
    const envelope = buildFallbackEnvelope(pkg);
    envelope.scope = "module";
    expect(validateExportEnvelopeStructure(envelope).valid).toBe(false);
  });
});

describe("#762 round-trip fallback export", () => {
  it("7. delivers a complete envelope after write -> read-back -> parse -> validate", async () => {
    const fs = memoryFs();
    const envelope = buildFallbackEnvelope(pkg, { exportedAt: "2026-07-10T21:05:15.364Z" });
    const report = await roundTripFallbackExport(envelope, { filePath: "kurs.json", ...fs });
    expect(report.delivered).toBe(true);
    expect(report.checks.jsonParsing.status).toBe("pass");
    expect(report.checks.exportSchemaValidation.status).toBe("pass");
    expect(report.checks.importSchemaValidation.status).toBe("pass");
    // The delivered file IS the validated file.
    expect(fs.files.get("kurs.json")).toContain("a2-content-export/v1");
  });

  it("8. normalises an offset/microseconds exportedAt before writing the delivered file", async () => {
    const fs = memoryFs();
    const envelope = buildFallbackEnvelope(pkg, { exportedAt: new Date("2026-07-10T21:05:15.364Z") });
    envelope.exportedAt = "2026-07-10T21:01:25.216841+00:00"; // re-inject the bad value
    const report = await roundTripFallbackExport(envelope, { filePath: "kurs.json", ...fs });
    expect(report.delivered).toBe(true);
    expect(report.envelope.exportedAt).toBe("2026-07-10T21:01:25.216Z");
    expect(fs.files.get("kurs.json")).toContain("2026-07-10T21:01:25.216Z");
    expect(fs.files.get("kurs.json")).not.toContain("+00:00");
  });

  it("does NOT deliver when the finished file fails schema validation", async () => {
    const fs = memoryFs();
    const envelope = buildFallbackEnvelope(pkg);
    envelope.course.course.items[1].module.activeVersion.mcqSet.questions[0].correctAnswer = "Z";
    const report = await roundTripFallbackExport(envelope, { filePath: "kurs.json", ...fs });
    expect(report.delivered).toBe(false);
    expect(report.checks.exportSchemaValidation.status).toBe("fail");
  });

  it("blocks delivery when content-integrity reports loss", async () => {
    const fs = memoryFs();
    const envelope = buildFallbackEnvelope(pkg);
    const report = await roundTripFallbackExport(envelope, {
      filePath: "kurs.json",
      ...fs,
      contentIntegrity: () => ({ blocks: true, reasons: ["approved element absent"] }),
    });
    expect(report.delivered).toBe(false);
    expect(report.checks.contentIntegrity.status).toBe("fail");
  });
});

describe("#762 named-check report (Issue 2, never say 'validated' generically)", () => {
  it("10. a report where only JSON parsing ran must NOT claim import validation", () => {
    const report = {
      checks: {
        jsonParsing: { status: "pass" },
        exportSchemaValidation: { status: "not-run" },
        importSchemaValidation: { status: "not-run" },
        contentIntegrity: { status: "not-run" },
        apiDryRun: { status: "unavailable" },
        actualImport: { status: "skipped" },
      },
    };
    expect(claimsImportValidated(report)).toBe(false);
    const lines = describeChecks(report);
    expect(lines).toContain("import-schema validation: not-run");
    expect(lines.join("\n")).not.toMatch(/import-schema validation: pass/);
  });

  it("distinguishes checks by name and flags the missing dry-run endpoint", async () => {
    const fs = memoryFs();
    const report = await roundTripFallbackExport(buildFallbackEnvelope(pkg), { filePath: "k.json", ...fs });
    const lines = describeChecks(report);
    expect(lines.some((l: string) => l.startsWith("API dry-run: unavailable"))).toBe(true);
    expect(lines.some((l: string) => l.startsWith("actual import: skipped"))).toBe(true);
    expect(claimsImportValidated(report)).toBe(true);
  });
});
