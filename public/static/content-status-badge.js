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
// opts.versionChip (#1169): versjonsbrikken (`versionChipHtml`) står rett etter merket, FØR «Nyere utkast» — «Publisert · v2.1 ·
// Nyere utkast», likt i alle lister og hoder. Versjonen hører til det som er publisert.
export function lifecycleStatusBadge(status, t, opts = {}) {
  const key = STATUS_KEYS[status] ?? STATUS_KEYS.draft;
  const badge = `<span class="status-badge status-badge--${escapeHtml(status)}">${escapeHtml(t(key))}</span>${opts.versionChip ?? ""}`;
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
export function lifecycleBadge(item, t, opts = {}) {
  const lifecycle = lifecycleOf(item);
  const versionChip = opts.versionChip ?? "";
  if (lifecycle === "published_with_draft") return lifecycleStatusBadge("published", t, { chipKey: "adminContent.lifecycle.newerDraft", versionChip });
  if (lifecycle === "active") return "";
  return lifecycleStatusBadge(lifecycle, t, { versionChip });
}

/**
 * #1171: versjonen som egen brikke ved siden av merket — likt for kurs («v3.2»), modul («v2.1») og seksjon («v5»), i lista og
 * i hodet. Ingen brikke før første publisering: kalleren sender tom `label` da. `className` beholder sidens egen klasse
 * (testene og stilene leser den).
 */
export function versionChipHtml(label, { className = "", title = "" } = {}) {
  if (!label) return "";
  const cls = `status-chip version-chip${className ? ` ${className}` : ""}`;
  return ` <span class="${escapeHtml(cls)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${escapeHtml(label)}</span>`;
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
  // 2.169.0: kravet kunne ikke gjenskapes, og noen har bestått eller lest noe av det som falt ut (courseDeleteGuard.ts).
  course_requirement_unclear: "course_requirement_unclear",
  course_has_pending_reviews: "course_has_pending_reviews",
  // #1185: levert tekst uten å fullføre, under sju dager siden. `details.untilDate` er datoen kurset kan slettes fra.
  course_has_unfinished_submissions: "course_has_unfinished_submissions",
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
    // Norsk dato er lik på bokmål og nynorsk (28.11.2026). Chromium kjenner ikke «nn» og faller tilbake til amerikansk, 11/28/2026
    // (e2e for #1185); Node gjør det ikke, så enhetstesten så det ikke.
    return new Intl.DateTimeFormat(english ? locale : "nb", options).format(at);
  } catch {
    return date;
  }
}

function fill(text, vars) {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

/** Grunnen til å beholde, på brukerens språk. `locale` skriver datoen der grunnen har en (#1185). */
export function retentionReasonText(kept, t, locale) {
  const key = RETENTION_REASON_KEYS[kept?.code];
  if (!key) return t("adminContent.retention.reason.other");
  if (key === "course_has_unfinished_submissions") {
    const count = Number(kept.details?.count) || 1;
    const date = formatRetentionDate(kept.details?.untilDate, locale);
    // Uten dato ville setningen sagt «til » og stoppet; da er den generelle grunnen ærligere.
    if (!date) return t("adminContent.retention.reason.other");
    return fill(t(`adminContent.retention.reason.${key}.${count === 1 ? "one" : "other"}`), { count, date });
  }
  if (key === "course_has_completed_without_certificate" || key === "course_requirement_unclear") {
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
    const text = fill(t(`adminContent.retention.kept.${kind}`), { reason: retentionReasonText(retention.kept, t, locale) });
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
