import { describe, expect, it } from "vitest";
import { getCourseReminderNotificationMessage } from "../../src/i18n/notificationMessages.js";
import type { SupportedLocale } from "../../src/i18n/locale.js";

// #497 — course reminder email copy. Must render in nb/nn/en-GB and, per #688, contain NO links
// (participants are asked to log in themselves).

const LOCALES: SupportedLocale[] = ["nb", "nn", "en-GB"];
const dueAt = new Date("2026-03-08T00:00:00.000Z");

function assertNoLinks(text: string) {
  expect(text).not.toMatch(/https?:\/\//i);
  expect(text).not.toMatch(/www\./i);
}

describe("getCourseReminderNotificationMessage (#497)", () => {
  it.each(LOCALES)("renders a due-soon message with the course + day count in %s", (locale) => {
    const message = getCourseReminderNotificationMessage(locale, "due_soon", {
      courseTitle: "HMS Grunnkurs",
      dueAt,
      daysBefore: 7,
    });
    expect(message.subject).toContain("HMS Grunnkurs");
    expect(message.nextStepGuidance).toContain("HMS Grunnkurs");
    expect(message.nextStepGuidance).toContain("7");
    assertNoLinks(message.subject);
    assertNoLinks(message.nextStepGuidance);
  });

  it.each(LOCALES)("renders a due-today message when daysBefore is 0 in %s", (locale) => {
    const message = getCourseReminderNotificationMessage(locale, "due_soon", {
      courseTitle: "HMS Grunnkurs",
      dueAt,
      daysBefore: 0,
    });
    expect(message.nextStepGuidance).toContain("HMS Grunnkurs");
    assertNoLinks(message.nextStepGuidance);
  });

  it.each(LOCALES)("renders an overdue message in %s", (locale) => {
    const message = getCourseReminderNotificationMessage(locale, "overdue", {
      courseTitle: "HMS Grunnkurs",
      dueAt,
    });
    expect(message.subject).toContain("HMS Grunnkurs");
    expect(message.nextStepGuidance).toContain("HMS Grunnkurs");
    assertNoLinks(message.subject);
    assertNoLinks(message.nextStepGuidance);
  });
});
