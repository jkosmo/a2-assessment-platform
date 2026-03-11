import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubmissionStatus } from "../../src/db/prismaRuntime.js";
import { ValidationError } from "../../src/errors/AppError.js";

const getModuleWithActiveVersion = vi.fn();
const submissionCreate = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();
const resolveSubmissionRawTextFromAttachment = vi.fn();

vi.mock("../../src/repositories/moduleRepository.js", () => ({
  getModuleWithActiveVersion,
}));

vi.mock("../../src/repositories/submissionRepository.js", () => ({
  submissionRepository: {
    create: submissionCreate,
  },
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

vi.mock("../../src/services/documentParsingService.js", () => ({
  resolveSubmissionRawTextFromAttachment,
}));

describe("submission service", () => {
  beforeEach(() => {
    getModuleWithActiveVersion.mockReset();
    submissionCreate.mockReset();
    recordAuditEvent.mockReset();
    logOperationalEvent.mockReset();
    resolveSubmissionRawTextFromAttachment.mockReset();
  });

  it("rejects submission creation when no published active module version exists", async () => {
    getModuleWithActiveVersion.mockResolvedValue({
      id: "module-1",
      activeVersion: null,
    });

    const { createSubmission } = await import("../../src/services/submissionService.js");

    await expect(
      createSubmission({
        userId: "user-1",
        moduleId: "module-1",
        locale: "nb",
        deliveryType: "text",
        rawText: "raw text",
        reflectionText: "reflection",
        promptExcerpt: "prompt",
        responsibilityAcknowledged: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(resolveSubmissionRawTextFromAttachment).not.toHaveBeenCalled();
    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it("creates a submission from parsed attachment text and records audit plus operational logging", async () => {
    getModuleWithActiveVersion.mockResolvedValue({
      id: "module-1",
      activeVersion: {
        id: "module-version-1",
        publishedAt: new Date("2026-03-11T10:00:00.000Z"),
      },
    });
    resolveSubmissionRawTextFromAttachment.mockResolvedValue({
      resolvedRawText: "parsed document text",
      parser: "pdf",
    });
    submissionCreate.mockResolvedValue({
      id: "submission-1",
      moduleId: "module-1",
      moduleVersionId: "module-version-1",
      deliveryType: "document",
    });

    const { createSubmission } = await import("../../src/services/submissionService.js");

    const result = await createSubmission({
      userId: "user-1",
      moduleId: "module-1",
      locale: "nn",
      deliveryType: "document",
      rawText: undefined,
      reflectionText: "reflection",
      promptExcerpt: "prompt excerpt",
      responsibilityAcknowledged: true,
      attachmentUri: "https://storage.example/submission.pdf",
      attachmentBase64: "JVBERi0xLjc=",
      attachmentFilename: "submission.pdf",
      attachmentMimeType: "application/pdf",
    });

    expect(resolveSubmissionRawTextFromAttachment).toHaveBeenCalledWith({
      rawText: undefined,
      attachmentBase64: "JVBERi0xLjc=",
      attachmentFilename: "submission.pdf",
      attachmentMimeType: "application/pdf",
    });
    expect(submissionCreate).toHaveBeenCalledWith({
      userId: "user-1",
      moduleId: "module-1",
      moduleVersionId: "module-version-1",
      locale: "nn",
      deliveryType: "document",
      rawText: "parsed document text",
      reflectionText: "reflection",
      promptExcerpt: "prompt excerpt",
      responsibilityAcknowledged: true,
      attachmentUri: "https://storage.example/submission.pdf",
      submissionStatus: SubmissionStatus.SUBMITTED,
    });
    expect(recordAuditEvent).toHaveBeenCalledWith({
      entityType: "submission",
      entityId: "submission-1",
      action: "submission_created",
      actorId: "user-1",
      metadata: {
        submissionId: "submission-1",
        moduleId: "module-1",
        moduleVersionId: "module-version-1",
        parser: "pdf",
      },
    });
    expect(logOperationalEvent).toHaveBeenCalledWith("submission_document_parse", {
      submissionId: "submission-1",
      moduleId: "module-1",
      deliveryType: "document",
      parser: "pdf",
    });
    expect(result).toEqual({
      id: "submission-1",
      moduleId: "module-1",
      moduleVersionId: "module-version-1",
      deliveryType: "document",
    });
  });
});
