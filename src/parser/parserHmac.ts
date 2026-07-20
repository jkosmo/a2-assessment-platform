import { createHmac, timingSafeEqual } from "node:crypto";
import { sha256 } from "../utils/hash.js";

// #816: shared HMAC signing for the web↔parser-worker channel. Both the client (parserWorkerClient) and
// the worker (parserApp) build the canonical message HERE, so they can never drift — the previous
// signature covered only `timestamp:method:path`, which let an observed POST /parse signature be
// replayed for 60s with an arbitrary body. The canonical value now binds the SHA-256 of the body and a
// per-request nonce; the worker additionally rejects seen nonces within the replay window.

export interface ParserSignatureInput {
  timestamp: number;
  method: string;
  path: string;
  body: string; // exact request-body string ("" for bodyless GETs)
  nonce: string;
}

export function parserCanonicalMessage(input: ParserSignatureInput): string {
  return `${input.timestamp}:${input.method.toUpperCase()}:${input.path}:${sha256(input.body)}:${input.nonce}`;
}

export function signParserRequest(key: string, input: ParserSignatureInput): string {
  return createHmac("sha256", key).update(parserCanonicalMessage(input)).digest("hex");
}

// Constant-time comparison of two hex signatures.
export function parserSignaturesMatch(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

// In-memory nonce replay cache. A nonce may be accepted once within the window; a second use inside the
// window is a replay. Entries self-expire so the map stays bounded to ~one replay-window of traffic.
export class NonceReplayCache {
  private readonly seen = new Map<string, number>(); // nonce -> expiry (epoch seconds)

  constructor(private readonly windowSeconds: number) {}

  // Returns true if the nonce is fresh (and records it); false if it was already seen in-window.
  checkAndRecord(nonce: string, nowSeconds: number): boolean {
    this.purge(nowSeconds);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, nowSeconds + this.windowSeconds);
    return true;
  }

  private purge(nowSeconds: number): void {
    for (const [nonce, expiry] of this.seen) {
      if (expiry <= nowSeconds) this.seen.delete(nonce);
    }
  }
}
