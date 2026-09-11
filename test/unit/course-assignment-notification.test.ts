import { describe, expect, it } from "vitest";
import { sendCourseAssignmentNotification } from "../../src/modules/certification/participantNotificationService.js";

// #684/#688: class course-assignment email. In the default "log" channel (dev/test) it does not send
// a real email — it returns a delivered result with the built subject/body. The email contains NO
// link (company policy: no links in email); it asks the participant to log in themselves.

describe("sendCourseAssignmentNotification (#684/#688)", () => {
  it("builds a subject + body with the course title, class name and due date", async () => {
    const result = await sendCourseAssignmentNotification({
      recipientEmail: "kari@example.test",
      recipientName: "Kari",
      courseTitle: "Arbeidsmiljø",
      className: "Onboarding 2026",
      dueAt: new Date("2026-09-01T00:00:00.000Z"),
      locale: "nb",
    });

    expect(result.delivered).toBe(true);
    expect(result.channel).toBe("log");
    expect(result.subject).toContain("Arbeidsmiljø");
    expect(result.nextStepGuidance).toContain("Onboarding 2026");
    expect(result.nextStepGuidance).toContain("Arbeidsmiljø");
    expect(result.nextStepGuidance).toContain("1. september 2026"); // #970: datoen på mottakerens språk
  });

  it("contains NO link — asks the participant to log in (company policy, #688)", async () => {
    const result = await sendCourseAssignmentNotification({
      recipientEmail: "ola@example.test",
      courseTitle: "Brannvern",
      className: "Kull B",
      dueAt: null,
      locale: "nb",
    });

    expect(result.delivered).toBe(true);
    expect(result.nextStepGuidance).toContain("Logg inn");
    expect(result.nextStepGuidance).not.toContain("http");
  });

  // #970: var den eneste e-posten uten språkparameter — hardkodet bokmål til alle.
  it("⚠️ #970: skrives på mottakerens språk — engelsk og nynorsk, ikke bare bokmål", async () => {
    const en = await sendCourseAssignmentNotification({
      recipientEmail: "ann@example.test", courseTitle: "Fire safety", className: "Cohort B",
      dueAt: new Date("2026-09-01T00:00:00.000Z"), locale: "en-GB",
    });
    expect(en.subject).toBe("New course assigned: Fire safety");
    expect(en.nextStepGuidance).toContain("Cohort B");
    expect(en.nextStepGuidance).toContain("1 September 2026");
    expect(en.nextStepGuidance).not.toContain("Logg inn");

    const nn = await sendCourseAssignmentNotification({
      recipientEmail: "ola@example.test", courseTitle: "Brannvern", className: "Kull B", dueAt: null, locale: "nn",
    });
    expect(nn.nextStepGuidance).toContain("plattforma");
  });
});
