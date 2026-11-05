import { describe, expect, it } from "vitest";
import {
  buildModuleCardViewModels,
  deriveParticipantFlowGateState,
  findMatchingPreset,
  orphanedDraftTexts,
  parseDraftEnvelope,
  pruneExpiredModuleDrafts,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
  resolveSelectedModule,
  sanitizeWorkspaceNavigationItems,
  sanitizeAppealStatuses,
  sanitizeMockRolePresets,
  upsertModuleDraft,
  clearCourseRetakeFlag,
  markCourseModuleStarted,
  aiReviewRoutingLive,
} from "../public/participant-console-state.js";

describe("2.134.1: går «KI skrev det meste» til sensor?", () => {
  const live = { enabled: true, shadowMode: false };
  it("samme regel som serveren: modulens egen innstilling først, så den globale", () => {
    expect(aiReviewRoutingLive(live, { assessmentPolicy: null })).toBe(true);
    expect(aiReviewRoutingLive(live, null)).toBe(true);
    expect(aiReviewRoutingLive({ enabled: true, shadowMode: true }, null)).toBe(false);
    expect(aiReviewRoutingLive({ enabled: false, shadowMode: false }, null)).toBe(false);
    expect(aiReviewRoutingLive(live, { assessmentPolicy: { aiInfluence: { shadowMode: true } } })).toBe(false);
    expect(aiReviewRoutingLive(live, { assessmentPolicy: { aiInfluence: { enabled: false } } })).toBe(false);
    expect(aiReviewRoutingLive({ enabled: false, shadowMode: true }, { assessmentPolicy: { aiInfluence: { enabled: true, shadowMode: false } } })).toBe(true);
    expect(aiReviewRoutingLive(undefined, null)).toBe(false);
  });
});

