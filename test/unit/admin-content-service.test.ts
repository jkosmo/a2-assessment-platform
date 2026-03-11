import { beforeEach, describe, expect, it, vi } from "vitest";

const findModuleSummary = vi.fn();
const createModuleRecord = vi.fn();
const findLatestRubricVersion = vi.fn();
const findLatestPromptTemplateVersion = vi.fn();
const findLatestMcqSetVersion = vi.fn();
const findLatestModuleVersion = vi.fn();
const createRubricVersionRecord = vi.fn();
const createPromptTemplateVersionRecord = vi.fn();
const createMcqSetVersionRecord = vi.fn();
const findVersionDependencies = vi.fn();
const createModuleVersionRecord = vi.fn();
const findPromptTemplateSummary = vi.fn();
const findModuleVersionSummary = vi.fn();
const publishModuleVersionRecord = vi.fn();
const recordAuditEvent = vi.fn();

vi.mock("../../src/repositories/adminContentRepository.js", () => ({
  adminContentRepository: {
    findModuleSummary,
    createModule: createModuleRecord,
    findLatestRubricVersion,
    findLatestPromptTemplateVersion,
    findLatestMcqSetVersion,
    findLatestModuleVersion,
    createRubricVersion: createRubricVersionRecord,
    createPromptTemplateVersion: createPromptTemplateVersionRecord,
    createMcqSetVersion: createMcqSetVersionRecord,
    findVersionDependencies,
    createModuleVersion: createModuleVersionRecord,
    findPromptTemplateSummary,
    findModuleVersionSummary,
    publishModuleVersion: publishModuleVersionRecord,
  },
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/config/benchmarkExamples.js", () => ({
  getBenchmarkExamplesConfig: () => ({
    maxExamplesPerVersion: 3,
    requiredFields: ["anchorId", "input", "expectedOutcome"],
    maxTextLength: 100,
  }),
}));

