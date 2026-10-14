import { renderWorkspaceNavigationWithProfile } from "/static/workspace-nav.js";
import { showToast } from "/static/toast.js";
import { describeApiError } from "/static/api-error.js";
import { resolveInitialLocale } from "/static/i18n-locale.js";
import { escapeHtml } from "/static/html-escape.js";
import { createDateTimeFormatter } from "/static/format-display.js";
import { localeLabels, supportedLocales, translations } from "/static/i18n/participant-activity-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";

// #1099: «Aktivitet» under Deltakere — samlet aktivitet over tid og hvem som er aktive, for alle kurs.
// Tallene regnes ut av tjeneren (GET /api/reports/activity); siden tegner dem. Det eneste siden selv
// regner, er sortering, filtrering og søk i lista.

const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const rolesInput = document.getElementById("roles");
const workspaceNav = document.getElementById("workspaceNav");
const mockRolePresetContainer = document.getElementById("mockRolePresetContainer");
const mockRolePresetSelect = document.getElementById("mockRolePreset");
const mockRolePresetHint = document.getElementById("mockRolePresetHint");
const loadMeButton = document.getElementById("loadMe");
const output = document.getElementById("output");
const debugOutputSection = document.getElementById("debugOutputSection");
const periodGroup = document.getElementById("activityPeriod");
const grainGroup = document.getElementById("activityGrain");
const departmentSelect = document.getElementById("activityDepartment");
const metaLine = document.getElementById("activityMeta");
const kpiBox = document.getElementById("activityKpis");
const peopleSub = document.getElementById("activityPeopleSub");
const eventsSub = document.getElementById("activityEventsSub");
const peopleChart = document.getElementById("activityPeopleChart");
const eventsChart = document.getElementById("activityEventsChart");
const peopleTip = document.getElementById("activityPeopleTip");
const eventsTip = document.getElementById("activityEventsTip");
const chips = document.getElementById("activityChips");
const searchInput = document.getElementById("activitySearch");
const rowsBody = document.getElementById("activityRows");
const tableHead = document.querySelector(".activity-table thead");

const TYPES = ["read", "submitted", "passed", "completed"];
const TYPE_COLOR = { read: "var(--act-read)", submitted: "var(--act-submitted)", passed: "var(--act-passed)", completed: "var(--act-completed)" };
const STATUS_ORDER = { active: 0, quiet: 1, not_started: 2 };
const DAY_MS = 24 * 60 * 60 * 1000;

let currentLocale = resolveInitialLocale(supportedLocales);
const formatDateTime = createDateTimeFormatter(() => currentLocale, "");
let participantRuntimeConfig = { authMode: "mock", navigation: { items: [] }, identityDefaults: {} };
let roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);

const ui = { period: "12", grain: "week", department: "", filter: "all", q: "", sort: "lastActivityAt", dir: "desc", open: null };
try {
  const saved = JSON.parse(localStorage.getItem("activity.view") || "{}");
  if (["4", "12", "all"].includes(saved.period)) ui.period = saved.period;
  if (["day", "week"].includes(saved.grain)) ui.grain = saved.grain;
} catch { /* ignore */ }
if (ui.period === "all" && ui.grain === "day") ui.grain = "week";

let report = null;
let requestSeq = 0;
const recentCache = new Map();

