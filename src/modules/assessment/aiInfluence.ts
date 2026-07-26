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

  return { forcesReview: true, reason };
}
