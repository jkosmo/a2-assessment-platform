import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubmissionStatus } from "../../src/db/prismaRuntime.js";
import { ValidationError } from "../../src/errors/AppError.js";

const getModuleWithActiveVersion = vi.fn();
const submissionCreate = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();
const resolveSubmissionResponseJson = vi.fn();
const cancelSupersededReviews = vi.fn();
const cancelSupersededAppeals = vi.fn();

vi.mock("../../src/repositories/moduleRepository.js", () => ({
  getModuleWithActiveVersion,
}));

vi.mock("../../src/modules/submission/submissionRepository.js", () => ({
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

vi.mock("../../src/modules/assessment/documentParsingService.js", () => ({
  resolveSubmissionResponseJson,
}));

vi.mock("../../src/modules/review/index.js", () => ({
  cancelSupersededReviews,
}));

vi.mock("../../src/modules/appeal/index.js", () => ({
  cancelSupersededAppeals,
}));

describe("submission service", () => {
  beforeEach(() => {
    getModuleWithActiveVersion.mockReset();
    submissionCreate.mockReset();
    recordAuditEvent.mockReset();
    logOperationalEvent.mockReset();
    resolveSubmissionResponseJson.mockReset();
    cancelSupersededReviews.mockReset().mockResolvedValue(0);
    cancelSupersededAppeals.mockReset().mockResolvedValue(0);
  });

  it("rejects submission creation when no published active module version exists", async () => {
    getModuleWithActiveVersion.mockResolvedValue({
      id: "module-1",
      activeVersion: null,
    });

    const { createSubmission } = await import("../../src/modules/submission/index.js");

    await expect(
      createSubmission({
        userId: "user-1",
        moduleId: "module-1",
        locale: "nb",
        deliveryType: "text",
        responseJson: { response: "raw text", reflection: "reflection", promptExcerpt: "prompt" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(resolveSubmissionResponseJson).not.toHaveBeenCalled();
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
    resolveSubmissionResponseJson.mockResolvedValue({
      resolvedResponseJson: { response: "parsed document text" },
      parser: "pdf",
    });
    submissionCreate.mockResolvedValue({
      id: "submission-1",
      moduleId: "module-1",
      moduleVersionId: "module-version-1",
      deliveryType: "document",
    });

    const { createSubmission } = await import("../../src/modules/submission/index.js");

    const result = await createSubmission({
      userId: "user-1",
      moduleId: "module-1",
      locale: "nn",
      deliveryType: "document",
      responseJson: {},
      attachmentUri: "https://storage.example/submission.pdf",
      attachmentBase64: "JVBERi0xLjc=",
      attachmentFilename: "submission.pdf",
      attachmentMimeType: "application/pdf",
    });

    expect(resolveSubmissionResponseJson).toHaveBeenCalledWith({
      responseJson: {},
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
      responseJson: JSON.stringify({ response: "parsed document text" }),
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
    expect(cancelSupersededReviews).toHaveBeenCalledWith("user-1", "module-1", "submission-1");
    expect(cancelSupersededAppeals).toHaveBeenCalledWith("user-1", "module-1", "submission-1");
  });
});
