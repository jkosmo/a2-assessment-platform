// #787 slice 5: reusable content-owner management panel. Renders the current owner set + a search-to-
// add box + per-owner remove, calling /api/admin/content-owners. Drop into any content surface with a
// container element, the contentType (COURSE|SECTION|CLASS|MODULE), the contentId, and the page's
// getHeaders. Inert with respect to editing — this only manages who owns the object (enforcement is a
// separate concern wired onto the write/delete paths).

import { apiFetch } from "/static/api-client.js";
import { escapeHtml } from "/static/html-escape.js";
import { showToast } from "/static/toast.js";

function ownersPath(contentType, contentId) {
  return `/api/admin/content-owners/${contentType}/${encodeURIComponent(contentId)}`;
}

// Turn apiFetch's `"<status>: <json>"` error into the server's human message when present.
function errorMessage(error, fallback) {
  const raw = error instanceof Error ? error.message : "";
  const match = raw.match(/^\d+:\s*(\{.*\})$/);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed.message === "string") return parsed.message;
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

export async function renderOwnerPanel({ container, contentType, contentId, getHeaders }) {
  let owners = [];
  let canManage = false; // only owners/admin may change owners; everyone with access can view
  container.innerHTML = `<div class="owner-panel"><p class="owner-panel-loading">Laster eiere…</p></div>`;

  async function load() {
    const data = await apiFetch(ownersPath(contentType, contentId), getHeaders);
    owners = Array.isArray(data.owners) ? data.owners : [];
    canManage = data.canManage === true;
  }

  function paint() {
    const rows = owners.length
      ? owners
          .map(
            (o) => `<li class="owner-row">
        <span class="owner-name">${escapeHtml(o.name)}</span>
        <span class="owner-email">${escapeHtml(o.email)}</span>
        ${canManage ? `<button type="button" class="owner-remove btn-secondary" data-user-id="${escapeHtml(o.userId)}">Fjern</button>` : ""}
      </li>`,
          )
          .join("")
      : `<li class="owner-empty">Ingen eiere ennå — kun administrator kan redigere til en eier tildeles.</li>`;
    const addBox = canManage
      ? `<div class="owner-add">
          <input type="text" class="owner-search-input" placeholder="Søk navn/e-post for å legge til eier…" aria-label="Søk etter eier" autocomplete="off" />
          <ul class="owner-search-results" hidden></ul>
        </div>`
      : "";
    container.innerHTML = `
      <div class="owner-panel">
        <h3 class="owner-panel-title">Eiere</h3>
        <ul class="owner-list">${rows}</ul>
        ${addBox}
      </div>`;
    wire();
  }

  function wire() {
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
        : `<li class="owner-empty">Ingen treff.</li>`;
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
      showToast("Eier lagt til.");
      paint();
    } catch (error) {
      showToast(errorMessage(error, "Kunne ikke legge til eier."), "error");
    }
  }

  async function removeOwner(userId) {
    try {
      const data = await apiFetch(`${ownersPath(contentType, contentId)}/${encodeURIComponent(userId)}`, getHeaders, {
        method: "DELETE",
      });
      owners = Array.isArray(data.owners) ? data.owners : owners;
      showToast("Eier fjernet.");
      paint();
    } catch (error) {
      showToast(errorMessage(error, "Kunne ikke fjerne eier."), "error");
    }
  }

  try {
    await load();
    paint();
  } catch {
    container.innerHTML = `<div class="owner-panel"><p class="owner-panel-error">Kunne ikke laste eiere.</p></div>`;
  }
}
