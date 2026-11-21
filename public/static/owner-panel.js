// #787 slice 5: reusable content-owner management panel. Renders the current owner set + a search-to-
// add box + per-owner remove, calling /api/admin/content-owners. Drop into any content surface with a
// container element, the contentType (COURSE|SECTION|CLASS|MODULE), the contentId, and the page's
// getHeaders. Inert with respect to editing — this only manages who owns the object (enforcement is a
// separate concern wired onto the write/delete paths).

import { apiFetch } from "/static/api-client.js";
import { escapeHtml } from "/static/html-escape.js";
import { showToast } from "/static/toast.js";
import { describeApiError } from "/static/api-error.js";

function ownersPath(contentType, contentId) {
  return `/api/admin/content-owners/${contentType}/${encodeURIComponent(contentId)}`;
}

// #972/#965: dette var en FEMTE halve oversetter, og den plukket ut `parsed.message` — serverens
// engelske setning. Panelet er nettopp der eierskapsfeilene oppstår (`last_owner`,
// `owner_not_found`, `content_ownership`), så det var her en norsk forfatter fikk «You cannot
// remove the last owner.» Nå slås KODEN opp i den delte tabellen i api-error.js.
//
// `t` kommer fra siden som monterer panelet — panelet har ingen egen i18n-bunt. Uten `t` faller
// oversetteren tilbake på kallstedets `fallback`, som før.
function errorMessage(error, fallback, t) {
  const { headline } = describeApiError(error, t);
  return headline || fallback;
}

