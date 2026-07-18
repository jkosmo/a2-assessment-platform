// #767: sub-navigation for the «Mine kurs» area (Pågående | Fullførte). Both sub-tabs share the exact
// same roles (PARTICIPANT/ADMINISTRATOR/REVIEWER), so — unlike the «Deltakere» sub-nav — no role-gating
// is needed here; this only marks the active tab by pathname. Self-contained: drop a `#mineKursSubnav`
// bar + this one script tag into a page. NB: `/participant` is a prefix of `/participant/completed`, so
// the more specific path is matched first.

const ACTIVE_BY_PREFIX = [
  ["/participant/completed", "subnavFullforte"],
  ["/participant", "subnavPagaende"],
];

function markActive(nav) {
  const path = window.location.pathname;
  for (const [prefix, id] of ACTIVE_BY_PREFIX) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      nav.querySelector(`#${id}`)?.classList.add("active");
      return; // first (most specific) match wins
    }
  }
}

function initMineKursSubnav() {
  const nav = document.getElementById("mineKursSubnav");
  if (nav) markActive(nav);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMineKursSubnav);
} else {
  initMineKursSubnav();
}
