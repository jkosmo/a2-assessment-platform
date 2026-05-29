// @vitest-environment node
//
// #355: defense-in-depth validation of the sessionStorage-recovered redirect URL used
// after MSAL handleRedirectPromise. The function must be pure (no DOM) and must reject
// anything that is not a same-origin URL with an internal path.

import { describe, expect, it } from "vitest";
// @ts-expect-error — public/api-client.js is a browser ES module (no .d.ts); we import the
// pure helper only and rely on the JS module's named export. The other code paths in the
// file are not exercised here.
import { isSafeSameOriginRedirect } from "../../public/api-client.js";

const SELF = "https://app.example.com";

describe("isSafeSameOriginRedirect", () => {
  it("accepts same-origin internal paths", () => {
    expect(isSafeSameOriginRedirect(`${SELF}/`, SELF)).toBe(true);
    expect(isSafeSameOriginRedirect(`${SELF}/admin-content`, SELF)).toBe(true);
    expect(isSafeSameOriginRedirect(`${SELF}/admin-content?id=5&tab=settings`, SELF)).toBe(true);
    expect(isSafeSameOriginRedirect(`${SELF}/admin-content#section`, SELF)).toBe(true);
  });

  it("rejects different-origin URLs", () => {
    expect(isSafeSameOriginRedirect("https://evil.example.com/", SELF)).toBe(false);
    expect(isSafeSameOriginRedirect("https://app.example.com.evil.com/", SELF)).toBe(false);
    expect(isSafeSameOriginRedirect("http://app.example.com/", SELF)).toBe(false); // wrong scheme
    expect(isSafeSameOriginRedirect("https://app.example.com:8443/", SELF)).toBe(false); // wrong port
  });

  it("rejects javascript:, data:, and other opaque-origin schemes", () => {
    expect(isSafeSameOriginRedirect("javascript:alert(1)", SELF)).toBe(false);
    expect(isSafeSameOriginRedirect("data:text/html,<script>alert(1)</script>", SELF)).toBe(false);
    expect(isSafeSameOriginRedirect("vbscript:msgbox(1)", SELF)).toBe(false);
  });

  it("rejects relative and protocol-relative URLs (no base URL is provided to new URL)", () => {
    expect(isSafeSameOriginRedirect("/admin-content", SELF)).toBe(false);
    expect(isSafeSameOriginRedirect("//evil.example.com/", SELF)).toBe(false);
    expect(isSafeSameOriginRedirect("admin-content", SELF)).toBe(false);
  });

  it("rejects empty / non-string / malformed input", () => {
    expect(isSafeSameOriginRedirect("", SELF)).toBe(false);
    expect(isSafeSameOriginRedirect(null as unknown as string, SELF)).toBe(false);
    expect(isSafeSameOriginRedirect(undefined as unknown as string, SELF)).toBe(false);
    expect(isSafeSameOriginRedirect(42 as unknown as string, SELF)).toBe(false);
    expect(isSafeSameOriginRedirect("not a url", SELF)).toBe(false);
  });

  it("rejects when currentOrigin is empty (guards a misused call site)", () => {
    expect(isSafeSameOriginRedirect(`${SELF}/`, "")).toBe(false);
    expect(isSafeSameOriginRedirect(`${SELF}/`, null as unknown as string)).toBe(false);
  });
});
