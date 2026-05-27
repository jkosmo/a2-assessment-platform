# Vendoring `@azure/msal-browser` (#393)

The MSAL browser library is **vendored** — a pinned copy is committed to the repo and
served from our own origin — instead of loaded from Microsoft's CDN (`alcdn.msauth.net`).

## Why

Loading MSAL from an external CDN means a compromised CDN response would execute in our
application origin and could read tokens or call APIs as the victim. A local copy removes
that external attack surface and lets us enforce a strict `script-src 'self'`
Content-Security-Policy (see `src/middleware/securityHeaders.ts`).

## Current pinned version

- **Version:** `2.38.0`
- **File:** `public/static/vendor/msal-browser-2.38.0.min.js`
- **Served at:** `/static/vendor/msal-browser-2.38.0.min.js`
- **Loaded by:** `public/api-client.js` → `loadMsalScript()`, with an SRI `integrity` hash
  and `crossorigin="anonymous"`.
- **SRI:** `sha384-mz+8Q3jA4XBFbnyAsyQegn/0LHvziH7qHLBa9GzcU3HzeWj9J16SXM5S+TsmPBy0`

> Note: 2.38.0 is the version the app already ran from the CDN; vendoring deliberately
> froze the *known-good* version. Upgrading to MSAL v3/v4 is a separate, larger task.

## How to update the vendored copy

1. Fetch the exact version from npm (canonical provenance) without polluting `node_modules`:
   ```bash
   TMP=$(mktemp -d) && cd "$TMP"
   npm pack @azure/msal-browser@<NEW_VERSION>
   tar -xzf azure-msal-browser-<NEW_VERSION>.tgz
   ```
2. Copy the minified build into the vendor directory (new versioned filename):
   ```bash
   cp package/lib/msal-browser.min.js \
     <repo>/public/static/vendor/msal-browser-<NEW_VERSION>.min.js
   ```
3. Compute the new SRI hash:
   ```bash
   python -c "import hashlib,base64; d=open('public/static/vendor/msal-browser-<NEW_VERSION>.min.js','rb').read(); print('sha384-'+base64.b64encode(hashlib.sha384(d).digest()).decode())"
   ```
4. Update `public/api-client.js` `loadMsalScript()`: bump the `src` filename and the
   `integrity` hash. Remove the old vendored file.
5. Update this document's version + SRI.
6. Verify Entra login still works in participant, reviewer, report, and admin workspaces,
   and confirm DevTools Network shows MSAL loading from `/static/vendor/...` (not a CDN).

## Maintenance note

Because the copy is local, MSAL no longer auto-updates. Track upstream MSAL security
advisories and re-vendor when a relevant fix is released.
