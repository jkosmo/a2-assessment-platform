/**
 * admin-content-handoff.js
 *
 * Shared sessionStorage-based working-draft handoff between the conversational
 * shell (/admin-content) and the advanced editor (/admin-content/advanced).
 *
 * sessionStorage is tab-scoped and survives in-tab navigation and page refresh,
 * which makes it appropriate for carrying unsaved draft data across the two pages
 * without leaking it into other tabs or across browser sessions.
 *
 * Payload shape (v1.2.26 — #361):
 *   {
 *     moduleId:     string,
 *     source:       "shell" | "advanced",
 *     draft: {
 *       // Fields included in both directions (full working draft):
 *       title?:                    string | LocalizedText,
 *       description?:              string | LocalizedText,
 *       taskText?:                 string | LocalizedText,
 *       candidateTaskConstraints?: string | LocalizedText,
 *       assessorExpectedContent?:  string | LocalizedText,
 *       mcqQuestions?:             MCQQuestion[],
 *       criteria?:                 Record<criterionId, { label, description, maxScore, candidateVisible }>,
 *       assessmentBlueprint?:      object | string,
 *     } | null,
 *     locale:       string,      // UI language at time of write
 *     previewLocale: string,     // preview locale at time of write (shell only)
 *     timestamp:    number,      // Date.now() at write time
 *   }
 *
 * INTENTIONALLY EXCLUDED from handoff (Avansert-only structures — shell doesn't
 * render them, so roundtrip provides no product benefit):
 *   - rubric.scalingRule (weighting model — Avansert owns)
 *   - promptTemplate (systemPrompt, userPromptTemplate, examples — Avansert specialization)
 *   - submissionSchema (input field schema)
 *   - assessmentPolicy (passRules, including totalMin and borderlineWindow — Avansert owns)
 *
 * Unsaved edits to these fields in Avansert stay in Avansert. Roundtripping them
 * would either (a) lose precision when shell can't represent the value, or (b)
 * tempt shell to expose half-rendered controls.
 */

const HANDOFF_KEY = "adminContent.handoff";
const HANDOFF_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Write a handoff payload to sessionStorage.
 * Silent on storage errors (private mode, quota exceeded).
 */
export function writeHandoff(payload) {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ ...payload, timestamp: Date.now() }));
  } catch {
    // Storage unavailable or full — handoff silently skipped
  }
}

/**
 * Read and immediately clear the handoff for a given moduleId.
 *
 * Returns null if:
 *   - No handoff exists
 *   - moduleId does not match
 *   - Handoff is older than HANDOFF_TTL_MS
 *   - JSON is malformed
 *
 * Always clears the stored entry regardless of validity to avoid stale data.
 */
export function readAndClearHandoff(forModuleId) {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    if (data.moduleId !== forModuleId) return null;
    if (Date.now() - (data.timestamp ?? 0) > HANDOFF_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}
