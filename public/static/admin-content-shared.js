// #818: helpers shared by the two authoring shells — `public/admin-content.js` (advanced, form/dialog)
// and `public/static/admin-content-shell.js` (conversation, chat). These were byte- or near-identical in
// both. Behavior-preserving extractions only: callers pass their own DOM refs / strings so the functions
// stay shell-agnostic (no reaching for page-specific globals). The two shells are otherwise genuinely
// divergent and are NOT merged.
//
// ACCEPTED TECHNICAL DEBT (#818, closed 2026-07-25): Phase 1 (this module) extracted the truly-identical
// helpers. A Phase 2 (share the state-rail + console-bootstrap via normalized view-models each shell
// derives) was NOT done — modest payoff (~a few hundred lines; the issue's "~5k" was a big overcount) vs
// real regression risk in two ~5k-line shells. Extend this module opportunistically when you're already
// editing both shells for another reason; don't do a dedicated risky refactor for a p4 concern.
import { escapeHtml } from "/static/html-escape.js";
import { apiFetch } from "/static/api-client.js";

/** Screen-reader status badge markup (was byte-identical in both shells). */
export function makeSrBadge(modifier, text) {
  return `<span class="sr-badge sr-badge--${modifier}">${escapeHtml(text)}</span>`;
}

/**
 * Load the app version and stamp it into the document title + the version label. The two shells differed
 * only in the title prefix ("A2 Content Setup Workspace" vs "A2 Content Workspace") and a null-guard on
 * the label element — both preserved by parameterizing.
 */
export async function loadVersion(appVersionLabel, documentTitlePrefix) {
  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `${documentTitlePrefix} v${version}`;
    if (appVersionLabel) appVersionLabel.textContent = `v${version}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }
}
