// #475: AI-influence flagging (Phase 1) — the participant's AI-use declaration + reflective-nudge
// choice, evaluated into a REVIEW TRIGGER. Core invariants (see doc/design/AI_INFLUENCE_FLAGGING_475.md):
//
//   1. A flag is a REVIEW TRIGGER, never a verdict or penalty. It can only route to UNDER_REVIEW,
//      never contribute to a FAIL. (Enforced in decisionService: aiInfluence feeds `needsManualReview`
//      only, never the fail/threshold gates.)
//   2. Transparent, no black-box stylometry. The signal is the student's own declaration plus their
//      choice to submit after being nudged to engage further — not a guess about writing style.
//   3. Feature-flagged OFF by default, shadow-mode first. When enabled but in shadow mode we store the
//      declaration (the pilot dataset) but route no one.
//
// No keystroke/paste telemetry is captured or stored — only the aggregate declaration (DPIA-light).

import type { ModuleAssessmentPolicy } from "../../codecs/assessmentPolicyCodec.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { lexicalCosineSimilarity } from "./contentSimilarity.js";
import { decisionReasonCodes, type DecisionReasonCode, type DecisionReasonParams } from "./decisionReason.js";

export const AI_DECLARATION_VALUES = ["none", "ideas", "improve", "autonomous"] as const;
export type AiDeclaration = (typeof AI_DECLARATION_VALUES)[number];

/** Aggregate-only process signals stored on Submission.processSignalsJson (#475). */
export type AiInfluenceSignals = {
  /** The participant's self-reported AI use at submit. */
  declaration?: AiDeclaration;
  /** Optional free-text "how did you use it" — stored, shown to the reviewer, never parsed for scoring. */
  declarationText?: string;
  /** True when the participant chose to submit anyway after the reflective nudge (autonomous only). */
  insistedAfterPrompt?: boolean;
};

/** Global defaults from config/assessmentRules.ts `aiInfluence`. */
export type AiInfluenceRules = {
  enabled: boolean;
  shadowMode: boolean;
};

/** What the decision engine needs: whether to force review, and the transparent reason string. */
export type AiInfluenceDecision = {
  forcesReview: true;
  reason: string;
  /** #950: hva som utløste, som data — slik at deltakeren kan få setningen på sitt eget språk. */
  code: DecisionReasonCode;
  params: DecisionReasonParams;
};

// Norwegian (bokmål): this becomes the ManualReview.triggerReason shown to the (Norwegian-speaking)
// reviewer verbatim. The other decisionReason strings in decisionService.ts are still English — a
// broader localisation of all reasons is out of scope; #475 surfaces this one to reviewers so it is
// written in their language.
export const AUTONOMOUS_REVIEW_REASON =
  "Rutet til manuell vurdering: deltakeren erklærte omfattende autonom KI-bruk og valgte å levere " +
  "etter å ha blitt oppfordret til å bearbeide stoffet videre. Antatt for autonom KI-bruk — en " +
  "sensor vurderer; dette er ikke en automatisk stryk.";

function isAiDeclaration(value: unknown): value is AiDeclaration {
  return typeof value === "string" && (AI_DECLARATION_VALUES as readonly string[]).includes(value);
}

/**
 * Parse the persisted processSignalsJson into validated signals. Returns null for missing/malformed
 * data or an unrecognised declaration value (never throws — a bad signal must not break assessment).
 */
export function parseAiInfluenceSignals(raw: string | null | undefined): AiInfluenceSignals | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const declaration = isAiDeclaration(parsed.declaration) ? parsed.declaration : undefined;
    const declarationText =
      typeof parsed.declarationText === "string" ? parsed.declarationText : undefined;
    const insistedAfterPrompt = parsed.insistedAfterPrompt === true;
    if (!declaration && declarationText === undefined) return null;
    return { declaration, declarationText, insistedAfterPrompt };
  } catch {
    return null;
  }
}

