import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const publicRoot = path.join(repoRoot, "public");
const port = Number.parseInt(process.env.PORT || "4173", 10);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".woff2", "font/woff2"],
]);

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, headers);
  response.end(body);
}

function resolvePublicFile(requestPath) {
  // #613: mirror production — `/admin-content` serves the module library (route-map.md canonical),
  // NOT the conversation shell. The shell (admin-content.html) has no bare production route (it lives
  // at `/admin-content/module/:id/conversation`), so shell e2e loads it via its file path directly.
  if (requestPath === "/" || requestPath === "/admin-content") {
    return path.join(publicRoot, "admin-content-library.html");
  }
  if (requestPath === "/admin-content/courses" || requestPath === "/admin-content/courses/new") {
    return path.join(publicRoot, "admin-content-courses.html");
  }
  if (requestPath === "/admin-content/sections") {
    return path.join(publicRoot, "admin-content-sections.html");
  }
  if (requestPath === "/admin-content/themes") {
    return path.join(publicRoot, "admin-content-themes.html");
  }
  if (requestPath === "/admin-content/calibration") {
    return path.join(publicRoot, "admin-content-calibration.html");
  }
  // #765: classes moved under the «Deltakere» area. Mirror production's canonical route.
  if (requestPath === "/deltakere/klasser") {
    return path.join(publicRoot, "admin-content-classes.html");
  }
  // #498: cohort-status dashboard, a «Deltakere» sub-tab.
  if (requestPath === "/deltakere/status") {
    return path.join(publicRoot, "cohort-status.html");
  }
  // #1099: «Aktivitet», en fane under Deltakere.
  if (requestPath === "/deltakere/aktivitet") {
    return path.join(publicRoot, "participant-activity.html");
  }
  if (requestPath === "/review") {
    return path.join(publicRoot, "review.html");
  }
  if (requestPath === "/results") {
    return path.join(publicRoot, "results.html");
  }
  if (requestPath === "/participant") {
    return path.join(publicRoot, "participant.html");
  }
  if (requestPath === "/participant/completed") {
    return path.join(publicRoot, "participant-completed.html");
  }
  if (requestPath === "/certificate") {
    return path.join(publicRoot, "certificate.html");
  }
  if (requestPath === "/profile") {
    return path.join(publicRoot, "profile.html");
  }
  // #953: administratorflaten «Vurderinger som ga opp» ligger her. Uten ruta faller /admin-platform
  // gjennom til en katalog og gir 404 — og en e2e som spør «er kortet skjult?» ville bestått, fordi
  // et element som ikke finnes også er skjult.
  if (requestPath === "/admin-platform") {
    return path.join(publicRoot, "admin-platform.html");
  }
  if (/^\/admin-content\/courses\/[^/]+$/.test(requestPath)) {
    return path.join(publicRoot, "admin-content-courses.html");
  }
  if (/^\/admin-content\/module\/[^/]+\/conversation$/.test(requestPath)) {
    return path.join(publicRoot, "admin-content.html");
  }
  // #896 S3c: production redirects the Avansert routes into the workspace. Mirror that here, or
  // an e2e that still navigates to /advanced would 404 instead of behaving like the real thing.
  if (/^\/admin-content\/module\/[^/]+\/advanced$/.test(requestPath)) {
    return path.join(publicRoot, "admin-content.html");
  }

  if (requestPath.startsWith("/static/i18n/")) {
    return path.join(publicRoot, "i18n", requestPath.slice("/static/i18n/".length));
  }

  if (requestPath.startsWith("/static/")) {
    const relative = requestPath.slice("/static/".length);
    const staticCandidate = path.join(publicRoot, "static", relative);
    if (fs.existsSync(staticCandidate)) return staticCandidate;
    return path.join(publicRoot, relative);
  }

  return path.join(publicRoot, requestPath.replace(/^\/+/, ""));
}

// Ikonbiblioteket (#1079): i produksjon tegner ruta src/routes/icons.ts ikonet fra den innsjekkede
// biblioteksfila. Denne tjeneren har ikke appen, så den gjør det samme her (samme ramme som ruta), slik
// at en e2e kan måle et ekte ikon i leseren. Ruta selv er målt i enhetstesten.
let iconBundle = null;
function iconSvg(name) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return null;
  if (!iconBundle) iconBundle = JSON.parse(fs.readFileSync(path.join(publicRoot, "static", "icons", "lucide-icons.json"), "utf8"));
  if (!Object.hasOwn(iconBundle.icons, name)) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#33312b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconBundle.icons[name]}</svg>`;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const pathname = decodeURIComponent(url.pathname);
  const icon = /^\/static\/icons\/([^/]+)\.svg$/.exec(pathname);
  if (icon) {
    const svg = iconSvg(icon[1]);
    if (svg) send(response, 200, svg, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" });
    else send(response, 404, "Not found");
    return;
  }
  const resolvedPath = resolvePublicFile(pathname);

  if (!resolvedPath.startsWith(publicRoot)) {
    send(response, 403, "Forbidden");
    return;
  }

  fs.readFile(resolvedPath, (error, file) => {
    if (error) {
      send(response, 404, "Not found");
      return;
    }

    const extension = path.extname(resolvedPath).toLowerCase();
    send(response, 200, file, {
      "Content-Type": contentTypes.get(extension) || "application/octet-stream",
      "Cache-Control": "no-store",
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`admin-content static server listening on http://127.0.0.1:${port}\n`);
});
