// 2.105.0: henter et token for stage-testkontoen — uten nettleser og uten at noen logger inn.
//
// Kontoen er en app-registrering i Entra med en klienthemmelighet (src/auth/stageTestService.ts sier
// hva plattformen godtar fra den: bare på stage, og bare som fagansvarlig). Hemmeligheten ligger i
// den gitignorerte `.stage-service.json`:
//
//   { "tenantId": "…", "clientId": "…", "clientSecret": "…", "audience": "…" }
//
// `audience` er stage-appens ENTRA_AUDIENCE. Tokenet skrives til `.stage-service-auth.json` (også
// gitignorert) i samme form som `npm run stage:auth` skriver, og stage-testene bruker det når det
// personlige tokenet mangler eller er utløpt (test/stage/stageAuth.ts).
//
// Kjør:  npm run stage:auth:service
//
// ⚠️ Verken hemmeligheten eller tokenet skal logges, deles eller committes.

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.STAGE_BASE_URL ?? "https://a2-assessment-platform-stg-app-x6eyx4.azurewebsites.net";
const SECRET_FILE = path.resolve(process.cwd(), ".stage-service.json");
const OUT = path.resolve(process.cwd(), ".stage-service-auth.json");

const log = (message) => console.log(`[stage-auth:service] ${message}`);

if (!fs.existsSync(SECRET_FILE)) {
  log("fant ikke .stage-service.json — se kommentaren øverst i dette skriptet");
  process.exit(1);
}
const { tenantId, clientId, clientSecret, audience } = JSON.parse(fs.readFileSync(SECRET_FILE, "utf8"));
for (const [name, value] of Object.entries({ tenantId, clientId, clientSecret, audience })) {
  if (typeof value !== "string" || value.trim() === "") {
    log(`.stage-service.json mangler «${name}»`);
    process.exit(1);
  }
}

const scope = `${audience}/.default`;
const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok || typeof body.access_token !== "string") {
  // Feilkoden fra Entra (AADSTS…) er trygg å vise; hemmeligheten står aldri i svaret.
  log(`Entra ga ikke token: ${body.error ?? response.status} ${String(body.error_description ?? "").split("\n")[0]}`);
  process.exit(1);
}

// Prøv tokenet mot stage før det lagres: et token stage avviser, er ikke en innlogging.
const me = await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${body.access_token}` } });
const meBody = await me.json().catch(() => ({}));
if (!me.ok) {
  log(`stage avviste tokenet (${me.status}). Er DEPLOY_ENVIRONMENT=staging og STAGE_TEST_SERVICE_APP_ID satt på stage?`);
  process.exit(1);
}

const expiresOn = Date.now() + Number(body.expires_in ?? 3600) * 1000;
fs.writeFileSync(
  OUT,
  JSON.stringify({ baseUrl: BASE, accessToken: body.access_token, expiresOn, username: meBody?.user?.email ?? null, roles: meBody?.user?.roles ?? [] }, null, 2),
  "utf8",
);
log(`lagret ${path.basename(OUT)} — gyldig i ${Math.round((expiresOn - Date.now()) / 60000)} min, roller: ${(meBody?.user?.roles ?? []).join(", ") || "ingen"}`);
