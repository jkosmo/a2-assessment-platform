import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubmissionStatus } from "../../src/db/prismaRuntime.js";
import { ConflictError } from "../../src/errors/AppError.js";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

const getModuleWithActiveVersion = vi.fn();
const submissionCreate = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();
const resolveSubmissionResponseJson = vi.fn();
const supersedeEligibleReviewsForRetake = vi.fn();
const supersedeEligibleAppealsForRetake = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({
  prisma: { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({})) },
}));

// #934 skive 5a-1: låsene er SQL; her går de rett gjennom den falske transaksjonen.
vi.mock("../../src/db/contentLock.js", () => import("../support/contentLockThroughTransaction.js"));

// #1140 etappe 1: ingen kurs har låst en hovedversjon i disse testene, så versjonen er modulens aktive. Regelen selv er
// prøvd i participant-module-version-1140.test.ts og gjennom rutene i m2-participant-module-version-1140.test.ts.
const prepareShownMajorScope = vi.fn();
const findVersionToSubmitOn = vi.fn();
class ShownMajorScopeOutdatedError extends Error {}
vi.mock("../../src/modules/module/participantModuleVersion.js", () => ({
  prepareShownMajorScope,
  findVersionToSubmitOn,
  ShownMajorScopeOutdatedError,
}));

vi.mock("../../src/modules/submission/submissionRepository.js", () => ({
  getModuleWithActiveVersion,
  submissionRepository: { create: submissionCreate },
  createSubmissionRepository: () => ({ create: (_locked: unknown, data: unknown) => submissionCreate(data) }),
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
  supersedeEligibleReviewsForRetake,
}));

vi.mock("../../src/modules/appeal/index.js", () => ({
  supersedeEligibleAppealsForRetake,
}));

// #994: modulgrafen leses her, ikke i første test. Se test/support/moduleGraphWarmup.ts.
warmModuleGraph(() => import("../../src/modules/submission/index.js"));

