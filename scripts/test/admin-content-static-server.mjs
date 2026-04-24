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
  if (requestPath === "/" || requestPath === "/admin-content") {
    return path.join(publicRoot, "admin-content.html");
  }
  if (requestPath === "/admin-content/advanced") {
    return path.join(publicRoot, "admin-content-advanced.html");
  }
  if (requestPath === "/admin-content/courses" || requestPath === "/admin-content/courses/new") {
    return path.join(publicRoot, "admin-content-courses.html");
  }
  if (/^\/admin-content\/courses\/[^/]+$/.test(requestPath)) {
    return path.join(publicRoot, "admin-content-courses.html");
  }
  if (/^\/admin-content\/module\/[^/]+\/conversation$/.test(requestPath)) {
    return path.join(publicRoot, "admin-content.html");
  }
  if (/^\/admin-content\/module\/[^/]+\/advanced$/.test(requestPath)) {
    return path.join(publicRoot, "admin-content-advanced.html");
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

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const pathname = decodeURIComponent(url.pathname);
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