export async function renderOwnerPanel({ container, contentType, contentId, getHeaders, t }) {
  // #1173: panelets egne ord sto på bokmål uansett språk — «Eiere», «Endre eiere», «Fjern» på en engelsk
  // side. Alle fire sidene som monterer panelet sender sin `t` (admin-buntens `owners.*`).
  const tr = typeof t === "function" ? t : (key) => key;
  let owners = [];
  let canManage = false; // only owners/admin may change owners; everyone with access can view
  // Ownership is mostly read, rarely edited — so the panel is a compact one-line summary by default and
  // only expands into the full add/remove UI when the user chooses to edit.
  let expanded = false;
  container.innerHTML = `<div class="owner-panel"><p class="owner-panel-loading">${escapeHtml(tr("owners.loading"))}</p></div>`;

  async function load() {
    const data = await apiFetch(ownersPath(contentType, contentId), getHeaders);
    owners = Array.isArray(data.owners) ? data.owners : [];
    canManage = data.canManage === true;
  }

  function paint() {
    if (!expanded) {
      paintCompact();
      return;
    }
    container.classList.remove("owner-host--compact");
    container.style.padding = "";
    const rows = owners.length
      ? owners
          .map(
            (o) => `<li class="owner-row">
        <span class="owner-name">${escapeHtml(o.name)}</span>
        <span class="owner-email">${escapeHtml(o.email)}</span>
        ${canManage ? `<button type="button" class="owner-remove btn-secondary" data-user-id="${escapeHtml(o.userId)}">${escapeHtml(tr("owners.remove"))}</button>` : ""}
      </li>`,
          )
          .join("")
      : `<li class="owner-empty">${escapeHtml(tr("owners.none"))}</li>`;
    const addBox = canManage
      ? `<div class="owner-add">
          <input type="text" class="owner-search-input" placeholder="${escapeHtml(tr("owners.searchPlaceholder"))}" aria-label="${escapeHtml(tr("owners.searchAria"))}" autocomplete="off" />
          <ul class="owner-search-results" hidden></ul>
        </div>`
      : "";
    container.innerHTML = `
      <div class="owner-panel">
        <div class="owner-panel-head">
          <h3 class="owner-panel-title">${escapeHtml(tr("owners.title"))}</h3>
          <button type="button" class="owner-collapse">${escapeHtml(tr("owners.done"))}</button>
        </div>
        <ul class="owner-list">${rows}</ul>
        ${addBox}
      </div>`;
    wire();
  }

  // Compact default: "Eiere: Name A, Name B" on one line, plus an inline "Endre eiere" affordance
  // for those who can manage. Keeps the panel to a slim strip since it's shown far more than edited.
  //
  // The label says "Endre eiere", not "Rediger" (stage-tilbakemelding 2026-08-16). On the module
  // workspace "Rediger" is the name of a TAB, so a second control with the same word a few
  // centimetres below it read as a way back to that tab. A verb plus its object costs three
  // characters and removes the question.
  function paintCompact() {
    // Slim the host card down to a strip while compact (QA r5/r6 #1): the host brings .card/.detail-section
    // padding meant for full sections. Page-level styles load after shared.css and win the cascade at equal
    // specificity (bit us on the courses page), so set the padding inline — inline always wins.
    container.classList.add("owner-host--compact");
    container.style.padding = "6px 16px";
    const names = owners.length
      ? // Same-name owners are distinct users (e.g. mock + Entra identity) — expose the email in a
        // tooltip so "Joakim Kosmo, Joakim Kosmo" is explainable at a glance.
        owners.map((o) => `<span title="${escapeHtml(o.email)}">${escapeHtml(o.name)}</span>`).join(", ")
      : `<span class="owner-none">${escapeHtml(tr("owners.noneShort"))}</span>`;
    container.innerHTML = `
      <div class="owner-panel owner-panel--compact">
        <span class="owner-compact-label">${escapeHtml(tr("owners.title"))}</span>
        <span class="owner-compact-names">${names}</span>
        ${canManage ? `<button type="button" class="owner-edit-toggle">${escapeHtml(tr("owners.edit"))}</button>` : ""}
      </div>`;
    container.querySelector(".owner-edit-toggle")?.addEventListener("click", () => {
      expanded = true;
      paint();
    });
  }

  function wire() {
    container.querySelector(".owner-collapse")?.addEventListener("click", () => {
      expanded = false;
      paint();
    });
    for (const btn of container.querySelectorAll(".owner-remove")) {
      btn.addEventListener("click", () => removeOwner(btn.dataset.userId));
    }
    const input = container.querySelector(".owner-search-input");
    const results = container.querySelector(".owner-search-results");
    let timer;
    input?.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) {
        results.hidden = true;
        results.innerHTML = "";
        return;
      }
      timer = setTimeout(() => search(q, results), 250);
    });
    results?.addEventListener("click", (event) => {
      const li = event.target.closest("li[data-user-id]");
      if (li) addOwner(li.dataset.userId);
    });
  }

  async function search(q, results) {
    try {
      const data = await apiFetch(`/api/admin/content/users/search?q=${encodeURIComponent(q)}`, getHeaders);
      const matches = (Array.isArray(data.users) ? data.users : []).filter((u) => !owners.some((o) => o.userId === u.id));
      results.innerHTML = matches.length
        ? matches
            .map(
              (u) => `<li data-user-id="${escapeHtml(u.id)}"><span class="owner-name">${escapeHtml(u.name)}</span> <span class="owner-email">${escapeHtml(u.email)}</span></li>`,
            )
            .join("")
        : `<li class="owner-empty">${escapeHtml(tr("owners.noMatches"))}</li>`;
      results.hidden = false;
    } catch {
      results.hidden = true;
    }
  }

  async function addOwner(userId) {
    try {
      const data = await apiFetch(ownersPath(contentType, contentId), getHeaders, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      owners = Array.isArray(data.owners) ? data.owners : owners;
      showToast(tr("owners.added"));
      paint();
    } catch (error) {
      showToast(errorMessage(error, tr("owners.addFailed"), t), "error");
    }
  }

  async function removeOwner(userId) {
    try {
      const data = await apiFetch(`${ownersPath(contentType, contentId)}/${encodeURIComponent(userId)}`, getHeaders, {
        method: "DELETE",
      });
      owners = Array.isArray(data.owners) ? data.owners : owners;
      showToast(tr("owners.removed"));
      paint();
    } catch (error) {
      showToast(errorMessage(error, tr("owners.removeFailed"), t), "error");
    }
  }

  try {
    await load();
    paint();
  } catch {
    container.innerHTML = `<div class="owner-panel"><p class="owner-panel-error">${escapeHtml(tr("owners.loadFailed"))}</p></div>`;
  }
}
