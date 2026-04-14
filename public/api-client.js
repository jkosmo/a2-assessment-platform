// ---------------------------------------------------------------------------
// MSAL (Entra auth)
// ---------------------------------------------------------------------------

let msalInstance = null;
let msalScopes = null;

async function loadMsalScript() {
  if (window.msal) return;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://alcdn.msauth.net/browser/2.38.0/js/msal-browser.min.js";
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
      redirectUri: window.location.origin + window.location.pathname,
    },
    cache: {
      cacheLocation: "sessionStorage",
      storeAuthStateInCookie: false,
    },
  });

  await msalInstance.initialize();

  // Handle the token response after a redirect login
  const result = await msalInstance.handleRedirectPromise();
  if (result) return; // Successfully returned from redirect

  // If no account is present, trigger login
  if (msalInstance.getAllAccounts().length === 0) {
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

  const response = await fetch(url, {
    ...options,
    headers: { ...baseHeaders, ...(options.headers ?? {}) },
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