function t(key, params) {
  let text = translations[currentLocale]?.[key] ?? translations["en-GB"]?.[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

function headers() {
  return buildConsoleHeaders({
    userId: document.getElementById("userId")?.value,
    email: document.getElementById("email")?.value,
    name: document.getElementById("name")?.value,
    department: document.getElementById("department")?.value,
    roles: rolesInput?.value,
    locale: currentLocale,
  });
}

function log(data) {
  if (!output) return;
  output.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function applyTranslations() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    // #1096: bare nøkler denne bunten kjenner — `area.*` eies av content-area-nav-i18n.js.
    const text = key ? t(key) : key;
    if (key && text !== key) el.textContent = text;
  }
  if (searchInput) searchInput.placeholder = t("activity.search.placeholder");
  renderWorkspaceNavigation();
}

function populateLocaleSelect() {
  if (!localeSelect) return;
  localeSelect.innerHTML = "";
  for (const locale of supportedLocales) {
    const option = document.createElement("option");
    option.value = locale;
    option.textContent = localeLabels[locale] ?? locale;
    if (locale === currentLocale) option.selected = true;
    localeSelect.appendChild(option);
  }
}

function renderRolePresetControl() {
  if (!mockRolePresetContainer) return;
  if (!roleSwitchState.enabled) {
    mockRolePresetContainer.hidden = true;
    return;
  }
  mockRolePresetContainer.hidden = false;
  mockRolePresetSelect.innerHTML = "";
  const manual = document.createElement("option");
  manual.value = "";
  manual.textContent = t("identity.rolePresetManual");
  mockRolePresetSelect.appendChild(manual);
  for (const preset of roleSwitchState.presets) {
    const option = document.createElement("option");
    option.value = preset;
    option.textContent = preset;
    mockRolePresetSelect.appendChild(option);
  }
  mockRolePresetSelect.value = findMatchingPreset(rolesInput.value, roleSwitchState.presets);
  mockRolePresetHint.textContent = t("identity.rolePresetHint");
}

function renderWorkspaceNavigation() {
  if (!workspaceNav) return;
  const items = resolveWorkspaceNavigationItems(
    participantRuntimeConfig?.navigation?.items,
    rolesInput?.value ?? "",
    window.location.pathname,
  );
  renderWorkspaceNavigationWithProfile({
    workspaceNav,
    localePicker: document.querySelector(".locale-picker"),
    items,
    buildLabel: (item) => t(item.labelKey),
  });
}

function applyIdentityDefaults() {
  const defaults =
    participantRuntimeConfig?.identityDefaults?.reportReader ??
    participantRuntimeConfig?.identityDefaults?.contentAdmin ??
    participantRuntimeConfig?.identityDefaults ??
    null;
  if (!defaults || typeof defaults !== "object" || !defaults.userId) return;
  const set = (id, value) => { const el = document.getElementById(id); if (el && value != null) el.value = value; };
  set("userId", defaults.userId);
  set("email", defaults.email);
  set("name", defaults.name);
  set("department", defaults.department);
  if (rolesInput && Array.isArray(defaults.roles)) rolesInput.value = defaults.roles.join(",");
}

function setLocale(locale) {
  currentLocale = supportedLocales.includes(locale) ? locale : "en-GB";
  try { localStorage.setItem("participant.locale", currentLocale); } catch { /* ignore */ }
  document.documentElement.lang = currentLocale;
  applyTranslations();
}

// --- Datoer -----------------------------------------------------------------
// Tjeneren gir dag- og ukenøkler som norske kalenderdatoer (YYYY-MM-DD). De vises som dag.måned.

function keyToUtc(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function shortDate(key) {
  const [, m, d] = key.split("-");
  return `${d}.${m}`;
}

function isoWeekOfKey(key) {
  const date = keyToUtc(key);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const jan4 = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((date - jan4) / DAY_MS - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

function weekdayLabel(key) {
  try {
    return new Intl.DateTimeFormat(currentLocale, { weekday: "short", timeZone: "UTC" }).format(keyToUtc(key));
  } catch {
    return "";
  }
}

function bucketLabel(bucket) {
  return report.grain === "week" ? `${currentLocale === "en-GB" ? "wk" : currentLocale === "nn" ? "v." : "u."} ${isoWeekOfKey(bucket.from)}` : shortDate(bucket.from);
}

function bucketLong(bucket) {
  const base = report.grain === "week"
    ? t("activity.bucket.week", { week: isoWeekOfKey(bucket.from), from: shortDate(bucket.from), to: shortDate(bucket.to) })
    : `${weekdayLabel(bucket.from)} ${shortDate(bucket.from)}`;
  return bucket.partial ? `${base}, ${t("activity.bucket.partial")}` : base;
}

/** «I dag», «I går», «3 dager siden» eller datoen — og det nøyaktige tidspunktet under. */
function relative(iso) {
  if (!iso) return `<span class="dept">${escapeHtml(t("activity.rel.never"))}</span>`;
  const now = new Date();
  const then = new Date(iso);
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / DAY_MS);
  const main = days <= 0 ? t("activity.rel.today") : days === 1 ? t("activity.rel.yesterday") : days < 14 ? t("activity.rel.daysAgo", { n: days }) : formatDateTime(iso).split(",")[0];
  return `${escapeHtml(main)}<small>${escapeHtml(formatDateTime(iso))}</small>`;
}

// --- Tegning ----------------------------------------------------------------

function kpi(label, value, small, noteHtml) {
  return `<div class="activity-kpi"><span class="label">${escapeHtml(label)}</span><span class="value">${value}${small ? ` <small>${escapeHtml(small)}</small>` : ""}</span><span class="note">${noteHtml}</span></div>`;
}

function renderKpis() {
  const k = report.kpis;
  const n = report.population;
  const diff = k.active7 - k.active7Prev;
  const deltaHtml = diff === 0
    ? escapeHtml(t("activity.kpi.active7.same"))
    : `<span class="${diff > 0 ? "delta-up" : "delta-down"}">${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)}</span> ${escapeHtml(t("activity.kpi.active7.delta", { delta: "", prev: k.active7Prev }).trim())}`;
  const newly = k.started - k.startedBefore7;
  const startedNote = (newly > 0
    ? `<span class="delta-up">▲ ${newly}</span> ${escapeHtml(t("activity.kpi.started.new", { n: "" }).trim())}`
    : escapeHtml(t("activity.kpi.started.none"))) + ` · ${escapeHtml(t("activity.kpi.notStarted", { n: n - k.started }))}`;
  const e = k.events7;
  const total = TYPES.reduce((sum, type) => sum + (e[type] ?? 0), 0);
  const breakdown = TYPES.map((type) => `${e[type] ?? 0} ${t(`activity.short.${type}`)}`).join(" · ");
  kpiBox.innerHTML =
    kpi(t("activity.kpi.active7"), k.active7, "", deltaHtml) +
    kpi(t("activity.kpi.active30"), k.active30, t("activity.kpi.of", { n }), escapeHtml(t("activity.kpi.active30.share", { pct: n ? Math.round((k.active30 / n) * 100) : 0 }))) +
    kpi(t("activity.kpi.started"), k.started, t("activity.kpi.of", { n }), startedNote) +
    kpi(t("activity.kpi.events7"), total, "", escapeHtml(breakdown));
}

function niceMax(value) {
  if (value <= 5) return 5;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
}

function svgEl(tag, attrs, text) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * Felles ramme for begge grafene: akse, rutenett, etiketter og en treffsone per bøtte for
 * verktøytipset. Bredden følger elementet, så teksten har samme størrelse på telefon og PC.
 */
function drawChart(svg, tip, opts) {
  const buckets = report.buckets;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (buckets.length === 0) return;
  const W = Math.round(Math.max(300, Math.min(640, svg.clientWidth || 640)));
  const H = W < 480 ? 220 : 250;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const L = 34, Rm = 10, T = 14, B = 28;
  const pw = W - L - Rm, ph = H - T - B;
  let peak = 1;
  for (let i = 0; i < buckets.length; i++) peak = Math.max(peak, opts.peak(i));
  const max = niceMax(Math.max(opts.ceiling ?? 0, peak));
  const y = (v) => T + ph - (v / max) * ph;
  for (let s = 0; s <= 4; s++) {
    const v = (max / 4) * s;
    svg.appendChild(svgEl("line", { x1: L, x2: W - Rm, y1: y(v), y2: y(v), stroke: "var(--color-table-border)", "stroke-width": 1 }));
    svg.appendChild(svgEl("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, String(Math.round(v * 10) / 10)));
  }
  const n = buckets.length;
  const bw = pw / n;
  const gap = Math.min(6, bw * 0.25);
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(pw / 70))));
  buckets.forEach((bucket, i) => {
    if ((n - 1 - i) % every === 0) svg.appendChild(svgEl("text", { x: L + bw * i + bw / 2, y: H - 8, "text-anchor": "middle" }, bucketLabel(bucket)));
  });
  const hover = svgEl("rect", { x: 0, y: T, width: 0, height: ph, fill: "var(--color-row-selected)", visibility: "hidden" });
  svg.appendChild(hover);
  opts.draw({ svg, L, bw, gap, y, W, Rm });
  buckets.forEach((bucket, i) => {
    const hit = svgEl("rect", { x: L + bw * i, y: T, width: bw, height: ph, fill: "transparent" });
    hit.addEventListener("mouseenter", () => {
      hover.setAttribute("x", String(L + bw * i));
      hover.setAttribute("width", String(bw));
      hover.setAttribute("visibility", "visible");
      tip.innerHTML = `<b>${escapeHtml(bucketLong(bucket))}</b>${opts.tip(i)}`;
      tip.hidden = false;
      const box = svg.getBoundingClientRect();
      const card = svg.parentNode.getBoundingClientRect();
      const px = ((L + bw * i + bw / 2) / W) * box.width + box.left - card.left;
      tip.style.left = `${Math.max(8, Math.min(px - tip.offsetWidth / 2, card.width - tip.offsetWidth - 8))}px`;
      tip.style.top = `${box.top - card.top + 4}px`;
    });
    hit.addEventListener("mouseleave", () => { hover.setAttribute("visibility", "hidden"); tip.hidden = true; });
    svg.appendChild(hit);
  });
}

function renderCharts() {
  const per = report.grain === "week" ? "week" : "day";
  peopleSub.textContent = t(`activity.chart.people.sub.${per}`);
  eventsSub.textContent = t(`activity.chart.events.sub.${per}`);
  const buckets = report.buckets;
  const n = report.population;
  peopleChart.setAttribute("aria-label", `${t("activity.chart.people")}: ${t(`activity.chart.people.sub.${per}`)}`);
  eventsChart.setAttribute("aria-label", `${t("activity.chart.events")}: ${t(`activity.chart.events.sub.${per}`)}`);

  drawChart(peopleChart, peopleTip, {
    ceiling: n,
    peak: (i) => Math.max(buckets[i].active, buckets[i].startedTotal),
    draw: ({ svg, L, bw, gap, y, W, Rm }) => {
      const pts = buckets.map((b, i) => [L + bw * i + bw / 2, y(b.startedTotal)]);
      const area = `M${pts[0][0]},${y(0)} ${pts.map((p) => `L${p[0]},${p[1]}`).join(" ")} L${pts[pts.length - 1][0]},${y(0)} Z`;
      svg.appendChild(svgEl("path", { d: area, fill: "var(--color-primary-tint)" }));
      buckets.forEach((b, i) => {
        svg.appendChild(svgEl("rect", { x: L + bw * i + gap / 2, y: y(b.active), width: Math.max(1, bw - gap), height: y(0) - y(b.active), fill: "var(--color-primary)", rx: Math.min(3, bw / 4) }));
      });
      svg.appendChild(svgEl("path", { d: `M${pts.map((p) => `${p[0]},${p[1]}`).join(" L")}`, fill: "none", stroke: "var(--color-primary)", "stroke-width": 2 }));
      const last = pts[pts.length - 1];
      svg.appendChild(svgEl("circle", { cx: last[0], cy: last[1], r: 3.5, fill: "var(--color-surface)", stroke: "var(--color-primary)", "stroke-width": 2 }));
      svg.appendChild(svgEl("line", { x1: L, x2: W - Rm, y1: y(n), y2: y(n), stroke: "var(--color-meta)", "stroke-dasharray": "4 4", "stroke-width": 1 }));
      svg.appendChild(svgEl("text", { x: L + 4, y: y(n) - 5 }, t("activity.chart.population", { n })));
    },
    tip: (i) => `${escapeHtml(t("activity.tip.active", { n: buckets[i].active }))}<br>${escapeHtml(t("activity.tip.started", { n: buckets[i].startedTotal, total: n }))}`,
  });

  drawChart(eventsChart, eventsTip, {
    peak: (i) => TYPES.reduce((sum, type) => sum + buckets[i].counts[type], 0),
    draw: ({ svg, L, bw, gap, y }) => {
      buckets.forEach((b, i) => {
        let base = 0;
        for (const type of TYPES) {
          const v = b.counts[type];
          if (!v) continue;
          svg.appendChild(svgEl("rect", { x: L + bw * i + gap / 2, y: y(base + v), width: Math.max(1, bw - gap), height: y(base) - y(base + v), fill: TYPE_COLOR[type] }));
          base += v;
        }
      });
    },
    tip: (i) => TYPES.map((type) => `${escapeHtml(t(`activity.type.${type}`))}: ${buckets[i].counts[type]}`).join("<br>"),
  });
}

function spark(values) {
  const W = 96, H = 22, bw = W / values.length;
  const total = values.reduce((sum, v) => sum + v, 0);
  const bars = values.map((v, i) => {
    const h = v ? Math.min(H, 4 + (v / 4) * (H - 4)) : 1.5;
    return `<rect x="${i * bw + 1}" y="${H - h}" width="${bw - 2}" height="${h}" rx="1" fill="${v ? "var(--color-primary)" : "var(--color-table-wrap-border)"}"/>`;
  }).join("");
  return `<svg class="activity-spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(t("activity.spark.label", { n: total }))}">${bars}</svg> <span class="dept">${total}</span>`;
}

function detailHtml(person) {
  const cached = recentCache.get(person.userId);
  const title = `<p class="activity-log-title">${escapeHtml(t("activity.detail.title", { name: person.name }))}</p>`;
  if (person.status === "not_started") {
    const text = person.lastLoginAt
      ? t("activity.detail.notStartedLogin", { when: formatDateTime(person.lastLoginAt) })
      : t("activity.detail.notStartedNever");
    return `${title}<p class="dept" style="margin:0">${escapeHtml(text)}</p>`;
  }
  if (!cached || cached.state === "loading") return `${title}<p class="dept" style="margin:0">${escapeHtml(t("activity.detail.loading"))}</p>`;
  if (cached.state === "error") return `${title}<p class="dept" style="margin:0">${escapeHtml(t("activity.detail.error"))}</p>`;
  const items = cached.data.events.map((event) => {
    const what = escapeHtml(t(`activity.verb.${event.type}`, { item: event.itemTitle }));
    const course = event.courseTitle && event.type !== "completed" ? ` <span class="dept">· ${escapeHtml(event.courseTitle)}</span>` : "";
    return `<li><time datetime="${escapeHtml(event.at)}">${escapeHtml(formatDateTime(event.at))}</time><span><i class="dot" style="background:${TYPE_COLOR[event.type] ?? "var(--color-meta)"}"></i>${what}${course}</span></li>`;
  }).join("");
  return `${title}<ul class="activity-log">${items}</ul>`;
}

function renderTable() {
  const people = report.people;
  const counts = { all: people.length, active: 0, quiet: 0, not_started: 0 };
  for (const person of people) counts[person.status] += 1;
  chips.setAttribute("aria-label", t("activity.people.title"));
  chips.innerHTML = ["all", "active", "quiet", "not_started"].map((key) =>
    `<button type="button" class="activity-chip" data-f="${key}" aria-pressed="${ui.filter === key}">${escapeHtml(t(`activity.filter.${key}`))} ${counts[key]}</button>`,
  ).join("");

  const q = ui.q.trim().toLocaleLowerCase(currentLocale);
  const rows = people
    .filter((p) => (ui.filter === "all" || p.status === ui.filter) && (!q || p.name.toLocaleLowerCase(currentLocale).includes(q) || p.email.toLocaleLowerCase(currentLocale).includes(q)))
    .sort((a, b) => {
      const value = (p) => {
        if (ui.sort === "status") return STATUS_ORDER[p.status];
        if (TYPES.includes(ui.sort)) return p.counts[ui.sort];
        if (ui.sort === "lastActivityAt" || ui.sort === "lastLoginAt") return p[ui.sort] ? Date.parse(p[ui.sort]) : -1;
        return (p[ui.sort] ?? "").toString();
      };
      const va = value(a), vb = value(b);
      let c = typeof va === "string" ? va.localeCompare(vb, currentLocale) : va - vb;
      if (c === 0) c = a.name.localeCompare(b.name, currentLocale) * (ui.dir === "asc" ? 1 : -1);
      return ui.dir === "asc" ? c : -c;
    });

  for (const button of tableHead.querySelectorAll("button[data-k]")) {
    const th = button.closest("th");
    const on = button.dataset.k === ui.sort;
    th.setAttribute("aria-sort", on ? (ui.dir === "asc" ? "ascending" : "descending") : "none");
    button.dataset.dir = on ? ui.dir : "";
    button.textContent = t(button.getAttribute("data-i18n")) + (on ? (ui.dir === "asc" ? " ▴" : " ▾") : "");
  }

  const label = (key) => escapeHtml(t(key));
  rowsBody.innerHTML = rows.map((p) => {
    const open = ui.open === p.userId;
    let html = `<tr class="person" tabindex="0" data-id="${escapeHtml(p.userId)}" aria-expanded="${open}">` +
      `<td class="who" data-label="${label("activity.col.name")}"><span>${escapeHtml(p.name)}<small>${escapeHtml(p.email)}</small></span></td>` +
      `<td data-label="${label("activity.col.department")}"><span class="dept">${escapeHtml(p.department ?? "")}</span></td>` +
      `<td data-label="${label("activity.col.status")}"><span class="activity-pill ${p.status}">${label(`activity.status.${p.status}`)}</span></td>` +
      `<td class="when" data-label="${label("activity.col.lastActivity")}"><span>${relative(p.lastActivityAt)}</span></td>` +
      `<td class="when" data-label="${label("activity.col.lastLogin")}"><span>${relative(p.lastLoginAt)}</span></td>` +
      `<td class="spark-cell" data-label="${label("activity.col.spark")}"><span>${spark(p.activeDaysByWeek)}</span></td>` +
      TYPES.map((type) => `<td class="num" data-label="${label(`activity.col.${type}`)}">${p.counts[type]}</td>`).join("") +
      `</tr>`;
    if (open) html += `<tr class="activity-detail"><td colspan="10" data-label="">${detailHtml(p)}</td></tr>`;
    return html;
  }).join("");
  if (rows.length === 0) {
    rowsBody.innerHTML = `<tr><td colspan="10" data-label="" class="small">${label(people.length ? "activity.empty.filter" : "activity.empty.none")}</td></tr>`;
  }
}

function renderDepartments() {
  const departments = report?.departments ?? [];
  departmentSelect.innerHTML =
    `<option value="">${escapeHtml(t("activity.department.all"))}</option>` +
    departments.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
  departmentSelect.value = departments.includes(ui.department) ? ui.department : "";
}

function renderControls() {
  for (const button of periodGroup.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.v === ui.period));
  for (const button of grainGroup.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.v === ui.grain));
}

