// #454 Phase 1: server-side URL fetcher for kildemateriale-steget. Brukeren limer inn en URL,
// vi henter HTML/PDF/RTF/plain text, ekstraherer hovedtekst (Mozilla Readability for HTML), og
// returnerer som vanlig source material. Erstatter brukerens workaround der de gikk til ekstern
// LLM kun for å fetche URL-er.

import { lookup as dnsLookup } from "node:dns/promises";
import { lookup as dnsLookupCallback } from "node:dns";
import { isIPv4, isIPv6 } from "node:net";
import { Agent } from "undici";

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
// metadata endpoints. Two layers: (1) assertSafeUrl validates the hostname's resolved IPs up
// front; (2) the fetch uses ssrfSafeDispatcher whose connect-time lookup re-validates the IP it
// actually connects to — closing the DNS-rebinding / TOCTOU window (#520).
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

// #520: close the DNS-rebinding / TOCTOU window. assertSafeUrl validates the hostname's resolved
// IPs up front, but a low-TTL attacker record could return a public IP then (the check) and a
// private IP at connect time (the fetch's own resolve). This custom lookup is the resolution the
// fetch actually uses to connect, and it re-validates every resolved address — so the IP we connect
// to is guaranteed public. Exported for unit testing.
export function createValidatingLookup(
  resolver: typeof dnsLookupCallback = dnsLookupCallback,
) {
  return function validatingLookup(
    hostname: string,
    options: Parameters<typeof dnsLookupCallback>[1],
    callback: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
  ): void {
    const opts = typeof options === "object" && options !== null ? options : {};
    resolver(hostname, { ...opts, all: true, verbatim: true }, (err, addresses) => {
      if (err) {
        callback(err, "", 0);
        return;
      }
      const list = Array.isArray(addresses) ? addresses : [];
      if (list.length === 0) {
        callback(new UrlFetchError("dns_failed", `Could not resolve hostname (${hostname}).`), "", 0);
        return;
      }
      for (const entry of list) {
        if (isPrivateIp(entry.address)) {
          callback(
            new UrlFetchError(
              "private_address",
              `URL hostname (${hostname}) resolved to a private address (${entry.address}) at connect time.`,
            ),
            "",
            0,
          );
          return;
        }
      }
      // All resolved addresses validated as public — hand them to undici (pinned).
      if ((opts as { all?: boolean }).all) {
        callback(null, list);
      } else {
        callback(null, list[0].address, list[0].family);
      }
    });
  };
}

// Shared dispatcher whose connect step re-validates the resolved IP (#520).
const ssrfSafeDispatcher = new Agent({
  connect: { lookup: createValidatingLookup() as never },
});

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
// Redirects are followed MANUALLY so each hop is re-validated against the SSRF policy
// (assertSafeUrl) — automatic redirect-following would let an attacker-controlled redirect
// reach a private/internal address despite the initial host being public (#504).
const MAX_REDIRECTS = 5;

async function fetchWithLimit(parsedUrl: URL, signal: AbortSignal): Promise<{ buffer: Buffer; contentType: string }> {
  let currentUrl = parsedUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    // Node's global fetch is undici under the hood and honors a `dispatcher` option (not in the
    // TS RequestInit type), so we keep using global fetch (test-mockable) while routing through the
    // SSRF-safe dispatcher for connect-time IP re-validation (#520).
    const response = await fetch(currentUrl.toString(), {
      method: "GET",
      redirect: "manual",
      signal,
      dispatcher: ssrfSafeDispatcher,
      headers: {
        // Be polite: identify ourselves
        "user-agent": "A2AssessmentPlatform/url-fetch (+https://github.com/jkosmo/a2-assessment-platform)",
        accept: "text/html, application/xhtml+xml, text/plain;q=0.9, */*;q=0.5",
      },
    } as RequestInit & { dispatcher: unknown });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new UrlFetchError("invalid_redirect", "Upstream redirect response missing Location header.");
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw new UrlFetchError("too_many_redirects", `Too many redirects (max ${MAX_REDIRECTS}).`);
      }
      const redirectedUrl = new URL(location, currentUrl);
      // Re-validate the redirect target against the full SSRF policy before following.
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
  return consumeBucket(rateLimitBuckets, userId, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
}