describe("2.134.1: kursdetaljene i minnet etter en innlevering", () => {
  it("«ikke startet» blir «påbegynt» for modulen, i alle kurs; andre moduler og andre statuser står", () => {
    const details = {
      a: {
        items: [
          { type: "MODULE", moduleId: "m1", moduleStatus: "NOT_STARTED" },
          { type: "MODULE", moduleId: "m2", moduleStatus: "NOT_STARTED" },
          { type: "SECTION", sectionId: "s1" },
        ],
        modules: [{ moduleId: "m1", moduleStatus: "NOT_STARTED" }],
      },
      b: { items: [{ type: "MODULE", moduleId: "m1", moduleStatus: "PASSED" }] },
      c: { items: [{ type: "MODULE", moduleId: "m1", moduleStatus: "REVISED_RETAKE_REQUIRED" }] },
      d: null,
    };
    expect(markCourseModuleStarted(details, "m1")).toEqual(["a"]);
    expect(details.a.items[0].moduleStatus).toBe("IN_PROGRESS");
    expect(details.a.modules[0].moduleStatus).toBe("IN_PROGRESS");
    expect(details.a.items[1].moduleStatus).toBe("NOT_STARTED");
    expect(details.b.items[0].moduleStatus).toBe("PASSED");
    expect(details.c.items[0].moduleStatus).toBe("REVISED_RETAKE_REQUIRED");
    expect(markCourseModuleStarted(details, "m1")).toEqual([]);

describe("#934 5a-3: kursdetaljene i minnet etter en ny bestått", () => {
  it("tar bort «ta den på nytt» for modulen, i alle kurs, og rører ikke andre moduler", () => {
    const details = {
      a: { items: [{ type: "MODULE", moduleId: "m1", retakeRequired: true }, { type: "MODULE", moduleId: "m2", retakeRequired: true }, { type: "SECTION", sectionId: "s1" }] },
      b: { items: [{ type: "MODULE", moduleId: "m1", retakeRequired: true }] },
      c: null,
    };
    clearCourseRetakeFlag(details, "m1");
    expect(details.a.items[0].retakeRequired).toBe(false);
    expect(details.b.items[0].retakeRequired).toBe(false);
    expect(details.a.items[1].retakeRequired).toBe(true);
    expect(details.a.items[2]).toEqual({ type: "SECTION", sectionId: "s1" });
  });
});

describe("participant console state helpers", () => {
  it("#934 5a-1: finner teksten i kladden som ikke har noe felt på siden", () => {
    const draft = { gammeltFelt: "Svaret mitt", tomtFelt: "  ", nyttFelt: "Nytt", mcq: { questions: [] }, updatedAt: "2026-11-04T00:00:00Z" };
    expect(orphanedDraftTexts(draft, ["nyttFelt"])).toEqual([{ id: "gammeltFelt", text: "Svaret mitt" }]);
    expect(orphanedDraftTexts(draft, ["nyttFelt", "gammeltFelt"])).toEqual([]);
  });

  it("#934 5a-1: et svar som er levert, trenger ikke reddes, og uten kladd er det ingenting", () => {
    expect(orphanedDraftTexts({ gammeltFelt: "Svaret mitt", submittedAs: "s1" }, [])).toEqual([]);
    expect(orphanedDraftTexts(undefined, [])).toEqual([]);
  });

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

  it("builds module card models with explicit selected and completed state", () => {
    const models = buildModuleCardViewModels(
      [
        { id: "m1", title: "Foundations", taskText: "Task 1", participantStatus: { latestStatus: "COMPLETED" } },
        { id: "m2", title: "Governance", assessorExpectedContent: "Guide 2" },
      ],
      "m2",
    );

    expect(models).toEqual([
      {
        id: "m2",
        title: "Governance",
        assessorExpectedContent: "Guide 2",
        selected: true,
        completed: false,
        latestStatus: "",
      },
      {
        id: "m1",
        title: "Foundations",
        taskText: "Task 1",
        participantStatus: { latestStatus: "COMPLETED" },
        selected: false,
        completed: true,
        latestStatus: "COMPLETED",
      },
    ]);
  });

  it("resolves selected module by id for human-readable summary", () => {
    const selected = resolveSelectedModule(
      [
        { id: "m1", title: "Foundations", taskText: "Task 1", assessorExpectedContent: "Guide 1" },
        { id: "m2", title: "Governance" },
      ],
      "m1",
    );

    expect(selected).toEqual({
      id: "m1",
      title: "Foundations",
      taskText: "Task 1",
      assessorExpectedContent: "Guide 1",
      selected: true,
      completed: false,
      latestStatus: "",
    });
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

    // ⚠️ #1002: gaten krevde tidligere bare `resultStatus === "COMPLETED"`. Nå kreves et
    // STRYKVEDTAK — en bestått innlevering har ingenting å anke, og fiksturen var stum om utfallet.
    const completedFail = deriveParticipantFlowGateState({
      hasSubmission: true,
      hasMcqSubmission: true,
      assessmentQueued: true,
      resultStatus: "COMPLETED",
      resultPassFail: false,
    });
    expect(completedFail.checkAssessmentUnlocked).toBe(true);
    expect(completedFail.appealUnlocked).toBe(true);
    expect(completedFail.appealHintKey).toBe("flow.appealReady");
  });

  it("#1002 anke er mulig OGSÅ mens saken er til manuell vurdering", () => {
    // Produkteier 2026-08-24: «Anke er kraftigere lut enn manuell behandling … la oss ikke lage en
    // regel uten skjellig grunn.» Serveren har alltid tillatt det.
    //
    // ⚠️ Første forsøk løsnet bare regelen som styrer om SEKSJONEN vises. Denne gaten styrer om
    // KNAPPEN virker, og sto igjen låst — funnet av QA-porten.
    const underReview = deriveParticipantFlowGateState({
      hasSubmission: true,
      hasMcqSubmission: true,
      assessmentQueued: true,
      resultStatus: "UNDER_REVIEW",
      resultPassFail: false,
    });
    expect(underReview.appealUnlocked).toBe(true);
  });

  it("#1002 KONTROLLCASE: uten et strykvedtak er anke fortsatt låst", () => {
    // Uten denne kunne gaten returnert true for alt og fortsatt vært grønn.
    const passed = deriveParticipantFlowGateState({
      hasSubmission: true,
      hasMcqSubmission: true,
      assessmentQueued: true,
      resultStatus: "COMPLETED",
      resultPassFail: true,
    });
    expect(passed.appealUnlocked).toBe(false);

    const noDecision = deriveParticipantFlowGateState({
      hasSubmission: true,
      hasMcqSubmission: true,
      assessmentQueued: true,
      resultStatus: "COMPLETED",
      resultPassFail: null,
    });
    expect(noDecision.appealUnlocked).toBe(false);
  });

  it("unlocks assessment without MCQ for FREETEXT_ONLY modules (#578)", () => {
    // requiresMcq:false → assessment unlocks on the free-text submission alone (no MCQ gate).
    const freetextOnly = deriveParticipantFlowGateState(
      { hasSubmission: true, hasMcqSubmission: false, assessmentQueued: false, resultStatus: null },
      { requiresMcq: false },
    );
    expect(freetextOnly.assessmentUnlocked).toBe(true);
    expect(freetextOnly.assessmentHintKey).toBe("flow.assessmentReady");

    // The default (requiresMcq) still gates on MCQ.
    const requiresMcq = deriveParticipantFlowGateState({
      hasSubmission: true,
      hasMcqSubmission: false,
      assessmentQueued: false,
      resultStatus: null,
    });
    expect(requiresMcq.assessmentUnlocked).toBe(false);
    expect(requiresMcq.assessmentHintKey).toBe("flow.assessmentLockedNeedsMcq");
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
