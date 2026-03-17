import { AppealStatus } from "../src/db/prismaRuntime.js";
import { env } from "../src/config/env.js";
import {
  getAppealNotificationMessage,
  getAssessmentResultNotificationMessage,
} from "../src/i18n/notificationMessages.js";
import {
  notifyAssessmentResult,
  sendAppealStatusNotification,
} from "../src/services/participantNotificationService.js";

describe("participant notification service", () => {
  const originalChannel = env.PARTICIPANT_NOTIFICATION_CHANNEL;
  const originalWebhookUrl = env.PARTICIPANT_NOTIFICATION_WEBHOOK_URL;
  const originalTimeout = env.PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS;
  const originalFetch = global.fetch;

  afterEach(() => {
    env.PARTICIPANT_NOTIFICATION_CHANNEL = originalChannel;
    env.PARTICIPANT_NOTIFICATION_WEBHOOK_URL = originalWebhookUrl;
    env.PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS = originalTimeout;
    global.fetch = originalFetch;
  });

  it("returns localized templates for supported locales", () => {
    const nbMessage = getAppealNotificationMessage("nb", AppealStatus.RESOLVED);
    const nnMessage = getAppealNotificationMessage("nn", AppealStatus.IN_REVIEW);
    expect(nbMessage.subject).toContain("ferdigbehandlet");
    expect(nnMessage.nextStepGuidance).toContain("ankebehandlar");
  });

  it("delivers notification in log mode", async () => {
    env.PARTICIPANT_NOTIFICATION_CHANNEL = "log";

    const result = await sendAppealStatusNotification({
      appealId: "appeal-test-1",
      submissionId: "submission-test-1",
      previousStatus: AppealStatus.OPEN,
      currentStatus: AppealStatus.IN_REVIEW,
      recipientUserId: "user-1",
      recipientEmail: "user1@company.com",
      recipientName: "User One",
      locale: "en-GB",
    });

    expect(result.delivered).toBe(true);
    expect(result.channel).toBe("log");
    expect(result.subject.length).toBeGreaterThan(3);
  });

  it("sends webhook payload in webhook mode", async () => {
    env.PARTICIPANT_NOTIFICATION_CHANNEL = "webhook";
    env.PARTICIPANT_NOTIFICATION_WEBHOOK_URL = "https://example.test/notify";
    env.PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS = 1000;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendAppealStatusNotification({
      appealId: "appeal-test-2",
      submissionId: "submission-test-2",
      previousStatus: AppealStatus.IN_REVIEW,
      currentStatus: AppealStatus.RESOLVED,
      recipientUserId: "user-2",
      recipientEmail: "user2@company.com",
      recipientName: "User Two",
      locale: "nb",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.delivered).toBe(true);
    expect(result.channel).toBe("webhook");
  });

  it("returns failed result when webhook responds with non-2xx", async () => {
    env.PARTICIPANT_NOTIFICATION_CHANNEL = "webhook";
    env.PARTICIPANT_NOTIFICATION_WEBHOOK_URL = "https://example.test/notify";
    env.PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS = 1000;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendAppealStatusNotification({
      appealId: "appeal-test-3",
      submissionId: "submission-test-3",
      previousStatus: AppealStatus.OPEN,
      currentStatus: AppealStatus.REJECTED,
      recipientUserId: "user-3",
      recipientEmail: "user3@company.com",
      recipientName: "User Three",
      locale: "nn",
    });

    expect(result.delivered).toBe(false);
    expect(result.channel).toBe("webhook");
    expect(result.failureReason).toBe("webhook_non_2xx_500");
  });
});

describe("assessment result notification messages", () => {
  it("returns localized pass message for all supported locales", () => {
    const enMsg = getAssessmentResultNotificationMessage("en-GB", "pass");
    const nbMsg = getAssessmentResultNotificationMessage("nb", "pass");
    const nnMsg = getAssessmentResultNotificationMessage("nn", "pass");

    expect(enMsg.subject.length).toBeGreaterThan(3);
    expect(nbMsg.subject.length).toBeGreaterThan(3);
    expect(nnMsg.subject.length).toBeGreaterThan(3);
    expect(enMsg.nextStepGuidance.length).toBeGreaterThan(3);
  });

  it("returns localized fail message for all supported locales", () => {
    const enMsg = getAssessmentResultNotificationMessage("en-GB", "fail");
    const nbMsg = getAssessmentResultNotificationMessage("nb", "fail");
    const nnMsg = getAssessmentResultNotificationMessage("nn", "fail");

    expect(enMsg.subject).not.toBe(getAssessmentResultNotificationMessage("en-GB", "pass").subject);
    expect(nbMsg.subject.length).toBeGreaterThan(3);
    expect(nnMsg.nextStepGuidance.length).toBeGreaterThan(3);
  });

  it("returns localized under_review message for all supported locales", () => {
    const enMsg = getAssessmentResultNotificationMessage("en-GB", "under_review");
    const nbMsg = getAssessmentResultNotificationMessage("nb", "under_review");
    const nnMsg = getAssessmentResultNotificationMessage("nn", "under_review");

    expect(enMsg.subject.length).toBeGreaterThan(3);
    expect(nbMsg.nextStepGuidance.length).toBeGreaterThan(3);
    expect(nnMsg.subject.length).toBeGreaterThan(3);
  });
});

describe("notifyAssessmentResult", () => {
  const originalChannel = env.PARTICIPANT_NOTIFICATION_CHANNEL;

  afterEach(() => {
    env.PARTICIPANT_NOTIFICATION_CHANNEL = originalChannel;
  });

  it("returns without side effects when channel is disabled", async () => {
    env.PARTICIPANT_NOTIFICATION_CHANNEL = "disabled";

    await expect(
      notifyAssessmentResult({
        submissionId: "sub-1",
        recipientEmail: "user@company.com",
        recipientName: "Test User",
        moduleTitle: "Module One",
        moduleId: "mod-1",
        passFailTotal: true,
        locale: "en-GB",
      }),
    ).resolves.toBeUndefined();
  });
});
