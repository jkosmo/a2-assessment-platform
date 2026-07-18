/**
 * content-status-badge.js — #705
 *
 * ONE shared status badge for the unified content-lifecycle vocabulary
 * (Utkast / Publisert / Arkivert) across the Kurs / Moduler / Seksjoner admin lists.
 * Previously each list rolled its own: courses used hardcoded Norwegian literals,
 * sections a local LABELS map, and the module library a five-state model with its own
 * `library.status.*` keys. This module is the single source so the three lists read
 * identically in every locale.
 *
 * `t(key)` is the caller's flat-key translator (each list already imports the same
 * admin-content translations). CSS classes `.status-badge--{draft,published,archived}`
 * live in shared.css; `.status-chip` is the secondary marker.
 */
import { escapeHtml } from "./html-escape.js";

const STATUS_KEYS = {
  draft: "adminContent.lifecycle.status.draft",
  published: "adminContent.lifecycle.status.published",
  archived: "adminContent.lifecycle.status.archived",
};

// status ∈ {draft, published, archived}. opts.chipKey renders a secondary marker
// (e.g. "nyere utkast") after the badge without changing the primary status word.
export function lifecycleStatusBadge(status, t, opts = {}) {
  const key = STATUS_KEYS[status] ?? STATUS_KEYS.draft;
  const badge = `<span class="status-badge status-badge--${escapeHtml(status)}">${escapeHtml(t(key))}</span>`;
  if (!opts.chipKey) return badge;
  return `${badge} <span class="status-chip">${escapeHtml(t(opts.chipKey))}</span>`;
}

// The module library derives a richer five-state status (adminContentQueries.ts
// `deriveLibraryStatus`). Collapse it to the shared three-state primary badge, keeping the
// "published + newer unpublished draft" nuance as a secondary chip so no information is lost:
//   archived            → Arkivert
//   published           → Publisert
//   published_with_draft→ Publisert + «nyere utkast»-chip
//   unpublished_draft   → Utkast   (has versions, never published)
//   ready               → Utkast   (empty shell, no versions yet)
export function moduleLibraryStatusBadge(libraryStatus, t) {
  if (libraryStatus === "archived") return lifecycleStatusBadge("archived", t);
  if (libraryStatus === "published_with_draft") {
    return lifecycleStatusBadge("published", t, { chipKey: "adminContent.lifecycle.newerDraft" });
  }
  if (libraryStatus === "published") return lifecycleStatusBadge("published", t);
  return lifecycleStatusBadge("draft", t);
}
