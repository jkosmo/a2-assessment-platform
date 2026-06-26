import { describe, expect, it } from "vitest";
import { sendCourseAssignmentNotification } from "../../src/modules/certification/participantNotificationService.js";

// #684: class course-assignment email. In the default "log" channel (dev/test) it does not send a
// real email — it returns a delivered result with the built subject/body. These tests pin the copy
// and the link behaviour without touching ACS.

describe("sendCourseAssignmentNotification (#684)", () => {
  it("builds a subject + body with the course title, class name, due date and link", async () => {
    const result = await sendCourseAssignmentNotification({
      recipientEmail: "kari@example.test",
      recipientName: "Kari",
      courseTitle: "Arbeidsmiljø",
      className: "Onboarding 2026",
      dueAt: new Date("2026-09-01T00:00:00.000Z"),
      courseUrl: "https://app.example.test/participant",
    });

    expect(result.delivered).toBe(true);
    expect(result.channel).toBe("log");
    expect(result.subject).toContain("Arbeidsmiljø");
    expect(result.nextStepGuidance).toContain("Onboarding 2026");
    expect(result.nextStepGuidance).toContain("Arbeidsmiljø");
    expect(result.nextStepGuidance).toContain("2026-09-01");
    expect(result.nextStepGuidance).toContain("https://app.example.test/participant");
  });

  it("falls back to a login prompt when no course URL is configured", async () => {
    const result = await sendCourseAssignmentNotification({
      recipientEmail: "ola@example.test",
      courseTitle: "Brannvern",
      className: "Kull B",
      dueAt: null,
      courseUrl: null,
    });

    expect(result.delivered).toBe(true);
    expect(result.nextStepGuidance).toContain("Logg inn");
    expect(result.nextStepGuidance).not.toContain("http");
  });
});
