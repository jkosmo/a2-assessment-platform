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

export function readAuth(): { auth: StageAuth | null; reason: string } {
  const file = path.resolve(process.cwd(), ".stage-auth.json");
  if (!fs.existsSync(file)) {
    return { auth: null, reason: "ingen .stage-auth.json — kjør `npm run stage:auth` først" };
  }
  let parsed: StageAuth;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StageAuth;
  } catch {
    return { auth: null, reason: ".stage-auth.json kunne ikke leses" };
  }
  if (!parsed.accessToken) return { auth: null, reason: ".stage-auth.json mangler token" };
  if (parsed.expiresOn && parsed.expiresOn < Date.now()) {
    return { auth: null, reason: "sesjonen er utløpt — kjør `npm run stage:auth` på nytt" };
  }
  return { auth: parsed, reason: "" };
}

export function stageBaseUrl(auth: StageAuth | null): string {
  return (
    auth?.baseUrl
    ?? process.env.STAGE_BASE_URL
    ?? "https://a2-assessment-platform-stg-app-x6eyx4.azurewebsites.net"
  );
}