describe("admin content service", () => {
  beforeEach(() => {
    findModuleSummary.mockReset();
    createModuleRecord.mockReset();
    findLatestRubricVersion.mockReset();
    findLatestPromptTemplateVersion.mockReset();
    findLatestMcqSetVersion.mockReset();
    findLatestModuleVersion.mockReset();
    createRubricVersionRecord.mockReset();
    createPromptTemplateVersionRecord.mockReset();
    createMcqSetVersionRecord.mockReset();
    findVersionDependencies.mockReset();
    createModuleVersionRecord.mockReset();
    findPromptTemplateSummary.mockReset();
    findModuleVersionSummary.mockReset();
    publishModuleVersionRecord.mockReset();
    recordAuditEvent.mockReset();
  });

  it("rejects module creation when validTo is before validFrom", async () => {
    const { createModule } = await import("../../src/services/adminContentService.js");

    await expect(
      createModule({
        title: "Module",
        validFrom: new Date("2026-03-12T00:00:00.000Z"),
        validTo: new Date("2026-03-11T00:00:00.000Z"),
      }),
    ).rejects.toThrow("validTo must be on or after validFrom.");
  });

  it("creates a module and records module_created audit metadata", async () => {
    createModuleRecord.mockResolvedValue({
      id: "module-1",
      title: "Module One",
      certificationLevel: "foundation",
      validFrom: new Date("2026-03-01T00:00:00.000Z"),
      validTo: new Date("2027-03-01T00:00:00.000Z"),
    });

    const { createModule } = await import("../../src/services/adminContentService.js");

    const result = await createModule({
      title: "Module One",
      certificationLevel: "foundation",
      validFrom: new Date("2026-03-01T00:00:00.000Z"),
      validTo: new Date("2027-03-01T00:00:00.000Z"),
      actorId: "admin-1",
    });

    expect(recordAuditEvent).toHaveBeenCalledWith({
      entityType: "module",
      entityId: "module-1",
      action: "module_created",
      actorId: "admin-1",
      metadata: {
        moduleId: "module-1",
        title: "Module One",
        certificationLevel: "foundation",
        validFrom: "2026-03-01T00:00:00.000Z",
        validTo: "2027-03-01T00:00:00.000Z",
      },
    });
    expect(result).toEqual({
      id: "module-1",
      title: "Module One",
      certificationLevel: "foundation",
      validFrom: new Date("2026-03-01T00:00:00.000Z"),
      validTo: new Date("2027-03-01T00:00:00.000Z"),
    });
  });

  it("rejects module-version creation when a dependency belongs to another module", async () => {
    findModuleSummary.mockResolvedValue({ id: "module-1", activeVersionId: null });
    findLatestModuleVersion.mockResolvedValue({ versionNo: 2 });
    findVersionDependencies.mockResolvedValue([
      { id: "rubric-1", moduleId: "module-1" },
      { id: "prompt-1", moduleId: "module-2" },
      { id: "mcq-1", moduleId: "module-1" },
    ]);

    const { createModuleVersion } = await import("../../src/services/adminContentService.js");

    await expect(
      createModuleVersion({
        moduleId: "module-1",
        taskText: "Task",
        guidanceText: "Guide",
        rubricVersionId: "rubric-1",
        promptTemplateVersionId: "prompt-1",
        mcqSetVersionId: "mcq-1",
      }),
    ).rejects.toThrow("Prompt template version is missing or belongs to another module.");

    expect(createModuleVersionRecord).not.toHaveBeenCalled();
  });

  it("creates benchmark example prompt versions with enriched example metadata and audit trail", async () => {
    findModuleSummary.mockResolvedValue({ id: "module-1", activeVersionId: null });
    findPromptTemplateSummary.mockResolvedValue({
      id: "prompt-1",
      moduleId: "module-1",
      systemPrompt: "system",
      userPromptTemplate: "template",
    });
    findModuleVersionSummary.mockResolvedValue({
      id: "module-version-1",
      moduleId: "module-1",
    });
    findLatestPromptTemplateVersion.mockResolvedValue({ versionNo: 4 });
    createPromptTemplateVersionRecord.mockResolvedValue({
      id: "prompt-5",
      moduleId: "module-1",
      versionNo: 5,
      active: true,
      createdAt: new Date("2026-03-11T12:00:00.000Z"),
    });

    const { createBenchmarkExampleVersion } = await import("../../src/services/adminContentService.js");

    const result = await createBenchmarkExampleVersion({
      moduleId: "module-1",
      basePromptTemplateVersionId: "prompt-1",
      linkedModuleVersionId: "module-version-1",
      actorId: "admin-1",
      active: true,
      examples: [
        {
          anchorId: "anchor-1",
          input: "Example input",
          expectedOutcome: "PASS",
        },
      ],
    });

    expect(createPromptTemplateVersionRecord).toHaveBeenCalledWith({
      moduleId: "module-1",
      versionNo: 5,
      systemPrompt: "system",
      userPromptTemplate: "template",
      examplesJson: JSON.stringify([
        {
          anchorId: "anchor-1",
          input: "Example input",
          expectedOutcome: "PASS",
          benchmarkExampleIndex: 1,
          sourcePromptTemplateVersionId: "prompt-1",
          sourceModuleVersionId: "module-version-1",
          benchmarkVersionNo: 5,
        },
      ]),
      active: true,
    });
    expect(recordAuditEvent).toHaveBeenCalledWith({
      entityType: "prompt_template_version",
      entityId: "prompt-5",
      action: "benchmark_example_version_created",
      actorId: "admin-1",
      metadata: {
        moduleId: "module-1",
        promptTemplateVersionId: "prompt-5",
        sourcePromptTemplateVersionId: "prompt-1",
        sourceModuleVersionId: "module-version-1",
        benchmarkExampleCount: 1,
        versionNo: 5,
      },
    });
    expect(result).toEqual({
      id: "prompt-5",
      moduleId: "module-1",
      versionNo: 5,
      active: true,
      createdAt: new Date("2026-03-11T12:00:00.000Z"),
      sourcePromptTemplateVersionId: "prompt-1",
      sourceModuleVersionId: "module-version-1",
      benchmarkExampleCount: 1,
    });
  });

  it("publishes a module version and records the previous active version in audit metadata", async () => {
    findModuleSummary.mockResolvedValue({
      id: "module-1",
      activeVersionId: "module-version-2",
    });
    publishModuleVersionRecord.mockResolvedValue({
      id: "module-version-3",
      moduleId: "module-1",
      versionNo: 3,
      publishedAt: new Date("2026-03-11T12:30:00.000Z"),
      publishedBy: "admin-1",
    });

    const { publishModuleVersion } = await import("../../src/services/adminContentService.js");

    const result = await publishModuleVersion("module-1", "module-version-3", "admin-1");

    expect(publishModuleVersionRecord).toHaveBeenCalledWith(
      "module-1",
      "module-version-3",
      "admin-1",
      expect.any(Date),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith({
      entityType: "module_version",
      entityId: "module-version-3",
      action: "module_version_published",
      actorId: "admin-1",
      metadata: {
        moduleId: "module-1",
        moduleVersionId: "module-version-3",
        versionNo: 3,
        previousActiveVersionId: "module-version-2",
        publishedAt: "2026-03-11T12:30:00.000Z",
      },
    });
    expect(result).toEqual({
      id: "module-version-3",
      moduleId: "module-1",
      versionNo: 3,
      publishedAt: new Date("2026-03-11T12:30:00.000Z"),
      publishedBy: "admin-1",
    });
  });
});
