import { getConsoleConfig, buildConsoleHeaders, apiFetch } from "/static/api-client.js";

// #765: role-gated sub-navigation for the «Deltakere» area (Klasser | Manuell behandling | Resultater).
// Self-contained so it can drop into all three pages (classes / review / results) via a single script
// tag + a `#deltakereSubnav` bar, without touching each page's own bundle. It resolves the signed-in
// user's roles the same way the console pages do, removes the sub-tabs the user cannot access, and
// marks the active tab by pathname. Fail-open (leave every link visible) if role resolution fails, so
// navigation is never lost.

const LINK_ROLES = {
  subnavKlasser: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"],
  subnavReview: ["REVIEWER", "APPEAL_HANDLER", "ADMINISTRATOR"],
  subnavResults: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR", "REPORT_READER"],
};

const ACTIVE_BY_PREFIX = [
  ["/deltakere/klasser", "subnavKlasser"],
  ["/review", "subnavReview"],
  ["/results", "subnavResults"],
];

async function resolveRoles() {
  try {
    const cfg = await getConsoleConfig();
    const defaults = cfg?.identityDefaults?.contentAdmin ?? cfg?.identityDefaults ?? {};
    const headers = buildConsoleHeaders({
      userId: defaults.userId,
      email: defaults.email,
      name: defaults.name,
      roles: Array.isArray(defaults.roles) ? defaults.roles.join(",") : defaults.roles,
    });
    const me = await apiFetch("/api/me", () => headers);
    const liveRoles = Array.isArray(me?.user?.roles) ? me.user.roles : [];
    if (liveRoles.length > 0) return liveRoles;
    return Array.isArray(defaults.roles) ? defaults.roles : null;
  } catch {
    return null; // fail-open
  }
}

function markActive(nav) {
  const path = window.location.pathname;
  for (const [prefix, id] of ACTIVE_BY_PREFIX) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      nav.querySelector(`#${id}`)?.classList.add("active");
    }
  }
}

async function initDeltakereSubnav() {
  const nav = document.getElementById("deltakereSubnav");
  if (!nav) return;
  markActive(nav);

  const roles = await resolveRoles();
  if (!roles) return; // fail-open: leave all links visible
  const roleSet = new Set(roles);
  for (const [id, allowed] of Object.entries(LINK_ROLES)) {
    if (!allowed.some((role) => roleSet.has(role))) {
      nav.querySelector(`#${id}`)?.remove();
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDeltakereSubnav);
} else {
  void initDeltakereSubnav();
}
