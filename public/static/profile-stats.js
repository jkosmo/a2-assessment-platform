// #1138: «Statistikk» på profilen — båten, de fire siste ukene, søylene for tolv uker og totalene.
//
// Bare for brukeren selv. Tallene og humøret kommer ferdig fra `GET /api/me/stats`; denne fila tegner.
// Humøret avgjøres på serveren (`src/modules/gamification/boatMood.ts`), ikke her, så profilen, den
// ukentlige e-posten (#1139) og maskoten aldri kan være uenige.
//
// Bildene er båtbildene fra e-postene (2.138.0), servert fra `/static/boat/`. Ingen nye bilder.
// Bildet er pynt (alt=""): linja ved siden av sier det samme med ord.

import { escapeHtml } from "/static/html-escape.js";

/** Humør → bilde og linje. Et humør serveren ikke kjenner (for eksempel «anker» fra #1139) faller til «mett». */
export const MOOD_VIEW = {
  mett: { image: "vurdering-bestatt.jpg", lineKey: "profile.stats.mood.mett" },
  sulten: { image: "frist-snart.jpg", lineKey: "profile.stats.mood.sulten" },
  // Havblikk er stillstand: båten ved kaia med slakke seil. Ikke «ikke bestått», som viser motvind (produkteier
  // 2026-11-07). Deler bilde med «dramatisk» til egne bilder kommer i runden om båtsymbolikken.
  sur: { image: "frist-forfalt.jpg", lineKey: "profile.stats.mood.sur" },
  dramatisk: { image: "frist-forfalt.jpg", lineKey: "profile.stats.mood.dramatisk" },
  ny: { image: "kurs-tildelt.jpg", lineKey: "profile.stats.mood.ny" },
};

export function moodView(mood) {
  return MOOD_VIEW[mood] ?? MOOD_VIEW.mett;
}

/** ISO-ukenummeret til en dato (YYYY-MM-DD). */
export function isoWeekNumber(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3); // torsdagen i samme uke avgjør året
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

/** «ca. 1 t 36 min», «ca. 12 min», «0 min». */
export function formatReadingTime(minutes, t) {
  const total = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0;
  if (total === 0) return t("profile.stats.minutes").replace("{m}", "0");
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const parts = [];
  if (hours > 0) parts.push(t("profile.stats.hours").replace("{h}", String(hours)));
  if (rest > 0) parts.push(t("profile.stats.minutes").replace("{m}", String(rest)));
  return t("profile.stats.approx").replace("{v}", parts.join(" "));
}

function formatWeekRange(week, locale) {
  const from = new Date(`${week.from}T12:00:00Z`);
  const to = new Date(`${week.to}T12:00:00Z`);
  try {
    const format = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
    return typeof format.formatRange === "function" ? format.formatRange(from, to) : `${format.format(from)} – ${format.format(to)}`;
  } catch {
    return `${week.from} – ${week.to}`;
  }
}

function formatCount(value, locale) {
  try {
    return new Intl.NumberFormat(locale).format(Number(value) || 0);
  } catch {
    return String(Number(value) || 0);
  }
}

function weekSummary(week, t, locale) {
  const label = t("profile.stats.week").replace("{n}", String(isoWeekNumber(week.from)));
  return [
    label,
    `${t("profile.stats.sectionsRead")}: ${formatCount(week.sectionsRead, locale)}`,
    `${t("profile.stats.modulesPassed")}: ${formatCount(week.modulesPassed, locale)}`,
    `${t("profile.stats.coursesCompleted")}: ${formatCount(week.coursesCompleted, locale)}`,
    `${t("profile.stats.readingTime")}: ${formatReadingTime(week.readingMinutes, t)}`,
  ].join(" · ");
}

function figure(value, label) {
  return `<div class="stats-figure"><span class="stats-figure-value">${escapeHtml(value)}</span><span class="stats-figure-label">${escapeHtml(label)}</span></div>`;
}

/**
 * Tegner statistikken inn i `container`.
 * @param {HTMLElement} container
 * @param {object} stats svaret fra /api/me/stats
 * @param {{ t: (key: string) => string, locale: string }} options
 */
