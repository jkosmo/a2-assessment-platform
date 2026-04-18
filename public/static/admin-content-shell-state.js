export function detectShellRevisionTargets(instruction, { hasDraft, hasMcq }) {
  const normalized = String(instruction ?? "").toLowerCase();

  if (!hasDraft && !hasMcq) return { draft: false, mcq: false };
  if (hasDraft && !hasMcq) return { draft: true, mcq: false };
  if (!hasDraft && hasMcq) return { draft: false, mcq: true };

  const mentionsDraft = /\bscenario\b|veiled|guidance|oppgavetekst|task text|task\b|case\b|kontekst|context|wording|formul|tekst|språk|language|oversett|translate/i.test(normalized);
  const mentionsMcq = /\bmcq\b|flervalg|multiple[- ]choice|spørsmål|questions?|\bq\d+\b|\b\d+[a-e]\b|alternativ|options?|svaralternativ|correct answer|riktig svar|distractor/i.test(normalized);

  if (mentionsDraft && !mentionsMcq) return { draft: true, mcq: false };
  if (mentionsMcq && !mentionsDraft) return { draft: false, mcq: true };
  return { draft: true, mcq: true };
}

export function deriveShellModuleActionModel({
  hasDraft,
  hasMcq,
  canResumeEditing,
  canPublish,
  canUnpublish,
}) {
  const actionKeys = ["generateContent"];
  if (hasDraft) actionKeys.push("generateMcq");
  if (canResumeEditing) actionKeys.push("resumeChatEdit");
  actionKeys.push("editAdvanced", "pickAnother");
  if (hasDraft) actionKeys.push("saveDraft");
  if (!hasDraft && canPublish) actionKeys.push("publish");
  if (canUnpublish) actionKeys.push("unpublish");

  return {
    actionKeys,
    shouldOfferUnifiedRevision: hasDraft || hasMcq,
  };
}

export function deriveShellDraftReadyActionModel({ hasSelectedModule }) {
  const actionKeys = [];
  if (hasSelectedModule) actionKeys.push("openEditor");
  actionKeys.push("restart", "saveDraft");
  return {
    actionKeys,
    shouldOpenUnifiedRevision: true,
  };
}

export function resolveShellResumeBehavior({ hasHandoffDraft, resumeEditing }) {
  return {
    shouldApplyHandoffDraft: hasHandoffDraft,
    shouldCreateDraftFromLoadedModule: !hasHandoffDraft && !!resumeEditing,
  };
}
