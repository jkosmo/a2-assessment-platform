import { beforeEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

// #795-followup: a hung delivery must not wedge the worker — processNextOutboxEvent bounds each delivery
// with OUTBOX_DELIVERY_TIMEOUT_MS. #1115: what happens then depends on the event. A course completion
// check is safe to run again and is retried; a notification to a person is not, because the abandoned
// send keeps running and may still go through — a retry could send the email twice.

const findFirst = vi.fn();
const updateMany = vi.fn();
const notifyAssessmentResult = vi.fn();
const notifyAppealStatusTransition = vi.fn();
const sendModuleRevisedNotification = vi.fn();
const checkAndIssueCourseCompletions = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({
  prisma: { outboxEvent: { findFirst, updateMany } },
}));
vi.mock("../../src/modules/certification/index.js", () => ({ notifyAssessmentResult, notifyAppealStatusTransition, sendModuleRevisedNotification }));
vi.mock("../../src/modules/course/index.js", () => ({ checkAndIssueCourseCompletions }));

// #994: modulgrafen leses her, ikke i første test. Se test/support/moduleGraphWarmup.ts.
warmModuleGraph(() => import("../../src/modules/outbox/outboxService.js"));

const resultatRad = (type = "assessment_notification") => ({
  id: "evt-1",
  type,
  payloadJson: JSON.stringify(type === "course_completion_check"
    ? { userId: "u1", moduleId: "m1" }
    : { submissionId: "s1", submittedAt: new Date().toISOString(), recipientEmail: "a@b.test", recipientName: "A", moduleTitle: "M", moduleId: "m1", passFailTotal: true, locale: "en-GB" }),
  attempts: 0,
  maxAttempts: 5,
  availableAt: new Date(Date.now() - 1000),
});
/** The terminal write the outbox made for the row: delivered, or retry/failed. */
const sisteSkriving = () => updateMany.mock.calls.at(-1)?.[0]?.data;

beforeEach(() => {
  vi.resetModules();
  findFirst.mockReset();
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  notifyAssessmentResult.mockReset();
  notifyAppealStatusTransition.mockReset();
  sendModuleRevisedNotification.mockReset();
  checkAndIssueCourseCompletions.mockReset();
  process.env.OUTBOX_DELIVERY_TIMEOUT_MS = "30"; // 30ms deadline for the test
});

async function behandle() {
  const { processNextOutboxEvent } = await import("../../src/modules/outbox/outboxService.js");
  expect(await processNextOutboxEvent("worker-1", 60_000)).toBe(true);
  return sisteSkriving();
}

describe("outbox delivery timeout (#795-followup, #1115)", () => {
  it("a course completion check that hangs is retried — running it again is safe", async () => {
    findFirst.mockResolvedValue(resultatRad("course_completion_check"));
    checkAndIssueCourseCompletions.mockReturnValue(new Promise(() => {}));
    const data = await behandle();
    expect(data.status).toBe("pending");
    expect(data.attempts).toBe(1);
    expect(data.lastError).toMatch(/exceeded/);
  });

  it("#1115: a notification that hangs is marked failed at once — not sent again, it may have gone through", async () => {
    findFirst.mockResolvedValue(resultatRad());
    notifyAssessmentResult.mockReturnValue(new Promise(() => {}));
    const data = await behandle();
    expect(data.status).toBe("failed");
    expect(data.attempts).toBe(5);
    expect(data.lastError).toMatch(/exceeded/);
  });
});

