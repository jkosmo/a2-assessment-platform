import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, CONTENT_BUSY_RETRY_DELAYS_MS } from "../../public/api-client.js";

// #934 skive 5a-1: `503 content_busy` betyr at noen skriver innhold, og at ingenting er skrevet. Alle sider går gjennom
// `apiFetch`, så det er her siden prøver igjen. Andre feil skal ikke prøves igjen: en 503 av en annen grunn kan bety noe
// annet, og en 409 er et svar. Forfatterflatene prøves heller ikke igjen: noen ruter der gjør flere transaksjoner.
const response = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const BUSY = { error: "content_busy", message: "Someone else is changing content." };

describe("apiFetch ved 503 content_busy", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.useFakeTimers();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  async function settle(promise) {
    const outcome = promise.then((value) => ({ value }), (error) => ({ error }));
    await vi.runAllTimersAsync();
    return outcome;
  }

  it("prøver igjen, med samme kall, og gir svaret som kom til slutt", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(response(503, BUSY)).mockResolvedValueOnce(response(503, BUSY)).mockResolvedValueOnce(response(201, { ok: 1 }));
    const outcome = await settle(apiFetch("/api/x", () => ({ "x-user-id": "u1" }), { method: "POST", body: "{\"a\":1}" }));
    expect(outcome.value).toEqual({ ok: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    for (const call of global.fetch.mock.calls) {
      expect(call[0]).toBe("/api/x");
      expect(call[1]).toMatchObject({ method: "POST", body: "{\"a\":1}" });
    }
  });

  it("venter mellom forsøkene", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(response(503, BUSY)).mockResolvedValueOnce(response(200, {}));
    const promise = apiFetch("/api/x", () => ({}));
    await vi.advanceTimersByTimeAsync(CONTENT_BUSY_RETRY_DELAYS_MS[0] - 1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await promise;
  });

  it("gir opp etter alle forsøkene, og kalleren får feilen som før", async () => {
    global.fetch = vi.fn().mockResolvedValue(response(503, BUSY));
    const { error } = await settle(apiFetch("/api/x", () => ({}), { method: "POST" }));
    expect(global.fetch).toHaveBeenCalledTimes(CONTENT_BUSY_RETRY_DELAYS_MS.length + 1);
    expect(error.status).toBe(503);
    expect(error.body.error).toBe("content_busy");
  });

  it("forfatterflatene prøves ikke igjen: der betyr svaret ikke alltid at ingenting er skrevet", async () => {
    global.fetch = vi.fn().mockResolvedValue(response(503, BUSY));
    const { error } = await settle(apiFetch("/api/admin/content/courses/c1/content", () => ({}), { method: "PUT" }));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(error.body.error).toBe("content_busy");
  });

  it("deltaker- og behandlerrutene prøves igjen", async () => {
    for (const url of ["/api/submissions", "/api/courses/c1/sections/s1/read", "/api/reviews/r1/override", "/api/appeals/a1/resolve"]) {
      global.fetch = vi.fn().mockResolvedValueOnce(response(503, BUSY)).mockResolvedValueOnce(response(200, {}));
      await settle(apiFetch(url, () => ({}), { method: "POST" }));
      expect(global.fetch, url).toHaveBeenCalledTimes(2);
    }
  });

  it("KONTROLL: en annen 503 og en 409 prøves ikke igjen", async () => {
    for (const [status, body] of [[503, { error: "not_configured" }], [409, { error: "module_version_changed" }], [500, { error: "internal_error" }]]) {
      global.fetch = vi.fn().mockResolvedValue(response(status, body));
      const { error } = await settle(apiFetch("/api/x", () => ({}), { method: "POST" }));
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(error.status).toBe(status);
    }
  });
});
