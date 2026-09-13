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

// ---------------------------------------------------------------------------
// #1046 steg B: tjeneren leverer `lifecycle` på alle fire listene (modul, kurs, seksjon, klasse):
//   draft · published · published_with_draft · archived   (innhold)
//   active · archived                                     (klasser)
// Klienten regner ikke ut tilstand lenger; den leser ordet. Én reserve for gamle svar uten feltet
// (og for testers mock-data) ligger her — ETT sted, ikke ett per side. Fjernes når ingen sender
// gamle svar.
// ---------------------------------------------------------------------------

export function lifecycleOf(item) {
  if (item?.lifecycle) return item.lifecycle;
  if (item?.archivedAt) return "archived";
  if (typeof item?.status === "string") {
    // Modulbibliotekets gamle femverdi-felt.
    if (item.status === "published" || item.status === "published_with_draft" || item.status === "archived") return item.status;
    return "draft";
  }
  if (item && "activeVersionId" in item) return item.activeVersionId ? "published" : "draft";
  if (item && "publishedAt" in item) return item.publishedAt ? "published" : "draft";
  return "active";
}

/** Merket for en rad, med «Nyere utkast»-brikken når det finnes en versjon nyere enn den som er live. */
export function lifecycleBadge(item, t) {
  const lifecycle = lifecycleOf(item);
  if (lifecycle === "published_with_draft") return lifecycleStatusBadge("published", t, { chipKey: "adminContent.lifecycle.newerDraft" });
  if (lifecycle === "active") return "";
  return lifecycleStatusBadge(lifecycle, t);
}

/**
 * Filterknappenes regel, én gang for alle listene:
 *   all → alt · active → ikke arkivert · archived → arkivert
 *   published → live (med eller uten nyere utkast) · unpublished_draft → har et utkast som ikke er live
 */
export function matchesLifecycleFilter(item, key) {
  const lifecycle = lifecycleOf(item);
  if (key === "all") return true;
  if (key === "archived") return lifecycle === "archived";
  if (key === "active") return lifecycle !== "archived";
  if (key === "published") return lifecycle === "published" || lifecycle === "published_with_draft";
  if (key === "unpublished_draft") return lifecycle === "draft" || lifecycle === "published_with_draft";
  return true;
}
