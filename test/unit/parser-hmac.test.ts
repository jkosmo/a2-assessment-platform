import { describe, it, expect } from "vitest";
import { signParserRequest, parserSignaturesMatch, NonceReplayCache } from "../../src/parser/parserHmac.js";

// #816: the client (parserWorkerClient) signs and the worker (parserApp) verifies using this SAME
// module, so these tests double as the cross-service symmetry proof — a valid client signature verifies,
// a different body/nonce does not, and repeated nonces are rejected within the window.

const KEY = "test-parser-key";

describe("parser HMAC replay hardening (#816)", () => {
  it("a signature over the same (timestamp, method, path, body, nonce) verifies (client↔worker symmetry)", () => {
    const input = { timestamp: 1000, method: "POST", path: "/parse", body: JSON.stringify({ fileName: "a.pdf", contentBase64: "abc" }), nonce: "n1" };
    const clientSig = signParserRequest(KEY, input);
    const workerSig = signParserRequest(KEY, { ...input }); // worker recomputes from the received request
    expect(parserSignaturesMatch(clientSig, workerSig)).toBe(true);
  });

  it("a captured signature does NOT verify against a different body (replay-with-different-body blocked)", () => {
    const base = { timestamp: 1000, method: "POST", path: "/parse", nonce: "n1" };
    const captured = signParserRequest(KEY, { ...base, body: '{"a":1}' });
    const forgedWorkerSig = signParserRequest(KEY, { ...base, body: '{"a":2}' }); // worker sees the swapped body
    expect(parserSignaturesMatch(captured, forgedWorkerSig)).toBe(false);
  });

  it("the nonce is bound into the signature", () => {
    const base = { timestamp: 1000, method: "POST", path: "/parse", body: "" };
    expect(parserSignaturesMatch(signParserRequest(KEY, { ...base, nonce: "n1" }), signParserRequest(KEY, { ...base, nonce: "n2" }))).toBe(false);
  });

  it("the nonce cache accepts a nonce once, rejects an in-window replay, and lets it expire", () => {
    const cache = new NonceReplayCache(60);
    expect(cache.checkAndRecord("n1", 1000)).toBe(true); // first use
    expect(cache.checkAndRecord("n1", 1030)).toBe(false); // replay within the 60s window
    expect(cache.checkAndRecord("n2", 1030)).toBe(true); // a different nonce is fine
    expect(cache.checkAndRecord("n1", 1061)).toBe(true); // past the window → expired, fresh again
  });
});
