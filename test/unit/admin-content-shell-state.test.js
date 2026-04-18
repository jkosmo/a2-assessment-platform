import { describe, expect, it } from "vitest";
import {
  detectShellRevisionTargets,
  deriveShellModuleActionModel,
  deriveShellDraftReadyActionModel,
  resolveShellResumeBehavior,
} from "../../public/static/admin-content-shell-state.js";

describe("admin content shell state helpers", () => {
  describe("detectShellRevisionTargets", () => {
    it("routes targeted MCQ instructions to MCQ-only revision", () => {
      expect(
        detectShellRevisionTargets("Bytt alternativ 1C til noe helt annet.", {
          hasDraft: true,
          hasMcq: true,
        }),
      ).toEqual({ draft: false, mcq: true });
    });

    it("routes scenario/guidance requests to draft-only revision", () => {
      expect(
        detectShellRevisionTargets("Gjør scenarioet enklere og kort ned veiledningen.", {
          hasDraft: true,
          hasMcq: true,
        }),
      ).toEqual({ draft: true, mcq: false });
    });

    it("defaults to revising both when instruction is generic and both surfaces exist", () => {
      expect(
        detectShellRevisionTargets("Gjør dette bedre.", {
          hasDraft: true,
          hasMcq: true,
        }),
      ).toEqual({ draft: true, mcq: true });
    });
  });

  describe("deriveShellModuleActionModel", () => {
    it("keeps a consistent action order for loaded modules with an unsaved draft", () => {
      expect(
        deriveShellModuleActionModel({
          hasDraft: true,
          hasMcq: true,
          canResumeEditing: false,
          canPublish: false,
          canUnpublish: false,
        }),
      ).toEqual({
        actionKeys: ["generateContent", "generateMcq", "editAdvanced", "pickAnother", "saveDraft"],
        shouldOfferUnifiedRevision: true,
      });
    });

    it("shows resume/publish/unpublish only when those states are available", () => {
      expect(
        deriveShellModuleActionModel({
          hasDraft: false,
          hasMcq: false,
          canResumeEditing: true,
          canPublish: true,
          canUnpublish: true,
        }),
      ).toEqual({
        actionKeys: [
          "generateContent",
          "resumeChatEdit",
          "editAdvanced",
          "pickAnother",
          "publish",
          "unpublish",
        ],
        shouldOfferUnifiedRevision: false,
      });
    });
  });

  describe("deriveShellDraftReadyActionModel", () => {
    it("prefers open-editor first when a module already exists", () => {
      expect(deriveShellDraftReadyActionModel({ hasSelectedModule: true })).toEqual({
        actionKeys: ["openEditor", "restart", "saveDraft"],
        shouldOpenUnifiedRevision: true,
      });
    });

    it("omits open-editor when no module has been created yet", () => {
      expect(deriveShellDraftReadyActionModel({ hasSelectedModule: false })).toEqual({
        actionKeys: ["restart", "saveDraft"],
        shouldOpenUnifiedRevision: true,
      });
    });
  });

  describe("resolveShellResumeBehavior", () => {
    it("lets handoff draft win over resumeEditing flag", () => {
      expect(
        resolveShellResumeBehavior({
          hasHandoffDraft: true,
          resumeEditing: true,
        }),
      ).toEqual({
        shouldApplyHandoffDraft: true,
        shouldCreateDraftFromLoadedModule: false,
      });
    });

    it("falls back to loaded-module draft creation when only resumeEditing is set", () => {
      expect(
        resolveShellResumeBehavior({
          hasHandoffDraft: false,
          resumeEditing: true,
        }),
      ).toEqual({
        shouldApplyHandoffDraft: false,
        shouldCreateDraftFromLoadedModule: true,
      });
    });
  });
});
