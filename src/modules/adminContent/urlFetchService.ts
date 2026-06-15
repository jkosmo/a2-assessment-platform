// #454 Phase 1: server-side URL fetcher for kildemateriale-steget. Brukeren limer inn en URL,
// vi henter HTML/PDF/RTF/plain text, ekstraherer hovedtekst (Mozilla Readability for HTML), og
// returnerer som vanlig source material. Erstatter brukerens workaround der de gikk til ekstern
// LLM kun for å fetche URL-er.

import { lookup as dnsLookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

import { SOURCE_MATERIAL_MAX_BYTES } from "./sourceMaterialExtractionService.js";

const FETCH_TIMEOUT_MS = 10_000;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

export class UrlFetchError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "UrlFetchError";
  }
}

// SSRF: block requests against private IP ranges, loopback, link-local, and cloud
// metadata endpoints. Resolves hostname via DNS and checks the resulting IP. There's a
// known TOCTOU window between resolve and fetch where DNS could change (DNS rebinding) —
// for v1 we accept that risk; mitigation (resolve-once-then-connect-to-IP-with-Host-header)
// can be added in Phase 1.1 if needed.
const PRIVATE_IPV4_RANGES: Array<[number, number, number]> = [
  // [first-octet, second-octet-min, second-octet-max]
  // RFC 1918 + loopback + link-local + CGNAT
  [10, 0, 255],
  [127, 0, 255],
  [169, 254, 254],
  [172, 16, 31],
  [192, 168, 168],
  // Azure/AWS/GCP metadata endpoint 169.254.169.254 already covered by 169.254.x
  // Carrier-grade NAT 100.64.0.0/10 — also block to be safe
  [100, 64, 127],
];

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;
  // 0.0.0.0 and full zeros
  if (parts[0] === 0) return true;
  for (const [a, bMin, bMax] of PRIVATE_IPV4_RANGES) {
    if (parts[0] === a && parts[1] >= bMin && parts[1] <= bMax) return true;
  }
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Loopback
  if (lower === "::1") return true;
  // Unspecified
  if (lower === "::" || lower === "::0") return true;
  // Unique local fc00::/7 (fc and fd prefixes)
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // Link-local fe80::/10
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  // IPv4-mapped — extract and check the IPv4 part
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice(7);
    if (isIPv4(v4)) return isPrivateIpv4(v4);
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateIpv4(ip);
  if (isIPv6(ip)) return isPrivateIpv6(ip);
  return false;
}

export interface UrlFetchResult {
  extractedText: string;
  sourceHostname: string;
  fetchedBytes: number;
}

// Validates the URL is well-formed, uses http(s), and resolves to a public IP.
// Throws UrlFetchError on any policy violation; caller maps to an HTTP error code.
async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlFetchError("invalid_url", "URL is not well-formed.");
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new UrlFetchError("unsupported_protocol", `Only http and https are supported (got: ${parsed.protocol}).`);
  }
  const rawHostname = parsed.hostname;
  if (!rawHostname) {
    throw new UrlFetchError("invalid_url", "URL has no hostname.");
  }
  // Strip IPv6 brackets defensively — URL.hostname returns "[fc00::1]" on some Node
  // versions (Linux CI observed) but "fc00::1" on others. Normalise to bracket-free
  // before passing to net.isIPv6 / our IP-literal check.
  const hostname = rawHostname.replace(/^\[|\]$/g, "");
  // If hostname is already an IP literal, validate directly
  if (isIPv4(hostname) || isIPv6(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new UrlFetchError("private_address", "URL points to a private/internal address.");
    }
    return parsed;
  }
  // Block obvious loopback hostnames before DNS lookup
  const lowered = hostname.toLowerCase();
  if (lowered === "localhost" || lowered.endsWith(".localhost") || lowered.endsWith(".local") || lowered.endsWith(".internal")) {
    throw new UrlFetchError("private_address", `URL targets a non-public hostname (${hostname}).`);
  }
  // DNS lookup; reject if any A/AAAA record is private
  try {
    const records = await dnsLookup(hostname, { all: true });
    for (const r of records) {
      if (isPrivateIp(r.address)) {
        throw new UrlFetchError("private_address", `URL hostname (${hostname}) resolves to a private address (${r.address}).`);
      }
    }
  } catch (err) {
    if (err instanceof UrlFetchError) throw err;
    throw new UrlFetchError("dns_failed", `Could not resolve hostname (${hostname}).`);
  }
  return parsed;
}

