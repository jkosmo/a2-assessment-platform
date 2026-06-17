import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchUrlAsSourceMaterial, UrlFetchError, checkAndConsumeRateLimit } from "../../src/modules/adminContent/urlFetchService.js";

// #454 Phase 1: SSRF-guard tests. These are the critical security tests — they validate
// that we reject all standard private/internal IP ranges + loopback + link-local before
// any fetch happens. Network IO is not mocked — the fetch never runs because the URL
// is rejected upstream.

describe("urlFetchService SSRF protection", () => {
  it("rejects URLs without http(s) protocol", async () => {
    await expect(fetchUrlAsSourceMaterial("ftp://example.com/file")).rejects.toMatchObject({
      code: "unsupported_protocol",
    });
    await expect(fetchUrlAsSourceMaterial("file:///etc/passwd")).rejects.toMatchObject({
      code: "unsupported_protocol",
    });
    await expect(fetchUrlAsSourceMaterial("javascript:alert(1)")).rejects.toMatchObject({
      code: "unsupported_protocol",
    });
  });

  it("rejects malformed URLs", async () => {
    await expect(fetchUrlAsSourceMaterial("not a url")).rejects.toMatchObject({
      code: "invalid_url",
    });
    await expect(fetchUrlAsSourceMaterial("")).rejects.toBeInstanceOf(UrlFetchError);
  });

  it("rejects loopback and private IPv4 literals", async () => {
    const blocked = [
      "http://127.0.0.1/",
      "http://127.0.0.1:8080/admin",
      "http://10.0.0.1/",
      "http://10.255.255.254/path",
      "http://172.16.0.1/",
      "http://172.31.255.254/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/", // Azure/AWS metadata endpoint
      "http://0.0.0.0/",
      "http://100.64.0.1/", // CGNAT
    ];
    for (const url of blocked) {
      await expect(fetchUrlAsSourceMaterial(url)).rejects.toMatchObject({
        code: "private_address",
      });
    }
  });

  it("rejects loopback IPv6 literals", async () => {
    await expect(fetchUrlAsSourceMaterial("http://[::1]/")).rejects.toMatchObject({
      code: "private_address",
    });
    await expect(fetchUrlAsSourceMaterial("http://[fc00::1]/")).rejects.toMatchObject({
      code: "private_address",
    });
    await expect(fetchUrlAsSourceMaterial("http://[fe80::1]/")).rejects.toMatchObject({
      code: "private_address",
    });
  });

  it("rejects hostnames that map to private addresses (localhost variants)", async () => {
    await expect(fetchUrlAsSourceMaterial("http://localhost/")).rejects.toMatchObject({
      code: "private_address",
    });
    await expect(fetchUrlAsSourceMaterial("http://api.localhost/")).rejects.toMatchObject({
      code: "private_address",
    });
    await expect(fetchUrlAsSourceMaterial("http://internal-service.local/")).rejects.toMatchObject({
      code: "private_address",
    });
    await expect(fetchUrlAsSourceMaterial("http://prod.internal/")).rejects.toMatchObject({
      code: "private_address",
    });
  });

  // #504: redirects are re-validated. A public start URL that 302-redirects to a
  // loopback/internal address must be blocked at the redirect hop, not followed.
  it("re-validates redirects and blocks redirect to a private/internal address", async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1/internal" } }),
    );
    global.fetch = fetchMock as typeof fetch;
    try {
      // 93.184.216.34 is a public IP literal → passes the initial SSRF check, so the
      // mocked fetch runs and returns the malicious redirect.
      await expect(fetchUrlAsSourceMaterial("https://93.184.216.34/start")).rejects.toMatchObject({
        code: "private_address",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("urlFetchService rate-limit", () => {
  beforeEach(() => {
    // Each test uses a unique user-id so the in-memory bucket starts fresh per test.
  });

  it("allows up to 10 requests in a minute, then rate-limits", () => {
    const userId = `test-user-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      const result = checkAndConsumeRateLimit(userId);
      expect(result.allowed).toBe(true);
    }
    const eleventh = checkAndConsumeRateLimit(userId);
    expect(eleventh.allowed).toBe(false);
    expect(eleventh.retryAfterMs).toBeGreaterThan(0);
    expect(eleventh.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("isolates buckets per user", () => {
    const userA = `user-a-${Math.random()}`;
    const userB = `user-b-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      expect(checkAndConsumeRateLimit(userA).allowed).toBe(true);
    }
    // userA is now blocked, userB should still be free
    expect(checkAndConsumeRateLimit(userA).allowed).toBe(false);
    expect(checkAndConsumeRateLimit(userB).allowed).toBe(true);
  });
});
