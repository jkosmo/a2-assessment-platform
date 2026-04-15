const baseUrlInput = process.env.SMOKE_BASE_URL ?? "";
const workerUrlInput = process.env.SMOKE_WORKER_URL ?? "";
const expectedAuthMode = process.env.SMOKE_EXPECT_AUTH_MODE ?? "";
const expectedTenantId = process.env.SMOKE_EXPECT_ENTRA_TENANT_ID ?? "";
const expectedClientId = process.env.SMOKE_EXPECT_ENTRA_CLIENT_ID ?? "";
const expectedAudience = process.env.SMOKE_EXPECT_ENTRA_AUDIENCE ?? "";

if (!baseUrlInput.trim()) {
  throw new Error("SMOKE_BASE_URL is required.");
}

const baseUrl = new URL(baseUrlInput.endsWith("/") ? baseUrlInput : `${baseUrlInput}/`);
const workerUrl = workerUrlInput.trim()
  ? new URL(workerUrlInput.endsWith("/") ? workerUrlInput : `${workerUrlInput}/`)
  : null;

const htmlRoutes = [
  { path: "/participant", marker: '/static/participant.js' },
  { path: "/participant/completed", marker: '/static/participant-completed.js' },
  { path: "/review", marker: '/static/review.js' },
  { path: "/calibration", marker: '/static/calibration.js' },
  { path: "/results", marker: '/static/results.js' },
  { path: "/admin-content", marker: '/static/admin-content-shell.js' },
  { path: "/admin-content/advanced", marker: '/static/admin-content.js' },
  { path: "/profile", marker: '/static/profile.js' },
  { path: "/admin-platform", marker: '/static/admin-platform.js' },
];

function logPass(message) {
  console.log(`PASS ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchText(url, expectedStatus = 200) {
  const response = await fetch(url, { redirect: "manual" });
  const body = await response.text();
  assert(response.status === expectedStatus, `${url} returned ${response.status}, expected ${expectedStatus}.`);
  return {
    body,
    contentType: response.headers.get("content-type") ?? "",
  };
}

async function fetchJson(url, expectedStatus = 200) {
  const response = await fetch(url, { redirect: "manual" });
  const raw = await response.text();
  assert(response.status === expectedStatus, `${url} returned ${response.status}, expected ${expectedStatus}.`);

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`${url} did not return valid JSON.`);
  }

  return {
    body,
    contentType: response.headers.get("content-type") ?? "",
  };
}

async function verifyHealth() {
  const { body } = await fetchJson(new URL("/healthz", baseUrl));
  assert(body.status === "ok", "/healthz did not return status=ok.");
  assert(typeof body.version === "string" && body.version.length > 0, "/healthz did not include version.");
  logPass(`/healthz on ${baseUrl.origin}`);

  if (!workerUrl) {
    return;
  }

  const { body: workerBody } = await fetchJson(new URL("/healthz", workerUrl));
  assert(workerBody.status === "ok", "Worker /healthz did not return status=ok.");
  logPass(`/healthz on worker ${workerUrl.origin}`);
}

async function verifyVersion() {
  const { body } = await fetchJson(new URL("/version", baseUrl));
  assert(typeof body.app === "string" && body.app.length > 0, "/version did not include app.");
  assert(typeof body.version === "string" && body.version.length > 0, "/version did not include version.");
  logPass("/version");
}

async function verifyParticipantConfig() {
  const { body } = await fetchJson(new URL("/participant/config", baseUrl));
  assert(typeof body.authMode === "string", "/participant/config did not include authMode.");

  if (expectedAuthMode) {
    assert(body.authMode === expectedAuthMode, `/participant/config authMode was ${body.authMode}, expected ${expectedAuthMode}.`);
  }

  if (body.authMode === "entra") {
    assert(body.entra && typeof body.entra === "object", "/participant/config did not include entra config.");
    assert(typeof body.entra.clientId === "string" && body.entra.clientId.length > 0, "Entra config missing clientId.");
    assert(typeof body.entra.authority === "string" && body.entra.authority.length > 0, "Entra config missing authority.");
    assert(Array.isArray(body.entra.scopes) && body.entra.scopes.length > 0, "Entra config missing scopes.");

    if (expectedClientId) {
      assert(body.entra.clientId === expectedClientId, `Entra clientId was ${body.entra.clientId}, expected ${expectedClientId}.`);
    }
    if (expectedTenantId) {
      assert(body.entra.authority.includes(expectedTenantId), `Entra authority ${body.entra.authority} did not include tenant ${expectedTenantId}.`);
    }
    if (expectedAudience) {
      assert(
        body.entra.scopes.includes(`${expectedAudience}/.default`),
        `Entra scopes did not include ${expectedAudience}/.default.`,
      );
    }
  }

  assert(body.debugMode === false, "/participant/config exposed debugMode=true.");
  logPass("/participant/config");
}

async function verifyHtmlRoutes() {
  for (const route of htmlRoutes) {
    const { body, contentType } = await fetchText(new URL(route.path, baseUrl));
    assert(contentType.includes("text/html"), `${route.path} did not return HTML.`);
    assert(body.toLowerCase().includes("<!doctype html>"), `${route.path} did not look like an HTML document.`);
    assert(body.includes(route.marker), `${route.path} did not include expected script marker ${route.marker}.`);
    logPass(route.path);
  }
}

async function verifyAuthBarrier() {
  const response = await fetch(new URL("/api/me", baseUrl), { redirect: "manual" });
  const raw = await response.text();
  assert(response.status === 401, `/api/me without token returned ${response.status}, expected 401.`);

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error("/api/me without token did not return JSON.");
  }

  assert(body.error === "unauthorized", `/api/me returned unexpected error payload: ${raw}`);
  logPass("/api/me unauthorized barrier");
}

async function main() {
  console.log(`Running smoke test for ${baseUrl.origin}`);
  await verifyHealth();
  await verifyVersion();
  await verifyParticipantConfig();
  await verifyHtmlRoutes();
  await verifyAuthBarrier();
  console.log("Smoke test completed successfully.");
}

await main();
