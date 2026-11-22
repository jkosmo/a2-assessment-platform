import { describe, expect, it, vi } from "vitest";
import { fasit } from "../support/mascotFasit.js";
import { emailSituations, installEmailTestHooks, sendSituation, type EmailHarnessState } from "../support/mascotEmailSituations.js";

// Maskotpakken, steg 0: fasit for e-postene, byte for byte (doc/design/MASKOTPAKKE.md).
//
// Alle ni bildesituasjonene (`EMAIL_ILLUSTRATIONS`) × nb/nn/en-GB × med og uten lenke, sendt gjennom de ekte
// sendefunksjonene til ACS (mocket her). Lagret: emne, ren tekst, HTML, og vedleggets navn, type, innholds-id og
// sha256. Påminnelsene (courseReminderService.ts) og ny hovedversjon (courseMajorVersionEmail.ts, med verft-setningen
// fra notificationMessages.ts) går sine egne veier, også de. Situasjonene står i test/support/mascotEmailSituations.ts,
// som testen av et bytte (mascot-swap-email.test.ts) også bruker.

const h = vi.hoisted((): EmailHarnessState => ({ sent: [], notice: null, user: null }));

vi.mock("@azure/communication-email", () => ({
  EmailClient: class {
    beginSend(message: Record<string, unknown>) {
      h.sent.push(message);
      return Promise.resolve({ pollUntilDone: () => Promise.resolve({ status: "Succeeded" }) });
    }
  },
}));
vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));
// Bare behandleren for ny hovedversjon leser databasen: raden, kurset, personen og versjonen.
vi.mock("../../src/db/prisma.js", () => ({
  prisma: {
    courseVersionNotice: {
      findUnique: vi.fn(async () => h.notice),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    course: { findUnique: vi.fn(async () => ({ title: "Brannvern for alle", publishedAt: new Date("2026-01-01T00:00:00Z"), archivedAt: null, versionMajor: 4 })) },
    user: { findUnique: vi.fn(async () => h.user) },
    courseVersion: { findUnique: vi.fn(async () => ({ changedItemCount: 3 })) },
  },
}));

installEmailTestHooks(h);

describe("maskotpakken, steg 0: e-postene byte for byte", () => {
  it("dekker alle ni bildesituasjonene (kontrollcase: en tom liste ville bestått alt under)", () => {
    expect(Object.keys(emailSituations(h)).sort()).toEqual(
      ["appeal", "courseAssigned", "courseNewVersion", "discussion", "dueSoon", "notPassed", "overdue", "passed", "underReview"],
    );
  });

  it.each(Object.keys(emailSituations(h)))("%s: alle språk og varianter, med og uten lenke", async (situation) => {
    const actual = await sendSituation(h, situation);
    expect(actual).toEqual(fasit(`email/${situation}.json`, actual));
  });
});
