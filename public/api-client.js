// ---------------------------------------------------------------------------
// MSAL (Entra auth)
// ---------------------------------------------------------------------------

// #355: validate that a sessionStorage-recovered URL targets our own origin + a sensible
// internal path before navigating to it. sessionStorage is same-origin already, but a
// defense-in-depth validation keeps a future code path that could write a poisoned value
// (or a bug that stores an absolute external URL) from turning into an open redirect.
// Pure function — exported for unit testing.
export function isSafeSameOriginRedirect(target, currentOrigin) {
  if (typeof target !== "string" || target.length === 0) return false;
  if (typeof currentOrigin !== "string" || currentOrigin.length === 0) return false;
  let url;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.origin !== currentOrigin) return false;
  // pathname must be an absolute internal path; URL parsing with a non-special scheme would
  // not surface here (URL() rejects javascript:/data: as opaque), but we double-check.
  if (!url.pathname.startsWith("/")) return false;
  return true;
}

let msalInstance = null;
let msalScopes = null;

async function loadMsalScript() {
  if (window.msal) return;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    // #393: MSAL vendret lokalt (public/static/vendor/) i stedet for ekstern CDN, så en
    // kompromittert CDN ikke kan kjøre kode i vår origin. SRI-integrity beholdes som
    // defense-in-depth selv for egen origin. Versjon er pinnet i filnavnet; oppdaterings-
    // prosess er dokumentert i doc/MSAL_VENDORING.md. crossOrigin kreves for SRI.
    s.src = "/static/vendor/msal-browser-2.38.0.min.js";
    s.integrity = "sha384-mz+8Q3jA4XBFbnyAsyQegn/0LHvziH7qHLBa9GzcU3HzeWj9J16SXM5S+TsmPBy0";
    s.crossOrigin = "anonymous";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load MSAL script."));
    document.head.appendChild(s);
  });
}

async function initMsal(entraConfig) {
  await loadMsalScript();

  msalScopes = entraConfig.scopes;

  msalInstance = new msal.PublicClientApplication({
    auth: {
      clientId: entraConfig.clientId,
      authority: entraConfig.authority,
      redirectUri: window.location.origin + "/admin-content",
    },
    cache: {
      cacheLocation: "sessionStorage",
      storeAuthStateInCookie: false,
    },
  });

  await msalInstance.initialize();

  // Handle the token response after a redirect login
  const result = await msalInstance.handleRedirectPromise();
  if (result) {
    // Restore the page the user was on before being sent to login.
    // #355: only navigate if the stored URL is same-origin + an internal path. Reject and
    // drop the value silently otherwise so a poisoned sessionStorage entry can't redirect us.
    const intended = sessionStorage.getItem("auth_intended_url");
    sessionStorage.removeItem("auth_intended_url");
    if (intended && isSafeSameOriginRedirect(intended, window.location.origin) && intended !== window.location.href) {
      window.location.replace(intended);
      return;
    }
    return;
  }

  // If no account is present, save destination and trigger login
  if (msalInstance.getAllAccounts().length === 0) {
    sessionStorage.setItem("auth_intended_url", window.location.href);
    await msalInstance.loginRedirect({ scopes: msalScopes });
    // Page will redirect — execution stops here
  }
}

export async function getAccessToken() {
  if (!msalInstance) return null;

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) {
    await msalInstance.loginRedirect({ scopes: msalScopes });
    return null;
  }

  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: msalScopes,
      account: accounts[0],
    });
    return result.accessToken;
  } catch {
    await msalInstance.acquireTokenRedirect({ scopes: msalScopes, account: accounts[0] });
    return null;
  }
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export function buildConsoleHeaders({ userId, email, name, department, roles, locale }) {
  return {
    "Content-Type": "application/json",
    "x-user-id": userId,
    "x-user-email": email,
    "x-user-name": name,
    "x-user-department": department,
    "x-user-roles": roles,
    "x-locale": locale,
  };
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function apiFetch(url, getHeadersOrOptions = {}, maybeOptions = {}) {
  const getHeaders = typeof getHeadersOrOptions === "function" ? getHeadersOrOptions : null;
  const options = getHeaders ? maybeOptions : (getHeadersOrOptions ?? {});
  const baseHeaders = getHeaders ? getHeaders() : {};

  const token = await getAccessToken();
  if (token) {
    baseHeaders["Authorization"] = `Bearer ${token}`;
  }

  const headers = { ...baseHeaders, ...(options.headers ?? {}) };
  // For multipart/FormData uploads the browser must set Content-Type (with the
  // boundary) itself. buildConsoleHeaders injects "application/json", which would
  // otherwise make the server parse the multipart body as JSON and 500 (#483/F4).
  if (typeof FormData !== "undefined" && options.body instanceof FormData) {
    delete headers["Content-Type"];
    delete headers["content-type"];
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

// ---------------------------------------------------------------------------
// Queue counts — nav badge helper
// ---------------------------------------------------------------------------

export async function fetchQueueCounts(headers) {
  try {
    return await apiFetch("/api/queue-counts", headers);
  } catch {
    return { reviews: 0, appeals: 0 };
  }
}

export function applyNavReviewBadge(navEl, counts) {
  if (!navEl) return;
  const total = (counts?.reviews ?? 0) + (counts?.appeals ?? 0);
  const link = navEl.querySelector('a[href="/review"]');
  if (!link) return;

  let badge = link.querySelector(".nav-queue-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "nav-queue-badge";
    badge.setAttribute("aria-label", `${total} ubehandlet`);
    link.appendChild(badge);
  }

  badge.hidden = total <= 0;
  badge.textContent = String(total);
  badge.setAttribute("aria-label", `${total} ubehandlet`);
}

let consoleConfigPromise = null;

export async function getConsoleConfig() {
  if (!consoleConfigPromise) {
    consoleConfigPromise = (async () => {
      const response = await fetch("/participant/config");
      if (!response.ok) {
        throw new Error("participant_config_unavailable");
      }

      const config = await parseResponseBody(response);

      if (config.authMode === "entra" && config.entra) {
        await initMsal(config.entra);
      }

      return config;
    })();
  }

  return consoleConfigPromise;
}