/**
 * Decide whether the AI-use signals force a manual review. Returns null when they do not (the common
 * case), so the decision engine only ever receives a positive, explainable trigger.
 *
 * Routing (live) requires: feature enabled, NOT shadow mode, declared "autonomous", AND the
 * participant insisted after the nudge. In shadow mode we route no one — the stored declaration is the
 * pilot dataset used to measure the would-route rate before enabling.
 */
export function evaluateAiInfluence(args: {
  signals: AiInfluenceSignals | null;
  policy: ModuleAssessmentPolicy | null | undefined;
  rules: AiInfluenceRules;
}): AiInfluenceDecision | null {
  const { signals, policy, rules } = args;
  if (!signals?.declaration) return null;

  const enabled = policy?.aiInfluence?.enabled ?? rules.enabled;
  if (!enabled) return null;

  const shadowMode = policy?.aiInfluence?.shadowMode ?? rules.shadowMode;
  if (shadowMode) return null;

  const forcesReview = signals.declaration === "autonomous" && signals.insistedAfterPrompt === true;
  if (!forcesReview) return null;

  // Carry the participant's own free-text description INTO the reason so it reaches the reviewer
  // wherever the trigger/decision reason is shown (not only the review-detail declaration line).
  const description = signals.declarationText?.trim();
  const reason = description
    ? `${AUTONOMOUS_REVIEW_REASON} Deltakerens beskrivelse: «${description.slice(0, 600)}»`
    : AUTONOMOUS_REVIEW_REASON;

  return {
    forcesReview: true,
    reason,
    code: decisionReasonCodes.manualReviewAiDeclaration,
    // Deltakerens egen beskrivelse er deltakerens egne ord — den settes inn i setningen, ikke
    // oversatt. Tom streng når hen ikke skrev noe, slik at klienten kan utelate den delen.
    params: { description: description ? description.slice(0, 600) : "" },
  };
}

// ── #475 Phase 2: content-similarity signal ─────────────────────────────────────────────────────

/** Global defaults from config/assessmentRules.ts `aiInfluence.contentSimilarity`. */
export type AiInfluenceContentRules = {
  enabled: boolean;
  shadowMode: boolean;
  similarityThreshold: number;
};

/** The computed content-similarity signal, persisted for pilot analysis + (when live) routing. */
export type ContentSimilaritySignal = {
  /** Lexical cosine similarity between the student answer and an independent model answer, 0–1. */
  similarity: number;
  threshold: number;
  /** similarity >= threshold. */
  exceeded: boolean;
  /** exceeded AND live (not shadow) — the only case where this contributes to review routing. */
  forcesReview: boolean;
};

export const CONTENT_SIMILARITY_REVIEW_REASON_PREFIX =
  "Rutet til manuell vurdering: besvarelsen ligner sterkt på et uavhengig generert modellsvar";

/**
 * Resolve the effective content-similarity rules: a per-module override (ModuleAssessmentPolicy) wins
 * field-by-field over the global default, mirroring how the declaration signal merges policy over rules.
 */
export function resolveContentSimilarityRules(
  policy: ModuleAssessmentPolicy | null | undefined,
  globalRules: AiInfluenceContentRules,
): AiInfluenceContentRules {
  const override = policy?.aiInfluence?.contentSimilarity;
  return {
    enabled: override?.enabled ?? globalRules.enabled,
    shadowMode: override?.shadowMode ?? globalRules.shadowMode,
    similarityThreshold: override?.similarityThreshold ?? globalRules.similarityThreshold,
  };
}