export function renderStats(container, stats, { t, locale }) {
  const view = moodView(stats?.mood);
  const weeks = Array.isArray(stats?.weeks) ? stats.weeks : [];
  const recent = stats?.recent ?? {};
  const totals = stats?.totals ?? {};
  const n = (value) => formatCount(value, locale);

  const peak = Math.max(1, ...weeks.map((w) => (Number(w.sectionsRead) || 0) + (Number(w.modulesPassed) || 0)));
  const height = (value) => `max(4px, calc(${((Number(value) || 0) / peak) * 100}% - 2px))`;

  const columns = weeks.map((week) => {
    const sections = Number(week.sectionsRead) || 0;
    const modules = Number(week.modulesPassed) || 0;
    const courses = Number(week.coursesCompleted) || 0;
    const topIsSections = sections > 0;
    const sectionBar = sections > 0
      ? `<span class="stats-bar stats-bar-sections${topIsSections ? " is-top" : ""}" style="height:${height(sections)}"></span>`
      : "";
    const moduleBar = modules > 0
      ? `<span class="stats-bar stats-bar-modules${topIsSections ? "" : " is-top"}" style="height:${height(modules)}"></span>`
      : "";
    const dot = courses > 0 ? `<span class="stats-dot"></span>` : "";
    return `<div class="stats-col${week.partial ? " is-current" : ""}" data-week="${escapeHtml(week.from)}" title="${escapeHtml(weekSummary(week, t, locale))}">${dot}${sectionBar}${moduleBar}</div>`;
  }).join("");

  const axis = weeks.map((week) =>
    `<span class="stats-axis-label${week.partial ? " is-current" : ""}">${escapeHtml(t("profile.stats.weekShort").replace("{n}", String(isoWeekNumber(week.from))))}</span>`,
  ).join("");

  const tableRows = weeks.map((week) => `<tr>
      <th scope="row">${escapeHtml(t("profile.stats.week").replace("{n}", String(isoWeekNumber(week.from))))}, ${escapeHtml(formatWeekRange(week, locale))}</th>
      <td>${escapeHtml(n(week.sectionsRead))}</td>
      <td>${escapeHtml(n(week.modulesPassed))}</td>
      <td>${escapeHtml(n(week.coursesCompleted))}</td>
      <td>${escapeHtml(formatReadingTime(week.readingMinutes, t))}</td>
    </tr>`).join("");

  container.innerHTML = `
    <div class="stats-hero" data-mood="${escapeHtml(stats?.mood ?? "")}">
      <img class="stats-boat" src="/static/boat/${escapeHtml(view.image)}" alt="" width="600" height="200" />
      <div class="stats-hero-text">
        <p class="stats-line" id="statsMoodLine">${escapeHtml(t(view.lineKey))}</p>
        <h3 class="stats-kicker">${escapeHtml(t("profile.stats.recentTitle"))}</h3>
        <div class="stats-figures stats-figures-recent">
          ${figure(n(recent.sectionsRead), t("profile.stats.sectionsRead.lower"))}
          ${figure(n(recent.modulesPassed), t("profile.stats.modulesPassed.lower"))}
          ${figure(n(recent.coursesCompleted), t("profile.stats.coursesCompleted.lower"))}
          ${figure(formatReadingTime(recent.readingMinutes, t), t("profile.stats.readingTime.lower"))}
        </div>
      </div>
    </div>
    <div class="stats-weeks">
      <div class="stats-weeks-head">
        <h3 class="stats-heading">${escapeHtml(t("profile.stats.weeksTitle"))}</h3>
        <div class="stats-legend" aria-hidden="true">
          <span class="stats-legend-item"><span class="stats-swatch stats-swatch-sections"></span>${escapeHtml(t("profile.stats.sectionsRead"))}</span>
          <span class="stats-legend-item"><span class="stats-swatch stats-swatch-modules"></span>${escapeHtml(t("profile.stats.modulesPassed"))}</span>
          <span class="stats-legend-item"><span class="stats-swatch stats-swatch-courses"></span>${escapeHtml(t("profile.stats.coursesCompleted"))}</span>
        </div>
      </div>
      <div class="stats-chart" aria-hidden="true">${columns}</div>
      <div class="stats-axis" aria-hidden="true">${axis}</div>
      <div class="sr-only">
      <table class="stats-table">
        <caption>${escapeHtml(t("profile.stats.tableCaption"))}</caption>
        <thead><tr>
          <th scope="col">${escapeHtml(t("profile.stats.weekColumn"))}</th>
          <th scope="col">${escapeHtml(t("profile.stats.sectionsRead"))}</th>
          <th scope="col">${escapeHtml(t("profile.stats.modulesPassed"))}</th>
          <th scope="col">${escapeHtml(t("profile.stats.coursesCompleted"))}</th>
          <th scope="col">${escapeHtml(t("profile.stats.readingTime"))}</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      </div>
    </div>
    <div class="stats-totals">
      <h3 class="stats-heading">${escapeHtml(t("profile.stats.totalsTitle"))}</h3>
      <div class="stats-figures stats-figures-totals">
        ${figure(n(totals.coursesCompleted), t("profile.stats.coursesCompleted.lower"))}
        ${figure(n(totals.modulesPassed), t("profile.stats.modulesPassed.lower"))}
        ${figure(n(totals.sectionsRead), t("profile.stats.sectionsRead.lower"))}
      </div>
    </div>
    <p class="stats-private small">${escapeHtml(t("profile.stats.private"))}</p>`;
}