function render() {
  renderControls();
  if (!report) return;
  renderDepartments();
  renderKpis();
  renderCharts();
  renderTable();
  metaLine.textContent = `${t("activity.generatedAt")}: ${formatDateTime(report.generatedAt)}`;
}

async function loadReport() {
  const seq = ++requestSeq;
  const params = new URLSearchParams({ period: ui.period, grain: ui.grain });
  if (ui.department) params.set("department", ui.department);
  try {
    const data = await apiFetch(`/api/reports/activity?${params.toString()}`, headers);
    // ⚠️ Et svar på et eldre valg skal ikke skrive over et nyere (rask veksling mellom periodene).
    if (seq !== requestSeq) return;
    if (!data || !data.kpis || !Array.isArray(data.people) || !Array.isArray(data.buckets)) throw new Error(t("activity.error"));
    report = data;
    log(data);
    render();
  } catch (error) {
    if (seq !== requestSeq) return;
    // Knappene skal vise valget tallene faktisk gjelder, ikke det som feilet.
    if (report) {
      ui.period = report.period ?? ui.period;
      ui.grain = report.grain ?? ui.grain;
      ui.department = report.department ?? "";
      renderControls();
      renderDepartments();
    }
    showToast(describeApiError(error, t).headline || t("activity.error"), "error");
  }
}

