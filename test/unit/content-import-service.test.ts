// Characterization tests for contentImportService.importModuleFromEnvelope (#599).
//
// These pin the CURRENT behaviour of the assessment-mode branches
// (FREETEXT_ONLY / MCQ_ONLY / FREETEXT_PLUS_MCQ) of importModulePayload, which
// drive importModuleFromEnvelope. The repository + adminContentCommands +
// auditService dependencies are mocked, so NO database is required.
//
// What is pinned (read off the implementation, not assumed):
//   - FREETEXT_ONLY  : rubric + promptTemplate created, NO MCQ set, mcqSetVersionId undefined.
//   - MCQ_ONLY       : MCQ set created, NO rubric/prompt, taskText omitted (undefined).
//   - FREETEXT_PLUS_MCQ: rubric + prompt + MCQ set all created.
//   - replaceExisting requires targetModuleId and an existing module, reuses its id.
//   - autoPublish: source published + autoPublish !== false ⇒ publishModuleVersion called;
//                  autoPublish === false ⇒ not called even if source was published.
//   - the module_imported audit event carries the source audit fields.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportEnvelope } from "../../src/modules/adminContent/adminContentSchemas.js";

const createModule = vi.fn();
const createRubricVersion = vi.fn();
const createPromptTemplateVersion = vi.fn();
const createMcqSetVersion = vi.fn();
const createModuleVersion = vi.fn();
const publishModuleVersion = vi.fn();

const findModuleTitle = vi.fn();
const recordAuditEvent = vi.fn();

vi.mock("../../src/modules/adminContent/adminContentCommands.js", () => ({
  createModule,
  createRubricVersion,
  createPromptTemplateVersion,
  createMcqSetVersion,
  createModuleVersion,
  publishModuleVersion,
}));

