// 2.105.0: en egen tjenestekonto for testene mot stage (produkteier 2026-10-25: «en egen bruker for
// deg på stage, slik at du kan teste uten tillatelse. Bruker vil da ha begrenset tilgang til det som
// trengs for å teste»).
//
// Stage krever Entra-innlogging, og et brukertoken lever en time; hver testkjøring ventet på at
// produkteier logget inn. En tjenestekonto (app-registrering med klienthemmelighet) henter sitt eget
// token. Et slikt token er «app-only»: det har ingen bruker, e-post eller `scp`, og ble før avvist som
// «missing required user claims».
//
// Reglene, alle tre må holde:
//   1. bare på stage: `DEPLOY_ENVIRONMENT` er nøyaktig "staging". I prod er innstillingen ikke satt;
//      det som ikke er satt, er avslag;
//   2. bare fra den ene appen: `azp`/`appid` er nøyaktig `STAGE_TEST_SERVICE_APP_ID`;
//   3. rollen er fast fagansvarlig, bestemt her. Det tokenet selv sier om roller, leses ikke.
// Ethvert annet app-only token avvises, som før.
import type { JWTPayload } from "jose";
import type { AuthPrincipal } from "./principal.js";

export const STAGE_TEST_SERVICE_ROLE = "SUBJECT_MATTER_OWNER";

export interface StageTestServiceSettings {
  deployEnvironment: string | undefined;
  appId: string | undefined;
}

/** Et token uten bruker: ingen `scp`, ingen e-post. */
export function isAppOnlyToken(payload: JWTPayload): boolean {
  return payload.scp === undefined && !payload.preferred_username && !payload.upn && !payload.email;
}

/**
 * Prinsipalen for stage-testkontoen, eller en feil. Kalles bare for app-only tokens.
 * @throws når et av vilkårene over ikke holder
 */
export function stageTestServicePrincipal(payload: JWTPayload, settings: StageTestServiceSettings): AuthPrincipal {
  const appId = String(payload.azp ?? payload.appid ?? "");
  const allowed = settings.deployEnvironment === "staging"
    && typeof settings.appId === "string"
    && settings.appId.trim() !== ""
    && appId === settings.appId.trim();
  if (!allowed) throw new Error("JWT token is missing required user claims.");
  return {
    externalId: `stage-test-service:${appId}`,
    email: "stage-testkonto@stage.invalid",
    name: "Stage-testkonto",
    tokenRoles: [STAGE_TEST_SERVICE_ROLE],
    groupIds: [],
  };
}
