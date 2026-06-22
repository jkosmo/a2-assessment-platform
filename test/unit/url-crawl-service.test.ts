import { describe, it, expect, vi } from "vitest";

// #479 Slice B: same-domain crawl. Pure robots/url helpers are tested directly; the crawl
// itself runs against a mocked global.fetch with an IP-literal host (no DNS dependency — the
// SSRF check passes IP literals without a lookup). jsdom + Readability are mocked so the test
// targets the crawl orchestration (BFS, robots gating, same-domain restriction, dedup) rather
// than DOM parsing — Readability text extraction is covered by the single-URL path's tests and
// is too slow to run repeatedly under vitest's transform.
vi.mock("jsdom", () => ({
  JSDOM: class {
    private readonly html: string;
    constructor(html: string) {
      this.html = html;
    }
    get window() {
      const html = this.html;
      return {
        document: {
          querySelectorAll: () =>
            [...html.matchAll(/href="([^"]+)"/g)].map((m) => ({ getAttribute: () => m[1] })),
        },
      };
    }
  },
}));
vi.mock("@mozilla/readability", () => ({
  Readability: class {
    parse() {
      return { title: "Tittel", textContent: "Ekstrahert hovedtekst fra siden." };
    }
  },
}));

const {
  parseRobotsTxt,
  isPathAllowedByRobots,
  normaliseUrlKey,
  crawlUrlAsSourceMaterial,
  checkAndConsumeCrawlRateLimit,
} = await import("../../src/modules/adminContent/urlFetchService.js");

describe("parseRobotsTxt + isPathAllowedByRobots", () => {
  it("applies wildcard Disallow rules", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /private\nDisallow: /tmp\n", "a2assessmentplatform");
    expect(isPathAllowedByRobots(rules, "/private/x")).toBe(false);
    expect(isPathAllowedByRobots(rules, "/tmp")).toBe(false);
    expect(isPathAllowedByRobots(rules, "/public/page")).toBe(true);
  });

  it("prefers a group naming our agent token over the wildcard group", () => {
    const txt = [
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: A2AssessmentPlatform",
      "Disallow: /secret",
    ].join("\n");
    const rules = parseRobotsTxt(txt, "a2assessmentplatform");
    // The specific group wins: only /secret is blocked, everything else allowed.
    expect(isPathAllowedByRobots(rules, "/secret")).toBe(false);
    expect(isPathAllowedByRobots(rules, "/anything")).toBe(true);
  });

  it("longest-match wins and Allow beats Disallow on equal length", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /docs\nAllow: /docs/public\n", "a2");
    expect(isPathAllowedByRobots(rules, "/docs/private")).toBe(false);
    expect(isPathAllowedByRobots(rules, "/docs/public/intro")).toBe(true);
  });

  it("treats an empty Disallow as allow-all", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow:\n", "a2");
    expect(isPathAllowedByRobots(rules, "/whatever")).toBe(true);
  });

  it("supports * wildcard and $ end-anchor patterns", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /*.pdf$\n", "a2");
    expect(isPathAllowedByRobots(rules, "/files/report.pdf")).toBe(false);
    expect(isPathAllowedByRobots(rules, "/files/report.pdf?x=1")).toBe(true); // $ anchors at end
    expect(isPathAllowedByRobots(rules, "/files/report.html")).toBe(true);
  });
});

describe("normaliseUrlKey", () => {
  it("drops the fragment, trailing slash, and lowercases the host", () => {
    expect(normaliseUrlKey(new URL("https://Example.com/path/#frag"))).toBe("https://example.com/path");
    expect(normaliseUrlKey(new URL("https://example.com/"))).toBe("https://example.com/");
    expect(normaliseUrlKey(new URL("https://example.com/a?b=1"))).toBe("https://example.com/a?b=1");
  });
});

describe("crawlUrlAsSourceMaterial", () => {
  const LONG =
    "Dette er en informativ paragraf med nok innhold til at Mozilla Readability " +
    "trekker den ut som hovedtekst på siden, gjentatt flere ganger for tyngde. ";

  function htmlPage(title: string, links: string[]): string {
    const paras = Array.from({ length: 6 }, () => `<p>${LONG}${LONG}</p>`).join("");
    const anchors = links.map((h) => `<a href="${h}">lenke</a>`).join(" ");
    return `<!DOCTYPE html><html><head><title>${title}</title></head><body><article><h1>${title}</h1>${paras}<nav>${anchors}</nav></article></body></html>`;
  }

  it("crawls same-domain pages, honours robots.txt, and ignores external links", async () => {
    const base = "https://93.184.216.34"; // public IP literal → no DNS lookup needed
    const responses: Record<string, { body: string; type: string }> = {
      "/robots.txt": { body: "User-agent: *\nDisallow: /private\n", type: "text/plain" },
      "/": {
        body: htmlPage("Hjem", ["/page1", "/page2", "/private/secret", "https://other.example.org/x"]),
        type: "text/html",
      },
      "/page1": { body: htmlPage("Side 1", []), type: "text/html" },
      "/page2": { body: htmlPage("Side 2", []), type: "text/html" },
    };

    const seen: string[] = [];
    const originalFetch = global.fetch;
    const fetchMock = vi.fn<typeof fetch>((input: Parameters<typeof fetch>[0]) => {
      const href = typeof input === "string" ? input : (input as URL).toString();
      const path = new URL(href).pathname;
      seen.push(path);
      const entry = responses[path];
      if (!entry) return Promise.resolve(new Response("nope", { status: 404 }));
      return Promise.resolve(
        new Response(entry.body, { status: 200, headers: { "content-type": entry.type } }),
      );
    });
    global.fetch = fetchMock as typeof fetch;

    try {
      const result = await crawlUrlAsSourceMaterial(`${base}/`);
      const paths = result.pages.map((p) => new URL(p.url).pathname).sort();
      expect(paths).toEqual(["/", "/page1", "/page2"]);
      expect(result.startHostname).toBe("93.184.216.34");
      expect(result.pagesCrawled).toBe(3);
      // /private/secret is robots-disallowed → counted as skipped, never fetched.
      expect(result.pagesSkipped).toBeGreaterThanOrEqual(1);
      expect(seen).not.toContain("/private/secret");
      // External host never fetched.
      expect(seen.every((p) => !p.includes("other.example.org"))).toBe(true);
      // Each page carries extracted text.
      expect(result.pages.every((p) => p.extractedText.length > 0)).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  }, 15_000);
});

describe("crawl rate-limit", () => {
  it("allows 3 crawls per minute per user, then blocks", () => {
    const userId = `crawl-user-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect(checkAndConsumeCrawlRateLimit(userId).allowed).toBe(true);
    }
    const blocked = checkAndConsumeCrawlRateLimit(userId);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
});
