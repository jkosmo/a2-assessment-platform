// @vitest-environment-options {"url": "http://localhost/admin-content/courses"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 2.120.0: innloggingsflyten på en forfatterside, med en falsk Microsoft-innlogging (window.msal).
// 1) Forfattersiden spør /api/me når konfigurasjonen lastes — det er det sperren bygger på.
// 2) En fornyet innlogging midt i økta lagrer adressen brukeren var på, så hen kommer tilbake dit.

function fakeMsal({ accounts, silentFails = false }) {
  const calls = { loginRedirect: 0, acquireTokenRedirect: 0 };
  window.msal = {
    PublicClientApplication: class {
      async initialize() {}
      async handleRedirectPromise() { return null; }
      getAllAccounts() { return accounts; }
      async acquireTokenSilent() {
        if (silentFails) throw new Error("interaction_required");
        return { accessToken: "tok" };
      }
      async loginRedirect() { calls.loginRedirect += 1; }
      async acquireTokenRedirect() { calls.acquireTokenRedirect += 1; }
    },
  };
  return calls;
}

function fakeFetch(roles) {
  const urls = [];
  global.fetch = vi.fn(async (url) => {
    urls.push(String(url));
    if (String(url) === "/participant/config") {
      return { ok: true, status: 200, text: async () => JSON.stringify({ authMode: "entra", entra: { clientId: "c", authority: "a", scopes: ["s"] } }) };
    }
    return { ok: true, status: 200, json: async () => ({ user: { roles } }), text: async () => JSON.stringify({ user: { roles } }) };
  });
  return urls;
}

describe("2.120.0 innlogging på forfattersiden", () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    vi.resetModules();
    sessionStorage.clear();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete window.msal;
  });

  it("konfigurasjonen spør /api/me med tokenet, og stopper siden for en ren deltaker", async () => {
    fakeMsal({ accounts: [{ username: "ksm" }] });
    const urls = fakeFetch(["PARTICIPANT"]);
    const { getConsoleConfig } = await import("../../public/api-client.js");
    const settled = await Promise.race([getConsoleConfig().then(() => "lastet"), new Promise((r) => setTimeout(() => r("stoppet"), 200))]);
    expect(urls).toContain("/api/me");
    expect(settled).toBe("stoppet");
  });

  it("en fagansvarlig får konfigurasjonen som vanlig", async () => {
    fakeMsal({ accounts: [{ username: "smo" }] });
    fakeFetch(["SUBJECT_MATTER_OWNER"]);
    const { getConsoleConfig } = await import("../../public/api-client.js");
    const config = await getConsoleConfig();
    expect(config.authMode).toBe("entra");
  });

  it("fornyet innlogging (tokenet kan ikke fornyes stille) lagrer adressen brukeren var på", async () => {
    const calls = fakeMsal({ accounts: [{ username: "ksm" }], silentFails: true });
    fakeFetch(["SUBJECT_MATTER_OWNER"]);
    const { getConsoleConfig, getAccessToken } = await import("../../public/api-client.js");
    await Promise.race([getConsoleConfig(), new Promise((r) => setTimeout(r, 200))]);
    sessionStorage.clear();
    await getAccessToken();
    expect(calls.acquireTokenRedirect).toBeGreaterThan(0);
    expect(sessionStorage.getItem("auth_intended_url")).toBe("http://localhost/admin-content/courses");
  });

  it("innlogging når kontoen er borte midt i økta lagrer også adressen", async () => {
    const accounts = [{ username: "ksm" }];
    const calls = fakeMsal({ accounts });
    fakeFetch(["SUBJECT_MATTER_OWNER"]);
    const { getConsoleConfig, getAccessToken } = await import("../../public/api-client.js");
    await getConsoleConfig();
    accounts.length = 0;
    sessionStorage.clear();
    await getAccessToken();
    expect(calls.loginRedirect).toBe(1);
    expect(sessionStorage.getItem("auth_intended_url")).toBe("http://localhost/admin-content/courses");
  });
});