function roundSimilarity(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Generate a model answer to the task and measure its lexical similarity to the student's answer.
 * Returns null when the feature is off or there is nothing to compare. In shadow mode it still returns
 * the computed similarity (for the pilot dataset) but with `forcesReview: false`. A draft-generation
 * failure NEVER breaks assessment — the signal is simply skipped.
 */
export async function evaluateContentSimilarity(args: {
  taskText: string | undefined;
  studentAnswer: string;
  generateDraft: (ctx: {
    moduleTaskText: string;
    moduleGuidanceText?: string;
    responseLocale?: SupportedLocale;
  }) => Promise<string>;
  moduleGuidanceText?: string;
  responseLocale?: SupportedLocale;
  rules: AiInfluenceContentRules;
}): Promise<ContentSimilaritySignal | null> {
  const { taskText, studentAnswer, generateDraft, rules } = args;
  if (!rules.enabled) return null;
  if (!taskText || studentAnswer.trim().length === 0) return null;

  let draft: string;
  try {
    draft = await generateDraft({
      moduleTaskText: taskText,
      moduleGuidanceText: args.moduleGuidanceText,
      responseLocale: args.responseLocale,
    });
  } catch (error) {
    console.warn("[#475] content-similarity draft generation failed; skipping the signal.", error);
    return null;
  }
  if (!draft || draft.trim().length === 0) return null;

  const similarity = lexicalCosineSimilarity(studentAnswer, draft);
  const exceeded = similarity >= rules.similarityThreshold;
  return {
    similarity: roundSimilarity(similarity),
    threshold: rules.similarityThreshold,
    exceeded,
    forcesReview: exceeded && !rules.shadowMode,
  };
}

// ── Combine the Phase-1 (declaration) + Phase-2 (content-similarity) signals ─────────────────────

/** The persisted shape on AssessmentDecision.aiInfluenceJson. */
export type AiInfluencePersisted = {
  declaration: AiDeclaration | null;
  declarationForcesReview: boolean;
  contentSimilarity: ContentSimilaritySignal | null;
  forcesReview: boolean;
};

/** Parse the JSON persisted on AssessmentDecision.aiInfluenceJson (null/malformed → null). */
export function parseAiInfluencePersisted(raw: string | null | undefined): AiInfluencePersisted | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AiInfluencePersisted;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export type AiInfluenceOutcome = {
  /** Serialized AiInfluencePersisted for AssessmentDecision.aiInfluenceJson (null when no signals). */
  signalsJson: string | null;
  /** What the decision engine consumes — present only when something actually forces review. */
  decision: AiInfluenceDecision | undefined;
};

function contentSimilarityReason(signal: ContentSimilaritySignal): string {
  const pct = (n: number) => `${Math.round(n * 100)} %`;
  return (
    `${CONTENT_SIMILARITY_REVIEW_REASON_PREFIX} (${pct(signal.similarity)} ≥ terskel ${pct(signal.threshold)}). ` +
    "Dette er ett signal, ikke bevis — en sensor vurderer; dette er ikke en automatisk stryk."
  );
}

/**
 * Combine the declaration (Phase 1) and content-similarity (Phase 2) signals into (a) the JSON persisted
 * on the decision for transparency/pilot analysis, and (b) the review-trigger the decision engine reads.
 * The declaration reason takes precedence when both fire; either alone is sufficient to route.
 */
export function buildAiInfluenceOutcome(args: {
  declaration: AiDeclaration | undefined;
  declarationResult: AiInfluenceDecision | null;
  contentSignal: ContentSimilaritySignal | null;
}): AiInfluenceOutcome {
  const { declaration, declarationResult, contentSignal } = args;
  if (!declaration && !contentSignal) {
    return { signalsJson: null, decision: undefined };
  }

  const declarationForcesReview = Boolean(declarationResult?.forcesReview);
  const forcesReview = declarationForcesReview || Boolean(contentSignal?.forcesReview);

  const persisted: AiInfluencePersisted = {
    declaration: declaration ?? null,
    declarationForcesReview,
    contentSimilarity: contentSignal,
    forcesReview,
  };

  let decision: AiInfluenceDecision | undefined;
  if (declarationForcesReview && declarationResult) {
    decision = declarationResult;
  } else if (contentSignal?.forcesReview) {
    decision = {
      forcesReview: true,
      reason: contentSimilarityReason(contentSignal),
      code: decisionReasonCodes.manualReviewContentSimilarity,
      params: {
        similarityPercent: Math.round(contentSignal.similarity * 100),
        thresholdPercent: Math.round(contentSignal.threshold * 100),
      },
    };
  }

  return { signalsJson: JSON.stringify(persisted), decision };
}
