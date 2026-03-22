/**
 * Consent guard — shared module.
 *
 * Usage in every page's init sequence:
 *
 *   import { initConsentGuard } from "/static/consent-guard.js";
 *   const meData = await initConsentGuard(getHeaders, t, locale);
 *   // meData is the /api/me response; consent is guaranteed to be accepted
 *
 * The guard:
 *  1. Fetches GET /api/me (exempt from consent middleware).
 *  2. If consent.accepted === false, fetches the consent text and shows a
 *     blocking modal until the user accepts or logs out.
 *  3. Returns the /api/me response so callers don't need to fetch it again.
 *  4. Also renders a pending-deletion banner if effectiveAt is set.
 */

import { apiFetch } from "/static/api-client.js";

// ── Consent modal ────────────────────────────────────────────────────────────

function renderConsentModal(config, t, locale, onAccept, onLogout) {
  const existing = document.getElementById("consent-modal-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "consent-modal-overlay";
  overlay.style.cssText = [
    "position:fixed;inset:0;z-index:9999;",
    "background:rgba(0,0,0,0.55);",
    "display:flex;align-items:center;justify-content:center;",
    "padding:16px;",
  ].join("");

  const title = t("consent.title").replace("{platformName}", config.platformName ?? "Assessment Platform");
  const changelogHtml = config.changelog
    ? `<p class="consent-changelog"><strong>${t("consent.newVersion")}</strong><br>${escHtml(config.changelog)}</p>`
    : "";
  const dpoHtml =
    config.dpoName
      ? `<p class="consent-dpo"><strong>${t("consent.dpo.label")}</strong> ${escHtml(config.dpoName)}${config.dpoEmail ? ` &mdash; <strong>${t("consent.dpo.contact")}</strong> <a href="mailto:${escHtml(config.dpoEmail)}">${escHtml(config.dpoEmail)}</a>` : ""}</p>`
      : "";

  overlay.innerHTML = `
    <div class="consent-modal card" role="dialog" aria-modal="true" aria-labelledby="consent-modal-title"
         style="max-width:560px;width:100%;max-height:90vh;overflow-y:auto;display:grid;gap:var(--space-2);">
      <h2 id="consent-modal-title" style="margin:0">${escHtml(title)}</h2>
      ${changelogHtml}
      <div class="consent-body" style="white-space:pre-wrap;font-size:14px;line-height:1.6;color:var(--color-text)">
        ${escHtml(config.body)}
      </div>
      ${dpoHtml}
      <p class="small" style="color:var(--color-meta)">${t("consent.version").replace("{version}", escHtml(config.version))}</p>
      <div style="display:flex;gap:var(--space-1);justify-content:flex-end;flex-wrap:wrap">
        <button id="consent-logout-btn" class="btn btn-ghost">${escHtml(t("consent.logout"))}</button>
        <button id="consent-accept-btn" class="btn btn-primary">${escHtml(t("consent.accept"))}</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById("consent-accept-btn").addEventListener("click", onAccept);
  document.getElementById("consent-logout-btn").addEventListener("click", onLogout);
}

function removeConsentModal() {
  document.getElementById("consent-modal-overlay")?.remove();
}

// ── Pending-deletion banner ──────────────────────────────────────────────────

function renderDeletionBanner(effectiveAt, getHeaders, t, locale) {
  const existing = document.getElementById("deletion-banner");
  if (existing) return;

  const banner = document.createElement("div");
  banner.id = "deletion-banner";
  banner.setAttribute("role", "alert");
  banner.style.cssText = [
    "position:sticky;top:0;z-index:100;",
    "background:#fff3db;border-bottom:1px solid #f0c06b;",
    "padding:10px 16px;font-size:13px;",
    "display:flex;align-items:center;justify-content:space-between;gap:8px;",
  ].join("");

  const dateStr = effectiveAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(effectiveAt))
    : "";

  const msg = t("deletion.banner").replace("{date}", dateStr);

  banner.innerHTML = `
    <span>${escHtml(msg)}</span>
    <button id="cancel-deletion-btn" class="btn btn-ghost" style="font-size:12px;padding:4px 10px">
      ${escHtml(t("deletion.banner.cancel"))}
    </button>`;

  document.body.prepend(banner);

  document.getElementById("cancel-deletion-btn")?.addEventListener("click", async () => {
    try {
      await apiFetch("/api/me/deletion", getHeaders, { method: "DELETE" });
      banner.remove();
      showToastIfAvailable(t("deletion.banner.cancelled"), "success");
    } catch {
      showToastIfAvailable("Could not cancel. Please try again.", "error");
    }
  });
}

function showToastIfAvailable(message, type) {
  if (typeof window.showToast === "function") {
    window.showToast(message, type);
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * @param {() => object} getHeaders - returns request headers (mock identity or token)
 * @param {(key: string) => string} t - translation function for the current locale
 * @param {string} locale - current locale string
 * @returns {Promise<object>} - the /api/me response body
 */
export async function initConsentGuard(getHeaders, t, locale) {
  const meData = await apiFetch("/api/me", getHeaders);

  if (!meData.consent.accepted) {
    // Fetch consent text (not gated by consent middleware)
    const consentConfig = await apiFetch("/api/me/consent", getHeaders);

    await new Promise((resolve) => {
      renderConsentModal(
        consentConfig,
        t,
        locale,
        async () => {
          await apiFetch("/api/me/consent", getHeaders, {
            method: "POST",
            body: JSON.stringify({ consentVersion: consentConfig.version }),
            headers: { "Content-Type": "application/json" },
          });
          removeConsentModal();
          resolve();
        },
        () => {
          window.location.href = "/";
        },
      );
    });
  }

  // Show pending deletion banner if applicable
  if (meData.pendingDeletion?.effectiveAt) {
    renderDeletionBanner(meData.pendingDeletion.effectiveAt, getHeaders, t, locale);
  }

  return meData;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
