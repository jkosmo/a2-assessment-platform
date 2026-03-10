import { describe, expect, it } from "vitest";
import {
  buildModuleCardViewModels,
  deriveParticipantFlowGateState,
  findMatchingPreset,
  parseDraftEnvelope,
  pruneExpiredModuleDrafts,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
  resolveSelectedModule,
  sanitizeWorkspaceNavigationItems,
  sanitizeAppealStatuses,
  sanitizeMockRolePresets,
  upsertModuleDraft,
} from "../public/participant-console-state.js";

describe("participant console state helpers", () => {
  it("sanitizes and de-duplicates configured presets", () => {
    const presets = sanitizeMockRolePresets([
      "participant",
      "PARTICIPANT",
      "REVIEWER",
      "INVALID",
      " APPEAL_HANDLER ",
    ]);

    expect(presets).toEqual(["PARTICIPANT", "REVIEWER", "APPEAL_HANDLER"]);
  });

  it("disables role switch when auth mode is entra", () => {
    const state = resolveRoleSwitchState({
      authMode: "entra",
      mockRoleSwitchEnabled: true,
      mockRolePresets: ["PARTICIPANT", "REVIEWER"],
    });

    expect(state.authMode).toBe("entra");
    expect(state.enabled).toBe(false);
    expect(state.presets).toEqual(["PARTICIPANT", "REVIEWER"]);
  });

  it("matches only single-role values against presets", () => {
    const presets = ["PARTICIPANT", "ADMINISTRATOR"];

    expect(findMatchingPreset("participant", presets)).toBe("PARTICIPANT");
    expect(findMatchingPreset("participant,reviewer", presets)).toBe("");
    expect(findMatchingPreset("reviewer", presets)).toBe("");
  });

  it("builds module card models with explicit selected state", () => {
    const models = buildModuleCardViewModels(
      [
        { id: "m1", title: "Foundations" },
        { id: "m2", title: "Governance" },
      ],
      "m2",
    );

    expect(models).toEqual([
      { id: "m1", title: "Foundations", selected: false },
      { id: "m2", title: "Governance", selected: true },
    ]);
  });

  it("resolves selected module by id for human-readable summary", () => {
    const selected = resolveSelectedModule(
      [
        { id: "m1", title: "Foundations" },
        { id: "m2", title: "Governance" },
      ],
      "m1",
    );

    expect(selected).toEqual({ id: "m1", title: "Foundations", selected: true });
  });

  it("parses and prunes expired module drafts by ttl", () => {
    const now = new Date("2026-03-09T12:00:00.000Z").getTime();
    const envelope = parseDraftEnvelope(
      JSON.stringify({
        modules: {
          m1: { rawText: "a", updatedAt: "2026-03-09T11:30:00.000Z" },
          m2: { rawText: "b", updatedAt: "2026-03-09T07:00:00.000Z" },
        },
      }),
    );
    const active = pruneExpiredModuleDrafts(envelope.modules, 180, now);

    expect(active).toEqual({
      m1: { rawText: "a", updatedAt: "2026-03-09T11:30:00.000Z" },
    });
  });

  it("keeps module drafts isolated and bounded by max entries", () => {
    const now = new Date("2026-03-09T12:00:00.000Z").getTime();
    let drafts = upsertModuleDraft({}, "m1", { rawText: "module-a" }, now, 2);
    drafts = upsertModuleDraft(drafts, "m2", { rawText: "module-b" }, now + 1000, 2);
    drafts = upsertModuleDraft(drafts, "m3", { rawText: "module-c" }, now + 2000, 2);

    expect(Object.keys(drafts)).toEqual(["m3", "m2"]);
    expect(drafts.m2.rawText).toBe("module-b");
  });

  it("derives progressive gating rules from participant flow state", () => {
    const initial = deriveParticipantFlowGateState({
      hasSubmission: false,
      hasMcqSubmission: false,
      assessmentQueued: false,
      resultStatus: null,
    });
    expect(initial.assessmentUnlocked).toBe(false);
    expect(initial.appealUnlocked).toBe(false);
    expect(initial.assessmentHintKey).toBe("flow.assessmentLockedNeedsSubmission");

    const afterMcq = deriveParticipantFlowGateState({
      hasSubmission: true,
      hasMcqSubmission: true,
      assessmentQueued: false,
      resultStatus: null,
    });
    expect(afterMcq.assessmentUnlocked).toBe(true);
    expect(afterMcq.checkAssessmentUnlocked).toBe(false);
    expect(afterMcq.checkAssessmentHintKey).toBe("flow.checkAssessmentLockedNeedsQueue");

    const completed = deriveParticipantFlowGateState({
      hasSubmission: true,
      hasMcqSubmission: true,
      assessmentQueued: true,
      resultStatus: "COMPLETED",
    });
    expect(completed.checkAssessmentUnlocked).toBe(true);
    expect(completed.appealUnlocked).toBe(true);
    expect(completed.appealHintKey).toBe("flow.appealReady");
  });

  it("sanitizes configured appeal workspace statuses", () => {
    const statuses = sanitizeAppealStatuses(["open", "IN_REVIEW", "INVALID", "OPEN"], [
      "OPEN",
      "IN_REVIEW",
    ]);

    expect(statuses).toEqual(["OPEN", "IN_REVIEW"]);
  });

  it("sanitizes workspace navigation items and removes invalid entries", () => {
    const items = sanitizeWorkspaceNavigationItems([
      { id: "participant", path: "/participant", labelKey: "nav.participant", requiredRoles: ["participant"] },
      { id: "participant", path: "/duplicate", labelKey: "nav.duplicate" },
      { id: "", path: "/missing-id", labelKey: "nav.missing" },
      { id: "bad-path", path: "participant", labelKey: "nav.badPath" },
      { id: "appeals", path: "/appeal-handler", labelKey: "nav.appeals", requiredRoles: ["APPEAL_HANDLER", "invalid"] },
    ]);

    expect(items).toEqual([
      {
        id: "participant",
        path: "/participant",
        labelKey: "nav.participant",
        requiredRoles: ["PARTICIPANT"],
      },
      {
        id: "appeals",
        path: "/appeal-handler",
        labelKey: "nav.appeals",
        requiredRoles: ["APPEAL_HANDLER"],
      },
    ]);
  });

  it("resolves workspace navigation visibility by role", () => {
    const items = resolveWorkspaceNavigationItems(
      [
        {
          id: "participant",
          path: "/participant",
          labelKey: "nav.participant",
          requiredRoles: ["PARTICIPANT", "ADMINISTRATOR"],
        },
        {
          id: "appeals",
          path: "/appeal-handler",
          labelKey: "nav.appeals",
          requiredRoles: ["APPEAL_HANDLER"],
        },
      ],
      "participant",
      "/participant",
    );

    expect(items).toEqual([
      {
        id: "participant",
        path: "/participant",
        labelKey: "nav.participant",
        requiredRoles: ["PARTICIPANT", "ADMINISTRATOR"],
        visible: true,
        active: true,
      },
      {
        id: "appeals",
        path: "/appeal-handler",
        labelKey: "nav.appeals",
        requiredRoles: ["APPEAL_HANDLER"],
        visible: false,
        active: false,
      },
    ]);
  });

  it("falls back to default navigation when configured items are invalid", () => {
    const items = resolveWorkspaceNavigationItems(
      [{ id: "", path: "invalid", labelKey: "" }],
      "APPEAL_HANDLER",
      "/appeal-handler",
      [
        {
          id: "appeals",
          path: "/appeal-handler",
          labelKey: "nav.appeals",
          requiredRoles: ["APPEAL_HANDLER"],
        },
      ],
    );

    expect(items).toEqual([
      {
        id: "appeals",
        path: "/appeal-handler",
        labelKey: "nav.appeals",
        requiredRoles: ["APPEAL_HANDLER"],
        visible: true,
        active: true,
      },
    ]);
  });
});