vi.mock("../../src/modules/adminContent/adminContentRepository.js", () => ({
  adminContentRepository: { findModuleTitle },
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

// Default stub return values so the SUT can chain .id off the results.
function resetMocks() {
  createModule.mockReset().mockResolvedValue({ id: "new-module-id" });
  createRubricVersion.mockReset().mockResolvedValue({ id: "rubric-id" });
  createPromptTemplateVersion.mockReset().mockResolvedValue({ id: "prompt-id" });
  createMcqSetVersion.mockReset().mockResolvedValue({ id: "mcq-id" });
  createModuleVersion.mockReset().mockResolvedValue({ id: "module-version-id" });
  publishModuleVersion.mockReset().mockResolvedValue(undefined);
  findModuleTitle.mockReset();
  recordAuditEvent.mockReset().mockResolvedValue(undefined);
}

type AssessmentMode = "FREETEXT_ONLY" | "MCQ_ONLY" | "FREETEXT_PLUS_MCQ";

// Build a module envelope whose activeVersion carries every optional block.
// Individual tests vary only the assessmentMode; importModulePayload decides
// which blocks to actually create based on that mode.
function buildModuleEnvelope(
  assessmentMode: AssessmentMode,
  audit: { publishedAt?: string | null; publishedBy?: string | null; sourceVersionNo?: number | null } = {},
): ExportEnvelope {
  return {
    exportFormat: "a2-content-export/v1",
    exportedAt: "2026-06-20T00:00:00.000Z",
    scope: "module",
    module: {
      module: {
        title: "Imported module",
        description: "A description",
        certificationLevel: "foundation",
      },
      activeVersion: {
        assessmentMode,
        taskText: "Do the task",
        assessorExpectedContent: "Expected content",
        candidateTaskConstraints: "Constraints",
        assessmentBlueprint: "blueprint",
        rubric: {
          criteria: { c1: 1 },
          scalingRule: { practical_weight: 70 },
        },
        promptTemplate: {
          systemPrompt: "system",
          userPromptTemplate: "template",
          examples: [],
        },
        mcqSet: {
          title: "Quiz",
          questions: [
            {
              stem: "Q?",
              options: ["A", "B"],
              correctAnswer: "A",
              rationale: "because",
            },
          ],
        },
        audit: {
          publishedAt: audit.publishedAt ?? null,
          publishedBy: audit.publishedBy ?? null,
          sourceVersionNo: audit.sourceVersionNo ?? null,
        },
      },
    },
  } as unknown as ExportEnvelope;
}

describe("contentImportService.importModuleFromEnvelope", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("rejects an envelope that is not a module export", async () => {
    const { importModuleFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    await expect(
      importModuleFromEnvelope(
        { scope: "course", module: undefined } as unknown as ExportEnvelope,
        { actorId: "actor-1", mode: "createNew" },
      ),
    ).rejects.toThrow("Envelope is not a module export.");
  });

  it("FREETEXT_ONLY: creates rubric + prompt but NO MCQ set; mcqSetVersionId is undefined", async () => {
    const { importModuleFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    const result = await importModuleFromEnvelope(buildModuleEnvelope("FREETEXT_ONLY"), {
      actorId: "actor-1",
      mode: "createNew",
    });

    expect(createRubricVersion).toHaveBeenCalledTimes(1);
    expect(createPromptTemplateVersion).toHaveBeenCalledTimes(1);
    expect(createMcqSetVersion).not.toHaveBeenCalled();

    expect(createModuleVersion).toHaveBeenCalledTimes(1);
    const versionArg = createModuleVersion.mock.calls[0][0];
    expect(versionArg.assessmentMode).toBe("FREETEXT_ONLY");
    expect(versionArg.rubricVersionId).toBe("rubric-id");
    expect(versionArg.promptTemplateVersionId).toBe("prompt-id");
    expect(versionArg.mcqSetVersionId).toBeUndefined();
    // FREETEXT keeps taskText.
    expect(versionArg.taskText).toBe("Do the task");

    expect(result).toEqual({ moduleId: "new-module-id", moduleVersionId: "module-version-id" });
  });

  it("MCQ_ONLY: creates MCQ set but NO rubric/prompt; taskText and rubric/prompt ids omitted", async () => {
    const { importModuleFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    await importModuleFromEnvelope(buildModuleEnvelope("MCQ_ONLY"), {
      actorId: "actor-1",
      mode: "createNew",
    });

    expect(createMcqSetVersion).toHaveBeenCalledTimes(1);
    expect(createRubricVersion).not.toHaveBeenCalled();
    expect(createPromptTemplateVersion).not.toHaveBeenCalled();

    const versionArg = createModuleVersion.mock.calls[0][0];
    expect(versionArg.assessmentMode).toBe("MCQ_ONLY");
    expect(versionArg.mcqSetVersionId).toBe("mcq-id");
    expect(versionArg.rubricVersionId).toBeUndefined();
    expect(versionArg.promptTemplateVersionId).toBeUndefined();
    // MCQ_ONLY omits taskText entirely.
    expect(versionArg.taskText).toBeUndefined();

    // The MCQ set questions are serialized through to the command.
    const mcqArg = createMcqSetVersion.mock.calls[0][0];
    expect(mcqArg.questions).toHaveLength(1);
    expect(mcqArg.questions[0].options).toEqual(["A", "B"]);
    expect(mcqArg.questions[0].correctAnswer).toBe("A");
  });

  it("FREETEXT_PLUS_MCQ: creates rubric, prompt AND MCQ set, all wired into the module version", async () => {
    const { importModuleFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    await importModuleFromEnvelope(buildModuleEnvelope("FREETEXT_PLUS_MCQ"), {
      actorId: "actor-1",
      mode: "createNew",
    });

    expect(createRubricVersion).toHaveBeenCalledTimes(1);
    expect(createPromptTemplateVersion).toHaveBeenCalledTimes(1);
    expect(createMcqSetVersion).toHaveBeenCalledTimes(1);

    const versionArg = createModuleVersion.mock.calls[0][0];
    expect(versionArg.assessmentMode).toBe("FREETEXT_PLUS_MCQ");
    expect(versionArg.rubricVersionId).toBe("rubric-id");
    expect(versionArg.promptTemplateVersionId).toBe("prompt-id");
    expect(versionArg.mcqSetVersionId).toBe("mcq-id");
  });

  it("createNew calls createModule with serialized title/description and does not touch findModuleTitle", async () => {
    const { importModuleFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    await importModuleFromEnvelope(buildModuleEnvelope("FREETEXT_PLUS_MCQ"), {
      actorId: "actor-1",
      mode: "createNew",
    });

    expect(createModule).toHaveBeenCalledTimes(1);
    const moduleArg = createModule.mock.calls[0][0];
    expect(moduleArg.title).toBe("Imported module");
    expect(moduleArg.actorId).toBe("actor-1");
    expect(findModuleTitle).not.toHaveBeenCalled();
  });

  it("replaceExisting requires targetModuleId", async () => {
    const { importModuleFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    await expect(
      importModuleFromEnvelope(buildModuleEnvelope("FREETEXT_PLUS_MCQ"), {
        actorId: "actor-1",
        mode: "replaceExisting",
      }),
    ).rejects.toThrow("targetModuleId is required when mode is replaceExisting.");
  });

  it("replaceExisting throws when the target module does not exist", async () => {
    findModuleTitle.mockResolvedValue(null);
    const { importModuleFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    await expect(
      importModuleFromEnvelope(buildModuleEnvelope("FREETEXT_PLUS_MCQ"), {
        actorId: "actor-1",
        mode: "replaceExisting",
        targetModuleId: "existing-1",
      }),
    ).rejects.toThrow("Target module not found for replaceExisting.");
  });

  it("replaceExisting reuses the existing module id and never calls createModule", async () => {
    findModuleTitle.mockResolvedValue({ id: "existing-1", title: "Old" });
    const { importModuleFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    const result = await importModuleFromEnvelope(buildModuleEnvelope("FREETEXT_PLUS_MCQ"), {
      actorId: "actor-1",
      mode: "replaceExisting",
      targetModuleId: "existing-1",
    });

    expect(createModule).not.toHaveBeenCalled();
    expect(findModuleTitle).toHaveBeenCalledWith("existing-1");
    expect(result.moduleId).toBe("existing-1");
    // The rubric/prompt/mcq commands are created against the existing module id.
    expect(createRubricVersion.mock.calls[0][0].moduleId).toBe("existing-1");
  });

  it("auto-publishes when the source was published and autoPublish is not disabled", async () => {
    const { importModuleFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    await importModuleFromEnvelope(
      buildModuleEnvelope("FREETEXT_PLUS_MCQ", { publishedAt: "2026-06-01T00:00:00.000Z" }),
      { actorId: "actor-1", mode: "createNew" },
    );

    expect(publishModuleVersion).toHaveBeenCalledTimes(1);
    expect(publishModuleVersion).toHaveBeenCalledWith(
      "new-module-id",
      "module-version-id",
      "actor-1",
    );
  });

  it("does NOT auto-publish when autoPublish is false even if the source was published", async () => {
    const { importModuleFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    await importModuleFromEnvelope(
      buildModuleEnvelope("FREETEXT_PLUS_MCQ", { publishedAt: "2026-06-01T00:00:00.000Z" }),
      { actorId: "actor-1", mode: "createNew", autoPublish: false },
    );

    expect(publishModuleVersion).not.toHaveBeenCalled();
  });

  it("does NOT auto-publish when the source was never published", async () => {
    const { importModuleFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    await importModuleFromEnvelope(buildModuleEnvelope("FREETEXT_PLUS_MCQ"), {
      actorId: "actor-1",
      mode: "createNew",
    });

    expect(publishModuleVersion).not.toHaveBeenCalled();
  });

  it("records a module_imported audit event carrying the source audit fields", async () => {
    const { importModuleFromEnvelope } = await import(
      "../../src/modules/adminContent/contentImportService.js"
    );

    await importModuleFromEnvelope(
      buildModuleEnvelope("FREETEXT_PLUS_MCQ", {
        publishedAt: "2026-06-01T00:00:00.000Z",
        publishedBy: "source-admin",
        sourceVersionNo: 7,
      }),
      { actorId: "actor-1", mode: "createNew" },
    );

    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent).toHaveBeenCalledWith({
      entityType: "module",
      entityId: "new-module-id",
      action: "module_imported",
      actorId: "actor-1",
      metadata: {
        moduleId: "new-module-id",
        moduleVersionId: "module-version-id",
        mode: "createNew",
        sourcePublishedAt: "2026-06-01T00:00:00.000Z",
        sourcePublishedBy: "source-admin",
        sourceVersionNo: 7,
      },
    });
  });
});