// Fetches the URL with a strict byte cap. Streams response into a buffer; aborts if cap exceeded.
const MAX_REDIRECTS = 5;

async function fetchWithLimit(parsedUrl: URL, signal: AbortSignal): Promise<{ buffer: Buffer; contentType: string }> {
  let currentUrl = parsedUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await fetch(currentUrl.toString(), {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        // Be polite: identify ourselves
        "user-agent": "A2AssessmentPlatform/url-fetch (+https://github.com/jkosmo/a2-assessment-platform)",
        accept: "text/html, application/xhtml+xml, text/plain;q=0.9, */*;q=0.5",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new UrlFetchError("invalid_redirect", "Upstream redirect response missing Location header.");
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw new UrlFetchError("too_many_redirects", `Too many redirects (max ${MAX_REDIRECTS}).`);
      }
      const redirectedUrl = new URL(location, currentUrl);
      currentUrl = await assertSafeUrl(redirectedUrl.toString());
      continue;
    }
    if (!response.ok) {
      throw new UrlFetchError("http_error", `Upstream returned ${response.status}.`);
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const baseType = contentType.split(";")[0].trim();
    if (!ALLOWED_CONTENT_TYPES.includes(baseType)) {
      throw new UrlFetchError("unsupported_content_type", `Content-Type ${baseType || "(missing)"} is not supported.`);
    }
    if (!response.body) {
      throw new UrlFetchError("empty_response", "Upstream returned no body.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > SOURCE_MATERIAL_MAX_BYTES) {
        try { await reader.cancel(); } catch {}
        throw new UrlFetchError("too_large", `Response exceeds ${SOURCE_MATERIAL_MAX_BYTES} bytes.`);
      }
      chunks.push(value);
    }
    return { buffer: Buffer.concat(chunks.map((c) => Buffer.from(c))), contentType: baseType };
  }

  throw new UrlFetchError("too_many_redirects", `Too many redirects (max ${MAX_REDIRECTS}).`);
}

async function extractMainText(buffer: Buffer, contentType: string, sourceUrl: string): Promise<string> {
  if (contentType === "text/plain") {
    return buffer.toString("utf8");
  }
  // HTML / XHTML: use Mozilla Readability for main-content extraction
  const html = buffer.toString("utf8");
  // Lazy-load jsdom + readability to avoid loading them when no URL fetch is used
  const [{ JSDOM }, readabilityModule] = await Promise.all([
    import("jsdom"),
    import("@mozilla/readability"),
  ]);
  const Readability = readabilityModule.Readability;
  const dom = new JSDOM(html, { url: sourceUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article || !article.textContent) {
    throw new UrlFetchError("extraction_failed", "Could not extract main content from page.");
  }
  // Title first (often useful context) + main text
  const title = article.title ? `${article.title}\n\n` : "";
  return `${title}${article.textContent.trim()}`;
}

export async function fetchUrlAsSourceMaterial(rawUrl: string): Promise<UrlFetchResult> {
  const parsedUrl = await assertSafeUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const { buffer, contentType } = await fetchWithLimit(parsedUrl, controller.signal);
    const extractedText = await extractMainText(buffer, contentType, parsedUrl.toString());
    const trimmed = extractedText.trim();
    if (!trimmed) {
      throw new UrlFetchError("empty_extracted_text", "Extracted text is empty.");
    }
    return {
      extractedText: trimmed,
      sourceHostname: parsedUrl.hostname,
      fetchedBytes: buffer.byteLength,
    };
  } catch (err) {
    if (err instanceof UrlFetchError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new UrlFetchError("timeout", `Request timed out after ${FETCH_TIMEOUT_MS}ms.`);
    }
    throw new UrlFetchError("fetch_failed", `Fetch failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// In-memory rate-limit: 10 URL fetches per minute per user. In multi-instance deployment
// this is per-instance (no shared store) — acceptable for v1 since the practical attack
// surface is low and the rate-limit's purpose is mostly to deter accidental abuse.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitBuckets = new Map<string, number[]>();

export function checkAndConsumeRateLimit(userId: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const previous = rateLimitBuckets.get(userId) ?? [];
  const recent = previous.filter((ts) => ts > cutoff);
  if (recent.length >= RATE_LIMIT_MAX) {
    const oldest = recent[0];
    return { allowed: false, retryAfterMs: oldest + RATE_LIMIT_WINDOW_MS - now };
  }
  recent.push(now);
  rateLimitBuckets.set(userId, recent);
  return { allowed: true };
}