async function loadRecent(userId) {
  // ⚠️ Et svar som kommer etter et språkbytte (eller etter at mellomlageret er tømt) tilhører en
  // henting som ikke lenger gjelder. Uten merket ville titlene på det gamle språket blitt stående.
  const token = {};
  recentCache.set(userId, { state: "loading", token });
  let next;
  try {
    const data = await apiFetch(`/api/reports/activity/users/${encodeURIComponent(userId)}/recent`, headers);
    next = { state: "ready", data, token };
  } catch {
    next = { state: "error", token };
  }
  if (recentCache.get(userId)?.token !== token) return;
  recentCache.set(userId, next);
  if (ui.open === userId && report) renderTable();
}

function toggleRow(userId) {
  ui.open = ui.open === userId ? null : userId;
  if (ui.open) {
    const person = report?.people.find((p) => p.userId === ui.open);
    // En feil hentes på nytt neste gang raden åpnes, i stedet for å bli liggende til sida lastes på nytt.
    const cached = recentCache.get(ui.open);
    if (person && person.status !== "not_started" && (!cached || cached.state === "error")) void loadRecent(ui.open);
  }
  renderTable();
  const again = Array.from(rowsBody.querySelectorAll("tr.person")).find((tr) => tr.dataset.id === userId);
  again?.focus();
}

