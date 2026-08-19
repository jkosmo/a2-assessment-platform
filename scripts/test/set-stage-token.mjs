// Reserveveien til `capture-stage-auth.mjs`: ta imot et access-token du har kopiert selv.
//
// Hovedveien (`npm run stage:auth`) leter i MSAL-cachen etter en nøkkel som inneholder
// "accesstoken". Klarer den ikke det — MSAL har byttet nøkkelformat før — er dette veien rundt,
// uten at testsuiten trenger å vite forskjell.
//
// Bruk:
//   node scripts/test/set-stage-token.mjs "<token>"
//   npm run stage:token -- "<token>"
//
// Slik finner du tokenet manuelt:
//   1. Åpne stage og logg inn.
//   2. F12 → Application → Session Storage → https://…azurewebsites.net
//   3. Finn raden der nøkkelen inneholder «accesstoken». Verdien er JSON.
//   4. Kopier verdien av feltet `secret` — den lange strengen som begynner med «eyJ».
//
// ⚠️ Tokenet er en ekte legitimasjon. Ikke lim det inn i en chat, en issue eller en commit.
// Fila som skrives er gitignorert og utløper av seg selv.

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.STAGE_BASE_URL
  ?? "https://a2-assessment-platform-stg-app-x6eyx4.azurewebsites.net";
const OUT = path.resolve(process.cwd(), ".stage-auth.json");

const raw = process.argv[2]?.trim();
if (!raw) {
  console.error("Bruk: node scripts/test/set-stage-token.mjs \"<access-token>\"");
  process.exit(1);
}

// Godta at man limer inn hele «Bearer eyJ…» eller bare tokenet.
const token = raw.replace(/^Bearer\s+/i, "").trim();

if (!token.startsWith("eyJ")) {
  console.error("Det ser ikke ut som et JWT (skal begynne med «eyJ»). Ingenting er skrevet.");
  process.exit(1);
}

// Les utløpstiden ut av tokenet selv, så suiten kan hoppe over i stedet for å bli rød når det
// går ut. Ingen signaturvalidering her — det er serverens jobb, og vi verifiserer mot /api/me
// like under uansett.
let expiresOn = 0;
try {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  expiresOn = Number(payload.exp ?? 0) * 1000;
} catch {
  expiresOn = 0;
}

const probe = await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
if (!probe.ok) {
  console.error(`Tokenet ble avvist av /api/me (${probe.status}). Ingenting er skrevet.`);
  console.error("Sjekk at du kopierte `secret`-feltet, og at du er logget inn på stage.");
  process.exit(1);
}

const me = await probe.json();
const roles = me?.roles ?? me?.user?.roles ?? [];
const username = me?.email ?? me?.user?.email ?? null;

fs.writeFileSync(
  OUT,
  `${JSON.stringify({ baseUrl: BASE, accessToken: token, expiresOn, username, roles, capturedAt: new Date().toISOString() }, null, 2)}\n`,
);

const minutes = expiresOn ? Math.max(0, Math.round((expiresOn - Date.now()) / 60000)) : null;
console.log(`[stage-auth] Innlogget som ${username ?? "(ukjent)"} · roller: ${roles.join(", ") || "(ingen)"}`);
console.log(`[stage-auth] Skrevet til .stage-auth.json${minutes === null ? "" : ` — gyldig ca. ${minutes} minutter`}.`);
console.log("[stage-auth] Kjør nå:  npm run test:stage");
