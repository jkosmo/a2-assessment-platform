// Adressen til stage for skriptene som henter innlogging og for stage-testene.
//
// Stage i Azure ble satt passiv 2026-11-22. Stage kjører nå på en egen server, og adressen dens skal ikke stå i dette
// offentlige repoet. Den leses derfor fra STAGE_BASE_URL, eller fra feltet `baseUrl` i den gitignorerte
// `.stage-service.json` (samme fil som stage-testkontoen). Vedlikeholdere finner verdien i doc/ENVIRONMENTS.local.md.
//
// Samme regel står i test/stage/stageAuth.ts (`stageBaseUrl`), som i tillegg foretrekker adressen i påloggingsfila.

import fs from "node:fs";
import path from "node:path";

/** STAGE_BASE_URL, ellers `baseUrl` i `.stage-service.json`, ellers null. Uten / til slutt. */
export function stageBaseUrl() {
  const fromEnv = process.env.STAGE_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  try {
    const config = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), ".stage-service.json"), "utf8"));
    if (typeof config.baseUrl === "string" && config.baseUrl.trim()) return config.baseUrl.trim().replace(/\/+$/, "");
  } catch {
    // Ingen fil eller ugyldig JSON: da finnes ingen lokal adresse.
  }
  return null;
}

/** Som `stageBaseUrl`, men avslutter skriptet med en forklaring når adressen mangler. */
export function requireStageBaseUrl(log = console.error) {
  const base = stageBaseUrl();
  if (!base) {
    log("Fant ingen adresse til stage. Sett STAGE_BASE_URL, eller «baseUrl» i .stage-service.json (se doc/ENVIRONMENTS.local.md).");
    process.exit(1);
  }
  return base;
}
