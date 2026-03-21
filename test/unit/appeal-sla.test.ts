import { describe, expect, it } from "vitest";
import { AppealStatus } from "../../src/db/prismaRuntime.js";
import { buildAppealSlaSnapshot } from "../../src/modules/appeal/appealSla.js";

const createdAt = new Date("2026-03-10T00:00:00.000Z");

describe("appeal SLA snapshot", () => {
  it("marks a fresh open appeal as on track", () => {
    const snapshot = buildAppealSlaSnapshot({
      createdAt,
      claimedAt: null,
      resolvedAt: null,
      appealStatus: AppealStatus.OPEN,
      now: new Date("2026-03-10T10:00:00.000Z"),
    });

    expect(snapshot.ageHours).toBe(10);
    expect(snapshot.firstResponseOverdue).toBe(false);
    expect(snapshot.resolutionOverdue).toBe(false);
    expect(snapshot.atRisk).toBe(false);
    expect(snapshot.slaState).toBe("ON_TRACK");
  });

  it("marks an unresolved appeal as at risk near the first-response SLA", () => {
    const snapshot = buildAppealSlaSnapshot({
      createdAt,
      claimedAt: null,
      resolvedAt: null,
      appealStatus: AppealStatus.OPEN,
      now: new Date("2026-03-10T20:00:00.000Z"),
    });

    expect(snapshot.ageHours).toBe(20);
    expect(snapshot.firstResponseOverdue).toBe(false);
    expect(snapshot.resolutionOverdue).toBe(false);
    expect(snapshot.atRisk).toBe(true);
    expect(snapshot.slaState).toBe("AT_RISK");
  });

  it("marks an unresolved appeal as overdue after the first-response SLA passes", () => {
    const snapshot = buildAppealSlaSnapshot({
      createdAt,
      claimedAt: null,
      resolvedAt: null,
      appealStatus: AppealStatus.OPEN,
      now: new Date("2026-03-11T01:00:00.000Z"),
    });

    expect(snapshot.ageHours).toBe(25);
    expect(snapshot.firstResponseOverdue).toBe(true);
    expect(snapshot.resolutionOverdue).toBe(false);
    expect(snapshot.atRisk).toBe(false);
    expect(snapshot.slaState).toBe("OVERDUE");
  });

  it("marks a resolved appeal as resolved and captures durations", () => {
    const resolvedAt = new Date("2026-03-10T08:30:00.000Z");

    const snapshot = buildAppealSlaSnapshot({
      createdAt,
      claimedAt: null,
      resolvedAt,
      appealStatus: AppealStatus.RESOLVED,
      now: new Date("2026-03-10T12:00:00.000Z"),
    });

    expect(snapshot.firstResponseDurationHours).toBe(8.5);
    expect(snapshot.resolutionDurationHours).toBe(8.5);
    expect(snapshot.firstResponseOverdue).toBe(false);
    expect(snapshot.resolutionOverdue).toBe(false);
    expect(snapshot.atRisk).toBe(false);
    expect(snapshot.slaState).toBe("RESOLVED");
  });
});
