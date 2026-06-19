import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../public/api-client.js";

// #483/F4 regression: apiFetch must NOT send Content-Type for FormData bodies, or the browser
// won't set the multipart boundary and the server parses the multipart body as JSON → 500.
// buildConsoleHeaders injects "Content-Type: application/json" into every call, so apiFetch has
// to strip it specifically for FormData.
describe("apiFetch Content-Type handling", () => {
  let originalFetch;
  let captured;

  beforeEach(() => {
    originalFetch = global.fetch;
    captured = null;
    global.fetch = vi.fn(async (_url, opts) => {
      captured = opts;
      return { ok: true, status: 200, text: async () => "{}" };
    });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const consoleHeaders = () => ({ "Content-Type": "application/json", "x-user-id": "u1" });

  it("strips Content-Type for FormData so the browser sets multipart/form-data", async () => {
    const fd = new FormData();
    fd.append("file", new Blob(["x"]), "x.png");
    await apiFetch("/api/x", consoleHeaders, { method: "POST", body: fd });
    expect(captured.headers["Content-Type"]).toBeUndefined();
    expect(captured.headers["content-type"]).toBeUndefined();
    // Other console headers are preserved.
    expect(captured.headers["x-user-id"]).toBe("u1");
  });

  it("keeps Content-Type for JSON string bodies", async () => {
    await apiFetch("/api/x", consoleHeaders, { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(captured.headers["Content-Type"]).toBe("application/json");
  });
});
