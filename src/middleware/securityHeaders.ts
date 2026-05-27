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
// - blob: is intentionally NOT listed: the only blob: usage is <a download> CSV/JSON
//   exports, which are downloads (not CSP-governed resource loads).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
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
