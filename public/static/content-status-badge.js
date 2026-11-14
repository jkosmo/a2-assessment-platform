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

// ---------------------------------------------------------------------------
// #1152 skive 4b (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Hva forfatteren ser»): under «Arkiverte» i kurslista,
// modulbiblioteket og seksjonslista står en linje under statusmerket: «Slettes 13.05.2027» eller «Beholdes: <grunn>».
// Tjeneren sender `retention` bare på arkiverte rader (src/modules/content/archivedRetention.ts):
//   { deletesAt: "YYYY-MM-DD" } · { kept: { code, details } } · { unknown: true }
// «Ukjent» (overgangsraden mangler) viser ingenting: lista sier aldri en dato den ikke vet.
// Grunnen slås opp på koden, samme kode som «Slett» svarer med. En kode uten tekst får den generelle («kan ikke slettes nå»).
// ---------------------------------------------------------------------------

const RETENTION_REASON_KEYS = {
  course_has_completions: "course_has_completions",
  course_has_completed_without_certificate: "course_has_completed_without_certificate",
  course_has_pending_reviews: "course_has_pending_reviews",
  module_has_submissions: "module_has_submissions",
  module_has_certification: "module_has_certification",
  content_in_issued_certificate: "content_in_issued_certificate",
  // Bevis utstedt før øyeblikksbildet: samme grunn for forfatteren.
  content_in_legacy_certificate: "content_in_issued_certificate",
  content_in_archived_course: "content_in_archived_course",
  // Et arkivert element i et aktivt kurs (sjeldent): modul og seksjon har hver sin kode for det.
  content_in_use: "content_in_use",
  module_in_use: "content_in_use",
  delete_blocked_by_course_draft: "delete_blocked_by_course_draft",
};

/** Datoen slik listene skriver den: 13.05.2027 på norsk, 13 May 2027 på engelsk. `date` er en kalenderdato (YYYY-MM-DD). */
export function formatRetentionDate(date, locale) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  if (!match) return "";
  // Kalenderdatoen, ikke et tidspunkt: formateres i UTC, så den ikke flytter seg en dag i nettleserens tidssone.
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const english = String(locale ?? "").startsWith("en");
  const options = english
    ? { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
    : { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" };
  try {
    return new Intl.DateTimeFormat(locale || "nb", options).format(at);
  } catch {
    return date;
  }
}

function fill(text, vars) {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

/** Grunnen til å beholde, på brukerens språk. */
export function retentionReasonText(kept, t) {
  const key = RETENTION_REASON_KEYS[kept?.code];
  if (!key) return t("adminContent.retention.reason.other");
  if (key === "course_has_completed_without_certificate") {
    const count = Number(kept.details?.count) || 1;
    return fill(t(`adminContent.retention.reason.${key}.${count === 1 ? "one" : "other"}`), { count });
  }
  return t(`adminContent.retention.reason.${key}`);
}

/**
 * Linja under statusmerket for en arkivert rad. `kind` er "course", "module" eller "section" (nynorsk bøyer «behalde» etter
 * kjønnet). Tom streng for en rad som ikke er arkivert, uten `retention`, eller med «ukjent».
 */
export function retentionLineHtml(item, kind, t, locale) {
  if (lifecycleOf(item) !== "archived") return "";
  const retention = item?.retention;
  if (!retention || typeof retention !== "object") return "";
  if (typeof retention.deletesAt === "string") {
    const date = formatRetentionDate(retention.deletesAt, locale);
    if (!date) return "";
    const text = fill(t("adminContent.retention.deletesAt"), { date });
    return `<span class="retention-line" data-retention="deletes">${escapeHtml(text)}</span>`;
  }
  if (retention.kept && typeof retention.kept === "object") {
    const text = fill(t(`adminContent.retention.kept.${kind}`), { reason: retentionReasonText(retention.kept, t) });
    return `<span class="retention-line" data-retention="kept" data-retention-code="${escapeHtml(retention.kept.code ?? "")}">${escapeHtml(text)}</span>`;
  }
  return "";
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
