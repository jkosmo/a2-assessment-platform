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
import { apiFetch } from "/static/api-client.js";

/**
 * Load the app version into the version label. The page title is set by /static/page-title.js and
 * carries no version number.
 */
export async function loadVersion(appVersionLabel) {
  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    if (appVersionLabel) appVersionLabel.textContent = `v${version}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }
}
