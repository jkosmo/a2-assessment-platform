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

const UNSUPPORTED_EDIT_PATTERNS = [
  {
    area: "rubric",
    pattern: /\brubric\b|criteria|criterion|scaling rule|pass rule|score(?:ing)? rules?|vurderingsreg|kriteri(?:um|er)|poengskalering|best[åa]tt/i,
  },
  {
    area: "prompt",
    pattern: /\bprompt\b|prompt template|system prompt|user prompt|evaluation instruction|systeminstruks|vurderingsinstruks/i,
  },
  {
    area: "submissionSchema",
    pattern: /submission schema|submission form|response field|innleveringsskjema|innleveringsfelt/i,
  },
  {
    area: "assessmentPolicy",
    pattern: /assessment policy|vurderingspolicy/i,
  },
];

const TRANSLATION_ONLY_PATTERN = /^(?:please\s+)?(?:translate|locali[sz]e|oversett|omset|lokaliser)\b/i;
const TOO_BROAD_PATTERN = /^(?:please\s+)?(?:gj[oø]r|make|improve|fix|endre|oppdater|forbedre|rewrite|rework)\s+(?:dette|this|det|alt|everything|hele)\b/i;

function extractQuotedValue(raw) {
  const quoted = String(raw ?? "").match(/["“”']([^"“”']+)["“”']/);
  return quoted?.[1]?.trim() ?? "";
}

function extractTitleEditValue(instruction) {
  const raw = String(instruction ?? "").trim();
  const quotedValue = extractQuotedValue(raw);
  const normalized = raw.replace(/[“”]/g, "\"");
  const patterns = [
    /^(?:rename|change|set|update|edit)\s+(?:the\s+)?(?:module\s+)?title\s*(?:to|as|:)\s*(.+)$/i,
    /^(?:rename|change|set|update|edit)\s+(?:this\s+)?module\s*(?:to|as|:)\s*(.+)$/i,
    /^(?:gi|sett|endre|oppdater|bytt)\s+(?:modul(?:en)?s?\s+)?tittel(?:en)?\s*(?:til|som|:)?\s*(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const value = quotedValue || match[1].replace(/^["“”']|["“”']$/g, "").trim();
    if (value) return value;
  }

  return "";
}

export function classifyShellEditInstruction(instruction, {
  hasDraft,
  hasMcq,
  hasSelectedModule,
}) {
  const raw = String(instruction ?? "").trim();
  const normalized = raw.toLowerCase();

  if (!raw) {
    return { kind: "clarify", reason: "empty" };
  }

  for (const { area, pattern } of UNSUPPORTED_EDIT_PATTERNS) {
    if (pattern.test(raw)) {
      return { kind: "unsupported", area };
    }
  }

  const title = extractTitleEditValue(raw);
  if (title) {
    const mentionsOtherEditableSurface =
      /\bscenario\b|veiled|guidance|oppgavetekst|task text|task\b|case\b|kontekst|context|\bmcq\b|flervalg|multiple[- ]choice|sp[øo]rsm[åa]l|questions?|\bq\d+\b|\b\d+[a-e]\b|alternativ|options?/i
        .test(raw);
    if (mentionsOtherEditableSurface) {
      return { kind: "clarify", reason: "mixed_title_and_content" };
    }
    if (!hasSelectedModule && !hasDraft) {
      return { kind: "clarify", reason: "missing_module_context" };
    }
    return { kind: "title", title };
  }

  if (TRANSLATION_ONLY_PATTERN.test(raw)) {
    const targets = detectShellRevisionTargets(raw, { hasDraft, hasMcq });
    if (!targets.draft && !targets.mcq) {
      return { kind: "clarify", reason: "nothing_to_translate" };
    }
    return { kind: "translate", draft: targets.draft, mcq: targets.mcq };
  }

  const targets = detectShellRevisionTargets(raw, { hasDraft, hasMcq });
  if (!targets.draft && !targets.mcq) {
    return { kind: "clarify", reason: "no_supported_surface" };
  }

  if (TOO_BROAD_PATTERN.test(normalized) && targets.draft && targets.mcq) {
    return { kind: "clarify", reason: "too_broad" };
  }

  return {
    kind: "revision",
    draft: targets.draft,
    mcq: targets.mcq,
    instruction: raw,
  };
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
  actionKeys.push("directEdit", "editAdvanced", "pickAnother");
  if (hasDraft) actionKeys.push("saveDraft");
  if (!hasDraft && canPublish) actionKeys.push("publish");
  if (canUnpublish) actionKeys.push("unpublish");

  return {
    actionKeys,
    shouldOfferUnifiedRevision: hasDraft || hasMcq,
  };
}

export function deriveShellDraftReadyActionModel({ hasSelectedModule }) {
  const actionKeys = ["directEdit"];
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
