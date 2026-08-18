import { describe, expect, it } from "vitest";
import {
  classifyShellEditInstruction,
  detectShellRevisionTargets,
  deriveShellModuleActionModel,
  deriveShellDraftReadyActionModel,
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

  describe("classifyShellEditInstruction", () => {
    it("extracts a bounded title edit intent from free text", () => {
      expect(
        classifyShellEditInstruction('Rename the module title to "Trade union dialogue"', {
          hasDraft: true,
          hasMcq: true,
          hasSelectedModule: true,
        }),
      ).toEqual({
        kind: "title",
        title: "Trade union dialogue",
      });
    });

    it("routes pure translation requests to locale refresh instead of LLM revision", () => {
      expect(
        classifyShellEditInstruction("Translate the MCQ to nynorsk.", {
          hasDraft: true,
          hasMcq: true,
          hasSelectedModule: true,
        }),
      ).toEqual({
        kind: "translate",
        draft: true,
        mcq: true,
      });
    });

    it("blocks unsupported low-level authoring requests behind advanced editor fallback", () => {
      expect(
        classifyShellEditInstruction("Adjust the rubric weights and update the pass rule.", {
          hasDraft: true,
          hasMcq: true,
          hasSelectedModule: true,
        }),
      ).toEqual({
        kind: "unsupported",
        area: "rubric",
      });
    });

    it("asks for clarification instead of applying overly broad cross-surface edits", () => {
      expect(
        classifyShellEditInstruction("Make this better.", {
          hasDraft: true,
          hasMcq: true,
          hasSelectedModule: true,
        }),
      ).toEqual({
        kind: "clarify",
        reason: "too_broad",
      });
    });
  });

  // #896 S3c-opprydding 2026-08-18: `editAdvanced` og `openEditor` er ute av begge modellene.
  // Handlingskartet i shell-en mistet oppføringene sine da Avansert ble slettet, så nøklene ble
  // filtrert bort i det stille — modellen lovet to knapper som aldri kunne tegnes, og denne
  // testen holdt løftet i live.
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
        actionKeys: ["generateContent", "generateMcq", "saveDraft"],
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
          "publish",
          "unpublish",
        ],
        shouldOfferUnifiedRevision: false,
      });
    });
  });

  describe("deriveShellDraftReadyActionModel", () => {
    it("includes revise as an explicit action and does not auto-open the textarea when a module already exists", () => {
      expect(deriveShellDraftReadyActionModel({ hasSelectedModule: true })).toEqual({
        actionKeys: ["revise", "restart", "saveDraft"],
        shouldOpenUnifiedRevision: false,
      });
    });

    it("omits open-editor when no module has been created yet and keeps revise as an explicit action", () => {
      expect(deriveShellDraftReadyActionModel({ hasSelectedModule: false })).toEqual({
        actionKeys: ["revise", "restart", "saveDraft"],
        shouldOpenUnifiedRevision: false,
      });
    });
  });
});
