import type { NextFunction, Request, Response } from "express";

// #393: defense-in-depth response headers. The dominant win is a strict
// `script-src 'self'` — possible because MSAL is now vendored locally
// (public/static/vendor/) and the app has zero inline <script> blocks and zero
// inline event handlers. A future script-injection therefore cannot execute.
//
// Directive notes:
// - style-src keeps 'unsafe-inline' because every page uses inline <style> blocks and
//   style="..." attributes. Style injection is far lower risk than script injection.
// - connect-src / frame-src / form-action allow the Entra (Microsoft) login origin so
//   MSAL's silent-token iframe, token fetches, and redirect login keep working.
// - img-src allows blob: so course-section asset images (#483/F4) can render: a plain
//   <img src="/api/content-assets/<id>"> can't carry the auth headers the endpoint requires,
//   so the client fetches each image with auth and swaps in a locally-created blob: URL.
//   blob: is same-origin and only constructable by our own JS — no external load vector.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://login.microsoftonline.com https://*.microsoftonline.com",
  "frame-src https://login.microsoftonline.com https://*.microsoftonline.com",
  "form-action 'self' https://login.microsoftonline.com https://*.microsoftonline.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeadersMiddleware(_request: Request, response: Response, next: NextFunction) {
  response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
}
