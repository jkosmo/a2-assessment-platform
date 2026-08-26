import { beforeEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

const countStuckFailedAssessments = vi.fn();
const getMany = vi.fn();
const setConfig = vi.fn();
const sendViaAcs = vi.fn();
const logOperationalEvent = vi.fn();
const roleAssignmentFindMany = vi.fn();

vi.mock("../../src/modules/assessment/assessmentJobRepository.js", () => ({
  assessmentJobRepository: { countStuckFailedAssessments },
}));

vi.mock("../../src/modules/platformConfig/platformConfigRepository.js", () => ({
  platformConfigRepository: { getMany, set: setConfig },
}));

vi.mock("../../src/modules/certification/participantNotificationService.js", () => ({ sendViaAcs }));

vi.mock("../../src/observability/operationalLog.js", () => ({ logOperationalEvent }));

vi.mock("../../src/db/prisma.js", () => ({
  prisma: { roleAssignment: { findMany: roleAssignmentFindMany } },
}));

let notificationChannel = "acs_email";
vi.mock("../../src/config/env.js", () => ({
  env: {
    ASSESSMENT_FAILED_ALERT_THRESHOLD: 3,
    ASSESSMENT_FAILED_ALERT_COOLDOWN_MS: 86_400_000,
    get PARTICIPANT_NOTIFICATION_CHANNEL() {
      return notificationChannel;
    },
  },
}));

// #994: modulgrafen leses her, ikke i første test.
warmModuleGraph(() => import("../../src/modules/assessment/failedAssessmentAlert.js"));

const NOW = new Date("2026-08-26T12:00:00.000Z");

describe("#953 — varsel når feilede vurderinger hoper seg opp", () => {
  beforeEach(() => {
    vi.resetModules();
    notificationChannel = "acs_email";
    countStuckFailedAssessments.mockReset();
    getMany.mockReset().mockResolvedValue({});
    setConfig.mockReset().mockResolvedValue(undefined);
    sendViaAcs.mockReset().mockResolvedValue({ delivered: true });
    logOperationalEvent.mockReset();
    roleAssignmentFindMany.mockReset().mockResolvedValue([
      { user: { email: "admin1@company.com", name: "Admin One" } },
      { user: { email: "admin2@company.com", name: "Admin Two" } },
    ]);
  });

  it("tier når det bare er én feilet vurdering — det er en enkeltsak, ikke en opphopning", async () => {
    countStuckFailedAssessments.mockResolvedValue(1);
    const { alertOnFailedAssessmentBacklog } = await import("../../src/modules/assessment/failedAssessmentAlert.js");

    await alertOnFailedAssessmentBacklog(NOW);

    expect(sendViaAcs).not.toHaveBeenCalled();
    expect(setConfig).not.toHaveBeenCalled();
  });

  it("varsler HVER administrator når terskelen er nådd", async () => {
    countStuckFailedAssessments.mockResolvedValue(4);
    const { alertOnFailedAssessmentBacklog } = await import("../../src/modules/assessment/failedAssessmentAlert.js");

    await alertOnFailedAssessmentBacklog(NOW);

    expect(sendViaAcs).toHaveBeenCalledTimes(2);
    expect(sendViaAcs.mock.calls.map((c) => c[0].recipientEmail).sort()).toEqual([
      "admin1@company.com",
      "admin2@company.com",
    ]);
    expect(sendViaAcs.mock.calls[0][0].subject).toContain("4");
    expect(setConfig).toHaveBeenCalledWith(
      "assessment.failedBacklogAlert.lastSentAt",
      NOW.toISOString(),
      "system",
    );
  });

  // ⚠️ Denne er hele poenget. Når LLM-tjenesten er nede feiler alt samtidig, og runneren kaller
  // varslingen hver runde — uten karenstid ville administratorer fått én e-post per runde til de
  // lagde en innboksregel. Et varsel folk filtrerer bort er verre enn ingen varsel: det ser ut som
  // dekning man ikke har.
  it("sender IKKE på nytt innenfor karenstiden, selv om opphopningen består", async () => {
    countStuckFailedAssessments.mockResolvedValue(9);
    getMany.mockResolvedValue({
      "assessment.failedBacklogAlert.lastSentAt": new Date(NOW.getTime() - 3_600_000).toISOString(),
    });
    const { alertOnFailedAssessmentBacklog } = await import("../../src/modules/assessment/failedAssessmentAlert.js");

    await alertOnFailedAssessmentBacklog(NOW);

    expect(sendViaAcs).not.toHaveBeenCalled();
  });

  // KONTROLLCASE: uten denne ville testen over vært like grønn om varslingen ALDRI sendte noe igjen.
  it("sender igjen når karenstiden har løpt ut", async () => {
    countStuckFailedAssessments.mockResolvedValue(9);
    getMany.mockResolvedValue({
      "assessment.failedBacklogAlert.lastSentAt": new Date(NOW.getTime() - 90_000_000).toISOString(),
    });
    const { alertOnFailedAssessmentBacklog } = await import("../../src/modules/assessment/failedAssessmentAlert.js");

    await alertOnFailedAssessmentBacklog(NOW);

    expect(sendViaAcs).toHaveBeenCalledTimes(2);
  });

  // #953: en plattform uten administrator-tildelinger har null mottakere. Da må loggen fortsatt
  // bære at opphopningen finnes — ellers er systemet helt stille i nettopp den situasjonen
  // varselet er laget for.
  it("logger opphopningen også når det ikke finnes noen administrator å varsle", async () => {
    countStuckFailedAssessments.mockResolvedValue(5);
    roleAssignmentFindMany.mockResolvedValue([]);
    const { alertOnFailedAssessmentBacklog } = await import("../../src/modules/assessment/failedAssessmentAlert.js");

    await alertOnFailedAssessmentBacklog(NOW);

    expect(sendViaAcs).not.toHaveBeenCalled();
    expect(logOperationalEvent).toHaveBeenCalledWith(
      "assessment_failed_backlog_alert",
      expect.objectContaining({ failedCount: 5, recipientCount: 0 }),
      "error",
    );
  });

  // #953/QA-F7: uten mottakere skrives karenstiden LIKEVEL. Ellers gjentas error-loggraden hver
  // worker-runde (poll 4 s) og flommer driftsloggen i nøyaktig den situasjonen den finnes for.
  it("setter karenstiden også når ingen kunne varsles", async () => {
    countStuckFailedAssessments.mockResolvedValue(5);
    roleAssignmentFindMany.mockResolvedValue([]);
    const { alertOnFailedAssessmentBacklog } = await import("../../src/modules/assessment/failedAssessmentAlert.js");

    await alertOnFailedAssessmentBacklog(NOW);

    expect(setConfig).toHaveBeenCalledWith(
      "assessment.failedBacklogAlert.lastSentAt",
      NOW.toISOString(),
      "system",
    );
  });

  // #953/QA-F5: «disabled» skal bety disabled. Første utgave gikk rett på ACS og ville kastet per
  // mottaker i et miljø uten e-postoppsett — stille, og karenstiden ble satt uansett.
  it("sender ingenting når varselkanalen er slått av", async () => {
    notificationChannel = "disabled";
    countStuckFailedAssessments.mockResolvedValue(7);
    const { alertOnFailedAssessmentBacklog } = await import("../../src/modules/assessment/failedAssessmentAlert.js");

    await alertOnFailedAssessmentBacklog(NOW);

    expect(sendViaAcs).not.toHaveBeenCalled();
  });
});