function consumeBucket(
  buckets: Map<string, number[]>,
  userId: string,
  max: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const previous = buckets.get(userId) ?? [];
  const recent = previous.filter((ts) => ts > cutoff);
  if (recent.length >= max) {
    const oldest = recent[0];
    return { allowed: false, retryAfterMs: oldest + windowMs - now };
  }
  recent.push(now);
  buckets.set(userId, recent);
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// #479 Slice B: same-domain crawl. Given a start URL, fetch up to CRAWL_MAX_PAGES
// pages within CRAWL_MAX_DEPTH hops, restricted to the start hostname, honouring
// robots.txt, with a politeness delay between fetches. Every page is independently
// SSRF-revalidated (assertSafeUrl + the pinned dispatcher) and byte-capped via the same
// fetchWithLimit primitive as the single-URL path. A single page failure is skipped,
// not fatal — the crawl returns whatever it gathered.
// ---------------------------------------------------------------------------

const CRAWL_MAX_PAGES = 20;
const CRAWL_MAX_DEPTH = 2;
const CRAWL_DELAY_MS = 300;
// Combined byte budget across all crawled pages (each page is also individually capped at
// SOURCE_MATERIAL_MAX_BYTES by fetchWithLimit).
const CRAWL_TOTAL_BYTE_BUDGET = SOURCE_MATERIAL_MAX_BYTES;
const ROBOTS_FETCH_TIMEOUT_MS = 5_000;
// Robots agent token: a robots `User-agent:` line matches us if it is a case-insensitive
// substring of this token. Matches the product token in the fetch User-Agent header.
const CRAWL_USER_AGENT_TOKEN = "a2assessmentplatform";
const CRAWL_UA_HEADER =
  "A2AssessmentPlatform/url-crawl (+https://github.com/jkosmo/a2-assessment-platform)";

export interface CrawlPage {
  url: string;
  title: string | null;
  extractedText: string;
  fetchedBytes: number;
}

export interface CrawlResult {
  startHostname: string;
  pages: CrawlPage[];
  pagesCrawled: number;
  pagesSkipped: number;
  totalBytes: number;
  truncated: boolean;
}

export interface RobotsRules {
  disallow: string[];
  allow: string[];
}

// Minimal robots.txt parser (no external dependency). Groups directives by User-agent,
// then selects the most specific group that applies to us: a group naming our token wins
// over the wildcard `*` group. Returns the merged Disallow/Allow paths for that group.
export function parseRobotsTxt(txt: string, userAgentToken: string): RobotsRules {
  const groups: Array<{ agents: string[]; disallow: string[]; allow: string[] }> = [];
  let current: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      // Consecutive User-agent lines share one group; a non-agent line closes the group.
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "disallow" || field === "allow") {
      if (!current) {
        current = { agents: ["*"], disallow: [], allow: [] };
        groups.push(current);
      }
      if (field === "disallow") current.disallow.push(value);
      else current.allow.push(value);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const token = userAgentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const wildcard = groups.filter((g) => g.agents.includes("*"));
  const chosen = specific.length > 0 ? specific : wildcard;
  const rules: RobotsRules = { disallow: [], allow: [] };
  for (const g of chosen) {
    rules.disallow.push(...g.disallow);
    rules.allow.push(...g.allow);
  }
  return rules;
}

// Translates a robots path pattern (supporting `*` wildcards and a trailing `$` anchor)
// into an anchored RegExp and tests it against the request path.
function matchesRobotsPattern(pattern: string, pathname: string): boolean {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") regex += ".*";
    else if (ch === "$" && i === pattern.length - 1) regex += "$";
    else regex += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  try {
    return new RegExp(regex).test(pathname);
  } catch {
    return pathname.startsWith(pattern.split("*")[0]);
  }
}

// Google-style longest-match semantics: the longest matching rule wins; on an equal-length
// tie, Allow beats Disallow. An empty Disallow value means "allow everything".
export function isPathAllowedByRobots(rules: RobotsRules, pathname: string): boolean {
  let bestDisallow = -1;
  let bestAllow = -1;
  for (const rule of rules.disallow) {
    if (rule === "") continue;
    if (matchesRobotsPattern(rule, pathname)) bestDisallow = Math.max(bestDisallow, rule.length);
  }
  for (const rule of rules.allow) {
    if (rule === "") continue;
    if (matchesRobotsPattern(rule, pathname)) bestAllow = Math.max(bestAllow, rule.length);
  }
  if (bestDisallow === -1) return true;
  return bestAllow >= bestDisallow;
}

// Canonical key for dedup: scheme + host(:port) + path (no trailing slash) + query, fragment dropped.
export function normaliseUrlKey(u: URL): string {
  const path = u.pathname.replace(/\/+$/, "") || "/";
  const port = u.port ? `:${u.port}` : "";
  return `${u.protocol}//${u.hostname.toLowerCase()}${port}${path}${u.search}`;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Fetches robots.txt for an origin. Any failure (network, non-2xx, redirect, parse) yields
// permissive rules — standard crawler behaviour when robots.txt is absent or unreachable.
async function fetchRobotsRules(origin: string): Promise<RobotsRules> {
  const permissive: RobotsRules = { disallow: [], allow: [] };
  let robotsUrl: URL;
  try {
    robotsUrl = await assertSafeUrl(new URL("/robots.txt", origin).toString());
  } catch {
    return permissive;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROBOTS_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(robotsUrl.toString(), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      dispatcher: ssrfSafeDispatcher,
      headers: { "user-agent": CRAWL_UA_HEADER, accept: "text/plain, */*;q=0.5" },
    } as RequestInit & { dispatcher: unknown });
    if (!response.ok) return permissive;
    const txt = await response.text();
    return parseRobotsTxt(txt, CRAWL_USER_AGENT_TOKEN);
  } catch {
    return permissive;
  } finally {
    clearTimeout(timeout);
  }
}

// Extracts both main text (Readability) and same-document links from an HTML page. Links are
// collected BEFORE Readability runs because Readability mutates/strips the DOM.
async function extractTextAndLinks(
  buffer: Buffer,
  contentType: string,
  sourceUrl: string,
): Promise<{ text: string; title: string | null; links: string[] }> {
  if (contentType === "text/plain") {
    return { text: buffer.toString("utf8"), title: null, links: [] };
  }
  const html = buffer.toString("utf8");
  const [{ JSDOM }, readabilityModule] = await Promise.all([
    import("jsdom"),
    import("@mozilla/readability"),
  ]);
  const dom = new JSDOM(html, { url: sourceUrl });
  const doc = dom.window.document;
  const links: string[] = [];
  for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    try {
      links.push(new URL(href, sourceUrl).toString());
    } catch {
      // skip unparseable href
    }
  }
  const reader = new readabilityModule.Readability(doc);
  const article = reader.parse();
  const title = article?.title ?? null;
  const body = article?.textContent?.trim() ?? "";
  const text = title ? `${title}\n\n${body}` : body;
  return { text, title, links };
}

