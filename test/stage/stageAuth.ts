import fs from "node:fs";
import path from "node:path";

// Delt sesjonslesing for stage-suitene. Lå opprinnelig inne i `real-data.spec.ts`; flyttet hit da
// `participant-contract.spec.ts` trengte den samme. To kopier av «er vi innlogget» ville vært
// nøyaktig den drifta resten av repoet jobber med å fjerne.

export type StageAuth = {
  baseUrl: string;
  accessToken: string;
  expiresOn: number;
  username: string | null;
  roles: string[];
};

function readAuthFile(name: string, renew: string): { auth: StageAuth | null; reason: string } {
  const file = path.resolve(process.cwd(), name);
  if (!fs.existsSync(file)) {
    return { auth: null, reason: `ingen ${name} — kjør \`${renew}\` først` };
  }
  let parsed: StageAuth;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StageAuth;
  } catch {
    return { auth: null, reason: `${name} kunne ikke leses` };
  }
  if (!parsed.accessToken) return { auth: null, reason: `${name} mangler token` };
  if (parsed.expiresOn && parsed.expiresOn < Date.now()) {
    return { auth: null, reason: `${name} er utløpt — kjør \`${renew}\` på nytt` };
  }
  return { auth: parsed, reason: "" };
}

/**
 * Den personlige sesjonen (`npm run stage:auth`, med brukerens roller) når den er gyldig; ellers
 * stage-testkontoen (2.105.0, `npm run stage:auth:service` — fagansvarlig, henter seg selv uten
 * innlogging). En test som trenger administrator, bruker `readServiceAuth()` med hodet `x-stage-test-role: ADMINISTRATOR`
 * (2.181.1).
 */
export function readAuth(): { auth: StageAuth | null; reason: string } {
  const personal = readAuthFile(".stage-auth.json", "npm run stage:auth");
  if (personal.auth) return personal;
  const service = readAuthFile(".stage-service-auth.json", "npm run stage:auth:service");
  if (service.auth) return service;
  return { auth: null, reason: `${personal.reason}; ${service.reason}` };
}

/**
 * Bare stage-testkontoen, også når en personlig sesjon finnes. 2.154.1: en test som skal opptre som DELTAKER (hodet
 * `x-stage-test-role: PARTICIPANT`, src/auth/stageTestService.ts) trenger kontoens token — hodet virker ikke på et
 * brukertoken. 2.181.1: det samme for ADMINISTRATOR.
 */
export function readServiceAuth(): { auth: StageAuth | null; reason: string } {
  return readAuthFile(".stage-service-auth.json", "npm run stage:auth:service");
}

/**
 * Adressen påloggingen ble hentet mot, ellers STAGE_BASE_URL, ellers `baseUrl` i den gitignorerte `.stage-service.json`.
 * Stage i Azure er passiv fra 2026-11-22, og adressen til stage står ikke i dette offentlige repoet (doc/ENVIRONMENTS.local.md).
 * Samme regel som scripts/test/stage-base-url.mjs. Mangler alt, gir den en `.invalid`-adresse som feiler med et navn som sier
 * hva som er galt, i stedet for å treffe et miljø som ikke finnes lenger.
 */
export function stageBaseUrl(auth: StageAuth | null): string {
  // Påloggingsfila vinner: testene skal treffe det miljøet tokenet ble hentet mot. Tokenet varer en time, så en gammel fil
  // fra stage i Azure kan ikke bli liggende lenge.
  const fromEnv = process.env.STAGE_BASE_URL?.trim().replace(/\/+$/, "") || null;
  return auth?.baseUrl ?? fromEnv ?? localStageBaseUrl() ?? "https://stage-adresse-mangler.invalid";
}

function localStageBaseUrl(): string | null {
  try {
    const config = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), ".stage-service.json"), "utf8")) as { baseUrl?: unknown };
    return typeof config.baseUrl === "string" && config.baseUrl.trim() ? config.baseUrl.trim().replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}