// #1115: før ble hvert forsøk merket levert, også når ACS avviste e-posten.
describe("#1115 — utboksen ser svaret fra sendingen", () => {
  const svar = (delivered: boolean, ekstra: Record<string, unknown> = {}) => ({ delivered, channel: "acs_email", subject: "S", nextStepGuidance: "B", ...ekstra });

  it("levert: raden merkes levert", async () => {
    findFirst.mockResolvedValue(resultatRad());
    notifyAssessmentResult.mockResolvedValue(svar(true));
    expect((await behandle()).status).toBe("delivered");
  });

  it("ingenting å sende (kanalen er av eller logg): raden merkes levert", async () => {
    findFirst.mockResolvedValue(resultatRad());
    notifyAssessmentResult.mockResolvedValue(null);
    expect((await behandle()).status).toBe("delivered");
  });

  it("sikkert feilet (ACS avviste): raden prøves igjen, med grunnen", async () => {
    findFirst.mockResolvedValue(resultatRad());
    notifyAssessmentResult.mockResolvedValue(svar(false, { failureReason: "400 InvalidRecipient: bad address" }));
    const data = await behandle();
    expect(data.status).toBe("pending");
    expect(data.attempts).toBe(1);
    expect(data.lastError).toContain("InvalidRecipient");
  });

  it("avbrutt underveis (vårt tidsavbrudd): merkes feilet med en gang, og sendes ikke igjen", async () => {
    findFirst.mockResolvedValue(resultatRad());
    notifyAssessmentResult.mockResolvedValue(svar(false, { failureReason: "External call 'acs_email_send' exceeded its 30000ms deadline", ambiguous: true }));
    const data = await behandle();
    expect(data.status).toBe("failed");
    expect(data.attempts).toBe(5);
    expect(data.lastError).toContain("may have gone through");
  });

  it("ankevarsel og «modulen er revidert» følger samme regel", async () => {
    const { deliverOutboxEvent, OUTBOX_EVENT_TYPES } = await import("../../src/modules/outbox/outboxService.js");
    notifyAppealStatusTransition.mockResolvedValue(svar(false, { failureReason: "webhook_non_2xx_500" }));
    await expect(deliverOutboxEvent({ type: OUTBOX_EVENT_TYPES.appealNotification, payloadJson: "{}" })).rejects.toThrow("webhook_non_2xx_500");
    sendModuleRevisedNotification.mockResolvedValue(svar(false, { failureReason: "429 TooManyRequests" }));
    await expect(deliverOutboxEvent({ type: OUTBOX_EVENT_TYPES.moduleRevisedNotification, payloadJson: JSON.stringify({ moduleId: "m1" }) })).rejects.toThrow("429");
    // En kanal som er slått av, sender ingenting — det er ikke en feil.
    sendModuleRevisedNotification.mockResolvedValue(svar(false, { channel: "disabled", failureReason: "channel_disabled" }));
    await expect(deliverOutboxEvent({ type: OUTBOX_EVENT_TYPES.moduleRevisedNotification, payloadJson: JSON.stringify({ moduleId: "m1" }) })).resolves.toBeUndefined();
  });
});

// #1007: ankevarsler er en egen radtype. Leveringen må kjenne den — ellers ligger raden og feiler
// «Unknown outbox event type» til maxAttempts, og deltakeren får aldri varselet.
describe("#1007 — appeal_notification leveres fra raden", () => {
  it("⚠️ deliverOutboxEvent dispatcher til notifyAppealStatusTransition med hele nyttelasten", async () => {
    notifyAppealStatusTransition.mockResolvedValue({ delivered: true, channel: "acs_email", subject: "S", nextStepGuidance: "B" });
    const { deliverOutboxEvent, OUTBOX_EVENT_TYPES } = await import("../../src/modules/outbox/outboxService.js");
    const payload = {
      appealId: "a1", submissionId: "s1", previousStatus: "OPEN", currentStatus: "IN_REVIEW",
      recipientUserId: "u1", recipientEmail: "u1@x.test", recipientName: "U", moduleTitle: "M", locale: "nb",
    };
    await deliverOutboxEvent({ type: OUTBOX_EVENT_TYPES.appealNotification, payloadJson: JSON.stringify(payload) });
    expect(notifyAppealStatusTransition).toHaveBeenCalledTimes(1);
    expect(notifyAppealStatusTransition).toHaveBeenCalledWith(payload);
  });
});