export async function crawlUrlAsSourceMaterial(rawUrl: string): Promise<CrawlResult> {
  const startUrl = await assertSafeUrl(rawUrl);
  const startHostname = startUrl.hostname;
  const robots = await fetchRobotsRules(startUrl.origin);

  const visited = new Set<string>();
  const queue: Array<{ url: URL; depth: number }> = [{ url: startUrl, depth: 0 }];
  const pages: CrawlPage[] = [];
  let pagesSkipped = 0;
  let totalBytes = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (pages.length >= CRAWL_MAX_PAGES) {
      truncated = true;
      break;
    }
    const { url, depth } = queue.shift() as { url: URL; depth: number };
    const key = normaliseUrlKey(url);
    if (visited.has(key)) continue;
    visited.add(key);
    if (url.hostname !== startHostname) continue;
    if (!isPathAllowedByRobots(robots, url.pathname + url.search)) {
      pagesSkipped++;
      continue;
    }

    let safeUrl: URL;
    try {
      safeUrl = await assertSafeUrl(url.toString());
    } catch {
      pagesSkipped++;
      continue;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const { buffer, contentType } = await fetchWithLimit(safeUrl, controller.signal);
      const { text, title, links } = await extractTextAndLinks(buffer, contentType, safeUrl.toString());
      const trimmed = text.trim();
      if (trimmed) {
        if (totalBytes + buffer.byteLength > CRAWL_TOTAL_BYTE_BUDGET) {
          truncated = true;
          break;
        }
        totalBytes += buffer.byteLength;
        pages.push({ url: safeUrl.toString(), title, extractedText: trimmed, fetchedBytes: buffer.byteLength });
      }
      if (depth < CRAWL_MAX_DEPTH) {
        for (const link of links) {
          let linkUrl: URL;
          try {
            linkUrl = new URL(link);
          } catch {
            continue;
          }
          if (!ALLOWED_PROTOCOLS.has(linkUrl.protocol)) continue;
          if (linkUrl.hostname !== startHostname) continue;
          if (visited.has(normaliseUrlKey(linkUrl))) continue;
          queue.push({ url: linkUrl, depth: depth + 1 });
        }
      }
    } catch {
      pagesSkipped++;
    } finally {
      clearTimeout(timeout);
    }

    if (queue.length > 0 && pages.length < CRAWL_MAX_PAGES) {
      await delay(CRAWL_DELAY_MS);
    }
  }

  if (pages.length === 0) {
    throw new UrlFetchError("crawl_empty", "No pages could be crawled from the start URL.");
  }
  return { startHostname, pages, pagesCrawled: pages.length, pagesSkipped, totalBytes, truncated };
}

// Crawl is far heavier than a single fetch (up to CRAWL_MAX_PAGES requests), so it gets its
// own, stricter per-user budget.
const CRAWL_RATE_LIMIT_MAX = 3;
const crawlRateLimitBuckets = new Map<string, number[]>();

export function checkAndConsumeCrawlRateLimit(userId: string): { allowed: boolean; retryAfterMs?: number } {
  return consumeBucket(crawlRateLimitBuckets, userId, CRAWL_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
}
