import { beforeEach, describe, expect, it, vi } from "vitest";

const findModuleSummary = vi.fn();
const findModuleDeleteSummary = vi.fn();
const createModuleRecord = vi.fn();
const findModuleContentBundle = vi.fn();
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
const deleteModuleRecord = vi.fn();
const recordAuditEvent = vi.fn();

vi.mock("../../src/modules/adminContent/adminContentRepository.js", () => ({
  adminContentRepository: {
    findModuleSummary,
    findModuleDeleteSummary,
    createModule: createModuleRecord,
    findModuleContentBundle,
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
    deleteModule: deleteModuleRecord,
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
    findModuleDeleteSummary.mockReset();
    createModuleRecord.mockReset();
    findModuleContentBundle.mockReset();
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
    deleteModuleRecord.mockReset();
    recordAuditEvent.mockReset();
  });

  it("rejects module creation when validTo is before validFrom", async () => {
    const { createModule } = await import("../../src/modules/adminContent/index.js");

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

    const { createModule } = await import("../../src/modules/adminContent/index.js");

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

  it("exports module content with decoded localized values and selected active configuration", async () => {
    findModuleContentBundle.mockResolvedValue({
      id: "module-1",
      title: "{\"en-GB\":\"Module One\",\"nb\":\"Modul En\",\"nn\":\"Modul Ein\"}",
      description: "Description",
      certificationLevel: "foundation",
      validFrom: null,
      validTo: null,
      activeVersionId: "module-version-2",
      createdAt: new Date("2026-03-10T00:00:00.000Z"),
      updatedAt: new Date("2026-03-11T00:00:00.000Z"),
      versions: [
        {
          id: "module-version-2",
          versionNo: 2,
          taskText: "{\"en-GB\":\"Task\",\"nb\":\"Oppgave\",\"nn\":\"Oppgaave\"}",
          guidanceText: "Guidance",
          rubricVersionId: "rubric-2",
          promptTemplateVersionId: "prompt-2",
          mcqSetVersionId: "mcq-2",
          publishedBy: "admin-1",
          publishedAt: new Date("2026-03-11T08:00:00.000Z"),
          createdAt: new Date("2026-03-11T07:00:00.000Z"),
          updatedAt: new Date("2026-03-11T07:30:00.000Z"),
        },
      ],
      rubricVersions: [
        {
          id: "rubric-2",
          versionNo: 2,
          criteriaJson: "{\"criterion\":1}",
          scalingRuleJson: "{\"practical_weight\":70}",
          passRuleJson: "{\"total_min\":70}",
          active: true,
          createdAt: new Date("2026-03-10T01:00:00.000Z"),
          updatedAt: new Date("2026-03-10T01:00:00.000Z"),
        },
      ],
      promptTemplateVersions: [
        {
          id: "prompt-2",
          versionNo: 2,
          systemPrompt: "{\"en-GB\":\"System\",\"nb\":\"System nb\",\"nn\":\"System nn\"}",
          userPromptTemplate: "Template",
          examplesJson: "[{\"example\":\"Anchor\"}]",
          active: true,
          createdAt: new Date("2026-03-10T02:00:00.000Z"),
          updatedAt: new Date("2026-03-10T02:00:00.000Z"),
        },
      ],
      mcqSetVersions: [
        {
          id: "mcq-2",
          versionNo: 2,
          title: "{\"en-GB\":\"Quiz\",\"nb\":\"Quiz nb\",\"nn\":\"Quiz nn\"}",
          active: true,
          createdAt: new Date("2026-03-10T03:00:00.000Z"),
          updatedAt: new Date("2026-03-10T03:00:00.000Z"),
          questions: [
            {
              id: "question-1",
              stem: "{\"en-GB\":\"Question?\",\"nb\":\"Sporsmaal?\",\"nn\":\"Sporsmaal?\"}",
              optionsJson:
                "[\"{\\\"en-GB\\\":\\\"Yes\\\",\\\"nb\\\":\\\"Ja\\\",\\\"nn\\\":\\\"Ja\\\"}\",\"No\"]",
              correctAnswer: "{\"en-GB\":\"Yes\",\"nb\":\"Ja\",\"nn\":\"Ja\"}",
              rationale: "Because",
              active: true,
              createdAt: new Date("2026-03-10T04:00:00.000Z"),
              updatedAt: new Date("2026-03-10T04:00:00.000Z"),
            },
          ],
        },
      ],
    });

    const { getModuleContentBundle } = await import("../../src/modules/adminContent/index.js");

    const result = await getModuleContentBundle("module-1");

    expect(result.module.title).toEqual({
      "en-GB": "Module One",
      nb: "Modul En",
      nn: "Modul Ein",
    });
    expect(result.selectedConfiguration.source).toBe("activeModuleVersion");
    expect(result.selectedConfiguration.moduleVersion?.id).toBe("module-version-2");
    expect(result.selectedConfiguration.rubricVersion?.criteria).toEqual({ criterion: 1 });
    expect(result.selectedConfiguration.promptTemplateVersion?.examples).toEqual([{ example: "Anchor" }]);
    expect(result.selectedConfiguration.mcqSetVersion?.questions[0]?.options).toEqual([
      { "en-GB": "Yes", nb: "Ja", nn: "Ja" },
      "No",
    ]);
  });

  it("selects the latest (highest versionNo) module version as selectedConfiguration, not the active published one", async () => {
    findModuleContentBundle.mockResolvedValue({
      id: "module-1",
      title: "Module One",
      description: null,
      certificationLevel: "foundation",
      validFrom: null,
      validTo: null,
      activeVersionId: "version-1",
      createdAt: new Date("2026-03-10T00:00:00.000Z"),
      updatedAt: new Date("2026-03-11T00:00:00.000Z"),
      versions: [
        {
          id: "version-2",
          versionNo: 2,
          taskText: "Task v2",
          guidanceText: "Guide v2",
          rubricVersionId: "rubric-2",
          promptTemplateVersionId: null,
          mcqSetVersionId: null,
          publishedBy: null,
          publishedAt: null,
          createdAt: new Date("2026-03-11T08:00:00.000Z"),
          updatedAt: new Date("2026-03-11T08:00:00.000Z"),
        },
        {
          id: "version-1",
          versionNo: 1,
          taskText: "Task v1",
          guidanceText: "Guide v1",
          rubricVersionId: "rubric-1",
          promptTemplateVersionId: null,
          mcqSetVersionId: null,
          publishedBy: "admin-1",
          publishedAt: new Date("2026-03-10T08:00:00.000Z"),
          createdAt: new Date("2026-03-10T07:00:00.000Z"),
          updatedAt: new Date("2026-03-10T07:30:00.000Z"),
        },
      ],
      rubricVersions: [
        {
          id: "rubric-2",
          versionNo: 2,
          criteriaJson: "{\"criterion\":2}",
          scalingRuleJson: "{}",
          passRuleJson: "{}",
          active: false,
          createdAt: new Date("2026-03-11T00:00:00.000Z"),
          updatedAt: new Date("2026-03-11T00:00:00.000Z"),
        },
        {
          id: "rubric-1",
          versionNo: 1,
          criteriaJson: "{\"criterion\":1}",
          scalingRuleJson: "{}",
          passRuleJson: "{}",
          active: true,
          createdAt: new Date("2026-03-10T00:00:00.000Z"),
          updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        },
      ],
      promptTemplateVersions: [],
      mcqSetVersions: [],
    });

    const { getModuleContentBundle } = await import("../../src/modules/adminContent/index.js");

    const result = await getModuleContentBundle("module-1");

    // The latest draft (version-2, versionNo=2) must be selected, not the active
    // published version (version-1, versionNo=1).
    expect(result.selectedConfiguration.moduleVersion?.id).toBe("version-2");
    expect(result.selectedConfiguration.source).toBe("latestModuleVersion");
    expect(result.selectedConfiguration.rubricVersion?.id).toBe("rubric-2");
  });

  it("deletes an empty module and records module_deleted audit metadata", async () => {
    findModuleDeleteSummary.mockResolvedValue({
      id: "module-1",
      title: "Module One",
      activeVersionId: null,
      _count: {
        versions: 0,
        submissions: 0,
        mcqSetVersions: 0,
        certificationStatuses: 0,
        rubricVersions: 0,
        promptTemplateVersions: 0,
      },
    });
    deleteModuleRecord.mockResolvedValue({
      id: "module-1",
      title: "Module One",
    });

    const { deleteModule } = await import("../../src/modules/adminContent/index.js");

    const result = await deleteModule("module-1", "admin-1");

    expect(deleteModuleRecord).toHaveBeenCalledWith("module-1");
    expect(recordAuditEvent).toHaveBeenCalledWith({
      entityType: "module",
      entityId: "module-1",
      action: "module_deleted",
      actorId: "admin-1",
      metadata: {
        moduleId: "module-1",
        title: "Module One",
      },
    });
    expect(result).toEqual({
      id: "module-1",
      title: "Module One",
    });
  });

  it("blocks module deletion when the module has dependencies", async () => {
    findModuleDeleteSummary.mockResolvedValue({
      id: "module-1",
      title: "Module One",
      activeVersionId: "module-version-1",
      _count: {
        versions: 1,
        submissions: 0,
        mcqSetVersions: 1,
        certificationStatuses: 0,
        rubricVersions: 1,
        promptTemplateVersions: 1,
      },
    });

    const { deleteModule } = await import("../../src/modules/adminContent/index.js");

    await expect(deleteModule("module-1", "admin-1")).rejects.toThrow(
      "Module cannot be deleted because it still has dependencies:",
    );

    expect(deleteModuleRecord).not.toHaveBeenCalled();
  });

  it("rejects module-version creation when a dependency belongs to another module", async () => {
    findModuleSummary.mockResolvedValue({ id: "module-1", activeVersionId: null });
    findLatestModuleVersion.mockResolvedValue({ versionNo: 2 });
    findVersionDependencies.mockResolvedValue([
      { id: "rubric-1", moduleId: "module-1" },
      { id: "prompt-1", moduleId: "module-2" },
      { id: "mcq-1", moduleId: "module-1" },
    ]);

    const { createModuleVersion } = await import("../../src/modules/adminContent/index.js");

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

    const { createBenchmarkExampleVersion } = await import("../../src/modules/adminContent/index.js");

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

    const { publishModuleVersion } = await import("../../src/modules/adminContent/index.js");

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