describe("submission service", () => {
  beforeEach(() => {
    getModuleWithActiveVersion.mockReset();
    submissionCreate.mockReset();
    recordAuditEvent.mockReset().mockResolvedValue(undefined);
    logOperationalEvent.mockReset();
    resolveSubmissionResponseJson.mockReset();
    supersedeEligibleReviewsForRetake.mockReset().mockResolvedValue(0);
    supersedeEligibleAppealsForRetake.mockReset().mockResolvedValue(0);
    prepareShownMajorScope.mockReset().mockResolvedValue(null);
    findVersionToSubmitOn.mockReset().mockImplementation(async (_client: unknown, _moduleId: string, active: unknown) => active);
  });

  // #1140 etappe 1: versjonen deltakeren skal ha, kan være en annen enn modulens aktive.
  it("submits on the version the participant's courses show, not the module's active one", async () => {
    getModuleWithActiveVersion.mockResolvedValue({ id: "module-1", activeVersion: { id: "module-version-2", versionMajor: 2, publishedAt: new Date() } });
    prepareShownMajorScope.mockResolvedValue(["course-1"]);
    findVersionToSubmitOn.mockResolvedValue({ id: "module-version-1", publishedAt: new Date() });
    resolveSubmissionResponseJson.mockResolvedValue({ resolvedResponseJson: {}, parser: "text" });
    submissionCreate.mockResolvedValue({ id: "submission-1", moduleId: "module-1", moduleVersionId: "module-version-1", deliveryType: "text" });
    const { createSubmission } = await import("../../src/modules/submission/index.js");
    const base = { userId: "user-1", roles: [], groupIds: ["g1"], courseId: "course-1", moduleId: "module-1", locale: "nb" as const, deliveryType: "text", responseJson: {} };

    await expect(createSubmission({ ...base, moduleVersionId: "module-version-2" })).rejects.toMatchObject({ code: "module_version_changed" });
    expect(submissionCreate).not.toHaveBeenCalled();

    await createSubmission({ ...base, moduleVersionId: "module-version-1" });
    expect(submissionCreate).toHaveBeenCalledWith(expect.objectContaining({ moduleVersionId: "module-version-1" }));
    // Kurset modulen ble åpnet fra, følger med til regelen.
    expect(prepareShownMajorScope).toHaveBeenCalledWith({ userId: "user-1", roles: [], groupIds: ["g1"] }, "module-1", "course-1");
    // Kursene fra forberedelsen brukes både i forhåndssjekken og under låsene.
    expect(findVersionToSubmitOn.mock.calls.filter((call) => call[3] !== null && (call[3] as string[])[0] === "course-1").length).toBeGreaterThanOrEqual(3);
  });

  it("a lock that appeared after the courses were worked out: 409 module_version_changed, nothing parsed or written", async () => {
    getModuleWithActiveVersion.mockResolvedValue({ id: "module-1", activeVersion: { id: "module-version-1", versionMajor: 1, publishedAt: new Date() } });
    findVersionToSubmitOn.mockRejectedValue(new ShownMajorScopeOutdatedError());
    const { createSubmission } = await import("../../src/modules/submission/index.js");
    await expect(
      createSubmission({ userId: "user-1", roles: [], moduleId: "module-1", moduleVersionId: "module-version-1", locale: "nb", deliveryType: "text", responseJson: {} }),
    ).rejects.toMatchObject({ code: "module_version_changed" });
    expect(resolveSubmissionResponseJson).not.toHaveBeenCalled();
    expect(submissionCreate).not.toHaveBeenCalled();
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
        roles: [],
        moduleId: "module-1",
        locale: "nb",
        deliveryType: "text",
        responseJson: { response: "raw text", reflection: "reflection", promptExcerpt: "prompt" },
      }),
      // #999: ærlig klasse — en tilstandskonflikt (409, egen kode), ikke et skjema som feilet.
    ).rejects.toSatisfy((e: unknown) => e instanceof ConflictError && (e as ConflictError).code === "module_version_unavailable");

    expect(resolveSubmissionResponseJson).not.toHaveBeenCalled();
    expect(submissionCreate).not.toHaveBeenCalled();
  });

  // #934 skive 5a-1: et dokument kan ta tid å tolke. Er versjonen allerede utdatert eller mangler, skjer det ikke.
  it("does not parse the answer when the version is stale or missing", async () => {
    getModuleWithActiveVersion.mockResolvedValue({ id: "module-1", activeVersion: { id: "module-version-2", publishedAt: new Date() } });
    const { createSubmission } = await import("../../src/modules/submission/index.js");
    const base = { userId: "user-1", roles: [], moduleId: "module-1", locale: "nb" as const, deliveryType: "text", responseJson: {} };

    await expect(createSubmission({ ...base, moduleVersionId: "module-version-1" })).rejects.toMatchObject({ code: "module_version_changed" });
    await expect(createSubmission(base)).rejects.toMatchObject({ code: "client_outdated" });

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
      roles: [],
      moduleId: "module-1",
      moduleVersionId: "module-version-1",
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
      processSignalsJson: null,
      attachmentUri: "https://storage.example/submission.pdf",
      submissionStatus: SubmissionStatus.SUBMITTED,
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      {
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
      },
      {},
    );
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
    expect(supersedeEligibleReviewsForRetake).toHaveBeenCalledWith("user-1", "module-1", "submission-1", {});
    expect(supersedeEligibleAppealsForRetake).toHaveBeenCalledWith("user-1", "module-1", "submission-1", {});
  });

  it("does not emit retake_supersede_completed when no prior open items exist", async () => {
    getModuleWithActiveVersion.mockResolvedValue({
      id: "module-1",
      activeVersion: { id: "module-version-1", publishedAt: new Date() },
    });
    resolveSubmissionResponseJson.mockResolvedValue({ resolvedResponseJson: {}, parser: "json" });
    submissionCreate.mockResolvedValue({ id: "submission-1", moduleId: "module-1", moduleVersionId: "module-version-1", deliveryType: "text" });
    supersedeEligibleReviewsForRetake.mockResolvedValue(0);
    supersedeEligibleAppealsForRetake.mockResolvedValue(0);

    const { createSubmission } = await import("../../src/modules/submission/index.js");
    await createSubmission({ userId: "user-1", roles: [], moduleId: "module-1", moduleVersionId: "module-version-1", locale: "nb", deliveryType: "text", responseJson: {} });

    const actions = recordAuditEvent.mock.calls.map((c) => c[0].action);
    expect(actions).not.toContain("retake_supersede_completed");
  });

  it("emits retake_supersede_completed with correct counts when prior items are superseded", async () => {
    getModuleWithActiveVersion.mockResolvedValue({
      id: "module-1",
      activeVersion: { id: "module-version-1", publishedAt: new Date() },
    });
    resolveSubmissionResponseJson.mockResolvedValue({ resolvedResponseJson: {}, parser: "json" });
    submissionCreate.mockResolvedValue({ id: "submission-1", moduleId: "module-1", moduleVersionId: "module-version-1", deliveryType: "text" });
    supersedeEligibleReviewsForRetake.mockResolvedValue(1);
    supersedeEligibleAppealsForRetake.mockResolvedValue(1);

    const { createSubmission } = await import("../../src/modules/submission/index.js");
    await createSubmission({ userId: "user-1", roles: [], moduleId: "module-1", moduleVersionId: "module-version-1", locale: "nb", deliveryType: "text", responseJson: {} });

    expect(recordAuditEvent).toHaveBeenCalledWith(
      {
        entityType: "submission",
        entityId: "submission-1",
        action: "retake_supersede_completed",
        actorId: "user-1",
        metadata: { supersededReviewCount: 1, supersededAppealCount: 1 },
      },
      {},
    );
  });
});