function saveView() {
  try { localStorage.setItem("activity.view", JSON.stringify({ period: ui.period, grain: ui.grain })); } catch { /* ignore */ }
}

// --- Bootstrap --------------------------------------------------------------

async function init() {
  try {
    participantRuntimeConfig = await getConsoleConfig();
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  } catch {
    participantRuntimeConfig = { authMode: "mock", navigation: { items: [] }, identityDefaults: {} };
  }
  document.body.classList.toggle("auth-entra", roleSwitchState.authMode === "entra");
  populateLocaleSelect();
  applyIdentityDefaults();
  renderRolePresetControl();

  if (roleSwitchState.authMode === "entra") {
    try {
      const me = await apiFetch("/api/me", headers);
      if (Array.isArray(me?.user?.roles) && me.user.roles.length > 0) rolesInput.value = me.user.roles.join(",");
    } catch { /* nav renders with identity defaults */ }
  }

  applyTranslations();
  renderControls();
  await initConsentGuard(headers, currentLocale);

  try {
    const body = await apiFetch("/version", { headers: {} });
    if (appVersionLabel) appVersionLabel.textContent = `v${body.version ?? "unknown"}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }

  await loadReport();
}

periodGroup?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-v]");
  if (!button || button.dataset.v === ui.period) return;
  ui.period = button.dataset.v;
  // Hele perioden per dag gir hundrevis av søyler; da telles per uke.
  if (ui.period === "all" && ui.grain === "day") ui.grain = "week";
  saveView();
  renderControls();
  void loadReport();
});
grainGroup?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-v]");
  if (!button || button.dataset.v === ui.grain) return;
  ui.grain = button.dataset.v;
  if (ui.grain === "day" && ui.period === "all") ui.period = "12";
  saveView();
  renderControls();
  void loadReport();
});
departmentSelect?.addEventListener("change", () => {
  ui.department = departmentSelect.value;
  ui.open = null;
  void loadReport();
});
chips?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-f]");
  if (!button || !report) return;
  ui.filter = button.dataset.f;
  renderTable();
});
searchInput?.addEventListener("input", () => {
  ui.q = searchInput.value;
  if (report) renderTable();
});
tableHead?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-k]");
  if (!button || !report) return;
  const key = button.dataset.k;
  if (ui.sort === key) ui.dir = ui.dir === "asc" ? "desc" : "asc";
  else { ui.sort = key; ui.dir = key === "name" || key === "department" || key === "status" ? "asc" : "desc"; }
  renderTable();
});
rowsBody?.addEventListener("click", (event) => {
  const row = event.target.closest("tr.person");
  if (row) toggleRow(row.dataset.id);
});
rowsBody?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest("tr.person");
  if (!row) return;
  event.preventDefault();
  toggleRow(row.dataset.id);
});

let resizeTimer = null;
let lastWidth = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const width = peopleChart?.clientWidth ?? 0;
    if (report && Math.abs(width - lastWidth) > 20) { lastWidth = width; renderCharts(); }
  }, 150);
});

localeSelect?.addEventListener("change", () => {
  setLocale(localeSelect.value);
  // Titlene i «det siste hen har gjort» er lokalisert av tjeneren; hent dem på nytt på det nye språket.
  recentCache.clear();
  if (ui.open && report) {
    const person = report.people.find((p) => p.userId === ui.open);
    if (person && person.status !== "not_started") void loadRecent(ui.open);
  }
  render();
});
mockRolePresetSelect?.addEventListener("change", () => {
  if (!mockRolePresetSelect.value || !roleSwitchState.enabled) return;
  rolesInput.value = mockRolePresetSelect.value;
  renderWorkspaceNavigation();
});
rolesInput?.addEventListener("input", () => {
  mockRolePresetSelect.value = findMatchingPreset(rolesInput.value, roleSwitchState.presets) ?? "";
  renderWorkspaceNavigation();
});
loadMeButton?.addEventListener("click", async () => {
  try { log(await apiFetch("/api/me", headers)); } catch (error) { log(describeApiError(error, t).headline); }
});
if (debugOutputSection) debugOutputSection.hidden = new URLSearchParams(window.location.search).get("debug") !== "1";

void init();
