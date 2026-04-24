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
 * Payload shape:
 *   {
 *     moduleId:     string,
 *     source:       "shell" | "advanced",
 *     draft:        { taskText, guidanceText, mcqQuestions } | null,
 *     locale:       string,      // UI language at time of write
 *     previewLocale: string,     // preview locale at time of write (shell only)
 *     timestamp:    number,      // Date.now() at write time
 *   }
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
