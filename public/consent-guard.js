/**
 * Consent guard — shared module.
 *
 * Usage in every page's init sequence:
 *
 *   import { initConsentGuard } from "/static/consent-guard.js";
 *   const meData = await initConsentGuard(getHeaders, locale);
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

// ── Built-in translations ─────────────────────────────────────────────────────

const CONSENT_TRANSLATIONS = {
  "en-GB": {
    "locale.label": "Language",
    "consent.title": "Your personal data in {platformName}",
    "consent.newVersion": "We have updated the privacy notice — here is what changed:",
    "consent.dpo.label": "Data protection officer:",
    "consent.dpo.contact": "Contact:",
    "consent.version": "Version {version}",
    "consent.accept": "I understand — continue",
    "consent.logout": "Log out",
    "deletion.banner": "Pseudonymisation scheduled for {date}.",
    "deletion.banner.cancel": "Cancel",
    "deletion.banner.cancelled": "Pseudonymisation request cancelled.",
  },
  nb: {
    "locale.label": "Språk",
    "consent.title": "Dine personopplysninger i {platformName}",
    "consent.newVersion": "Vi har oppdatert personvernerklæringen — her er hva som har endret seg:",
    "consent.dpo.label": "Personvernombud:",
    "consent.dpo.contact": "Kontakt:",
    "consent.version": "Versjon {version}",
    "consent.accept": "Jeg forstår — fortsett",
    "consent.logout": "Logg ut",
    "deletion.banner": "Pseudonymisering planlagt {date}.",
    "deletion.banner.cancel": "Avbryt",
    "deletion.banner.cancelled": "Pseudonymiseringsforespørsel avbrutt.",
  },
  nn: {
    "locale.label": "Språk",
    "consent.title": "Personopplysningane dine i {platformName}",
    "consent.newVersion": "Vi har oppdatert personvernerklæringa — her er kva som har endra seg:",
    "consent.dpo.label": "Personvernombod:",
    "consent.dpo.contact": "Kontakt:",
    "consent.version": "Versjon {version}",
    "consent.accept": "Eg forstår — fortsett",
    "consent.logout": "Logg ut",
    "deletion.banner": "Pseudonymisering planlagt {date}.",
    "deletion.banner.cancel": "Avbryt",
    "deletion.banner.cancelled": "Pseudonymiseringsførespurnad avbroten.",
  },
};

const LOCALE_LABELS = {
  "en-GB": "English (UK)",
  nb: "Norsk bokmål",
  nn: "Norsk nynorsk",
};

const LOCALE_STORAGE_KEY = "participant.locale";

function tg(locale, key) {
  return CONSENT_TRANSLATIONS[locale]?.[key] ?? CONSENT_TRANSLATIONS["en-GB"]?.[key] ?? key;
}

// ── Consent modal ────────────────────────────────────────────────────────────

function renderConsentModal(config, locale, onAccept, onLogout) {
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

  const title = tg(locale, "consent.title").replace("{platformName}", config.platformName ?? "Assessment Platform");
  const changelogHtml = config.changelog
    ? `<p class="consent-changelog"><strong>${tg(locale, "consent.newVersion")}</strong><br>${escHtml(config.changelog)}</p>`
    : "";
  const dpoHtml =
    config.dpoName
      ? `<p class="consent-dpo"><strong>${tg(locale, "consent.dpo.label")}</strong> ${escHtml(config.dpoName)}${config.dpoEmail ? ` &mdash; <strong>${tg(locale, "consent.dpo.contact")}</strong> <a href="mailto:${escHtml(config.dpoEmail)}">${escHtml(config.dpoEmail)}</a>` : ""}</p>`
      : "";

  const localeOptions = Object.keys(CONSENT_TRANSLATIONS)
    .map((l) => `<option value="${escHtml(l)}"${l === locale ? " selected" : ""}>${escHtml(LOCALE_LABELS[l] ?? l)}</option>`)
    .join("");

  overlay.innerHTML = `
    <div class="consent-modal card" role="dialog" aria-modal="true" aria-labelledby="consent-modal-title"
         style="max-width:560px;width:100%;max-height:90vh;overflow-y:auto;display:grid;gap:var(--space-2);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <h2 id="consent-modal-title" style="margin:0;flex:1">${escHtml(title)}</h2>
        <label style="font-size:12px;color:var(--color-meta);white-space:nowrap;display:flex;align-items:center;gap:4px">
          ${escHtml(tg(locale, "locale.label"))}
          <select id="consent-locale-select" style="font-size:12px;padding:2px 6px;border-radius:4px;border:1px solid var(--color-border-soft)">
            ${localeOptions}
          </select>
        </label>
      </div>
      ${changelogHtml}
      <div class="consent-body" style="white-space:pre-wrap;font-size:14px;line-height:1.6;color:var(--color-text)">
        ${escHtml(config.body)}
      </div>
      ${dpoHtml}
      <p class="small" style="color:var(--color-meta)">${tg(locale, "consent.version").replace("{version}", escHtml(config.version))}</p>
      <div style="display:flex;gap:var(--space-1);justify-content:flex-end;flex-wrap:wrap">
        <button id="consent-logout-btn" class="btn btn-ghost">${escHtml(tg(locale, "consent.logout"))}</button>
        <button id="consent-accept-btn" class="btn btn-primary">${escHtml(tg(locale, "consent.accept"))}</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById("consent-locale-select").addEventListener("change", (e) => {
    try { localStorage.setItem(LOCALE_STORAGE_KEY, e.target.value); } catch { /* ignore */ }
    window.location.reload();
  });
  document.getElementById("consent-accept-btn").addEventListener("click", onAccept);
  document.getElementById("consent-logout-btn").addEventListener("click", onLogout);
}

function removeConsentModal() {
  document.getElementById("consent-modal-overlay")?.remove();
}

// ── Pending-deletion banner ──────────────────────────────────────────────────

function renderDeletionBanner(effectiveAt, getHeaders, locale) {
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

  const msg = tg(locale, "deletion.banner").replace("{date}", dateStr);

  banner.innerHTML = `
    <span>${escHtml(msg)}</span>
    <button id="cancel-deletion-btn" class="btn btn-ghost" style="font-size:12px;padding:4px 10px">
      ${escHtml(tg(locale, "deletion.banner.cancel"))}
    </button>`;

  document.body.prepend(banner);

  document.getElementById("cancel-deletion-btn")?.addEventListener("click", async () => {
    try {
      await apiFetch("/api/me/deletion", getHeaders, { method: "DELETE" });
      banner.remove();
      showToastIfAvailable(tg(locale, "deletion.banner.cancelled"), "success");
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
 * @param {string} locale - current locale string (e.g. "en-GB", "nb", "nn")
 * @returns {Promise<object>} - the /api/me response body
 */
export async function initConsentGuard(getHeaders, locale) {
  const meData = await apiFetch("/api/me", getHeaders);

  if (!meData.consent.accepted) {
    // Fetch consent text (not gated by consent middleware)
    const consentConfig = await apiFetch("/api/me/consent", getHeaders);

    await new Promise((resolve) => {
      renderConsentModal(
        consentConfig,
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
    renderDeletionBanner(meData.pendingDeletion.effectiveAt, getHeaders, locale);
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
