// Fanger en ekte Entra-sesjon fra stage, slik at Playwright kan teste mot REELLE data.
//
// Bakgrunn: stage kjører `authMode: "entra"`, og mock-identitetsheadere ignoreres der (CLAUDE.md).
// Agent-tokens duger ikke — de er en skriv-bare hviteliste for utkastforfatting og kan ikke LESE
// eksisterende innhold, som er nettopp det vi trenger for å prøve publiseringsgaten mot gammelt
// innhold.
//
// Hvorfor ikke Playwrights `storageState`: appen bruker MSAL med `cacheLocation: "sessionStorage"`
// (`public/api-client.js:58`), og `storageState` fanger cookies + localStorage — ikke
// sessionStorage. Vi henter derfor access-tokenet direkte fra MSAL-cachen etter innlogging.
//
// Kjør:  npm run stage:auth
//
// ⚠️ Fila som skrives inneholder et EKTE token for DIN bruker mot stage. Den er gitignorert og
// skal aldri committes, deles eller logges. Tokenet utløper av seg selv (typisk ~1 time) — det er
// en funksjon, ikke en ulempe: en gammel fangst kan ikke bli liggende og gi tilgang i det stille.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.STAGE_BASE_URL
  ?? "https://a2-assessment-platform-stg-app-x6eyx4.azurewebsites.net";
const OUT = path.resolve(process.cwd(), ".stage-auth.json");
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function log(message) {
  console.log(`[stage-auth] ${message}`);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

log(`Åpner ${BASE}/admin-content — logg inn i vinduet som dukker opp.`);
log("Ingenting skrives før du er innlogget. Lukk vinduet for å avbryte.");

await page.goto(`${BASE}/admin-content`, { waitUntil: "domcontentloaded" });

// Vent til MSAL har en konto i sessionStorage. Vi poller framfor å vente på en URL, fordi
// Entra-flyten går gjennom flere redirects og kan innom MFA — antall steg er ikke vårt å kjenne.
const deadline = Date.now() + LOGIN_TIMEOUT_MS;
let session = null;

while (Date.now() < deadline) {
  try {
    session = await page.evaluate(() => {
      const entries = Object.entries(sessionStorage);
      // MSAL v2 lagrer access-tokenet under en nøkkel som inneholder "accesstoken".
      const tokenEntry = entries.find(([key]) => key.toLowerCase().includes("accesstoken"));
      if (!tokenEntry) return null;
      let parsed;
      try {
        parsed = JSON.parse(tokenEntry[1]);
      } catch {
        return null;
      }
      if (!parsed?.secret) return null;
      const accountEntry = entries.find(([key]) => key.toLowerCase().includes("-login.windows.net-")
        && !key.toLowerCase().includes("token"));
      let username = null;
      try {
        username = accountEntry ? JSON.parse(accountEntry[1])?.username ?? null : null;
      } catch {
        username = null;
      }
      return {
        accessToken: parsed.secret,
        // MSAL lagrer utløp som sekunder siden epoch, i en streng.
        expiresOn: Number(parsed.expiresOn ?? 0) * 1000,
        username,
      };
    });
  } catch {
    // Navigasjon midt i en evaluate gir en kastet feil. Ikke interessant — prøv igjen.
    session = null;
  }

  if (session?.accessToken) break;
  await page.waitForTimeout(1000);
}

if (!session?.accessToken) {
  log("Fant ingen sesjon innen tidsfristen. Ingenting er skrevet.");
  await browser.close();
  process.exit(1);
}

// Sanity: verifiser at tokenet faktisk slipper inn, før vi sier at det virker. Et token som ser
// riktig ut men har feil audience er verre enn ingen — det gir en suite som feiler uten grunn.
const probe = await context.request.get(`${BASE}/api/me`, {
  headers: { Authorization: `Bearer ${session.accessToken}` },
});

if (!probe.ok()) {
  log(`Tokenet ble avvist av /api/me (${probe.status()}). Ingenting er skrevet.`);
  await browser.close();
  process.exit(1);
}

const me = await probe.json();
const roles = me?.roles ?? me?.user?.roles ?? [];

fs.writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      baseUrl: BASE,
      accessToken: session.accessToken,
      expiresOn: session.expiresOn,
      username: session.username,
      roles,
      capturedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

const minutes = Math.max(0, Math.round((session.expiresOn - Date.now()) / 60000));
log(`Innlogget som ${session.username ?? "(ukjent)"} · roller: ${roles.join(", ") || "(ingen)"}`);
log(`Skrevet til .stage-auth.json — gyldig ca. ${minutes} minutter.`);
log("Kjør nå:  npm run test:stage");

await browser.close();
