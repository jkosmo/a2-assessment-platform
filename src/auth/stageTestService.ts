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
//   3. rollen bestemmes her. Det tokenet selv sier om roller, leses ikke.
// Ethvert annet app-only token avvises, som før.
//
// 2.154.1: kontoen kan også opptre som DELTAKER, slik at deltakerflyten (kursporten i
// `routes/submissions.ts`, som forfattere går forbi) kan prøves på stage uten at et menneske logger
// inn. Testen ber om det med hodet `x-stage-test-role`, og hodet leses først når vilkår 1 og 2 over
// alt holder. Hvitelisten:
//   - hodet utelatt          → fagansvarlig, som før (`stage-test-service:<appId>`);
//   - nøyaktig `PARTICIPANT` → en EGEN bruker (`stage-test-service-participant:<appId>`) med bare
//                              rollen deltaker. Egen bruker, så fagansvarliges roller, innleveringer
//                              og klasser aldri blandes inn;
//   - alt annet              → avslag (401). Ingen stille tilbakefall til fagansvarlig: en skrivefeil
//                              i testen skal gi en feil, ikke en test som prøver feil rolle.
// Hodet har ingen virkning for brukertokens eller agent-tokens: det leses bare her, og hit kommer
// bare app-only tokens (`authenticate.ts`).
import type { JWTPayload } from "jose";
import type { AuthPrincipal } from "./principal.js";

export const STAGE_TEST_SERVICE_ROLE = "SUBJECT_MATTER_OWNER";

/** Hodet testen setter for å opptre som deltaker. Leses bare for stage-testkontoen. */
export const STAGE_TEST_ROLE_HEADER = "x-stage-test-role";

/** Den ene verdien hodet kan ha. */
export const STAGE_TEST_PARTICIPANT_ROLE = "PARTICIPANT";

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
 *
 * `requestedRole` er verdien av `x-stage-test-role` slik den kom (`undefined` når hodet mangler). Den
 * er et påkrevd argument med vilje: kalleren skal ta stilling til hodet, ikke glemme det.
 * @throws når et av vilkårene over ikke holder, eller hodet har en annen verdi enn hvitelisten
 */
export function stageTestServicePrincipal(
  payload: JWTPayload,
  settings: StageTestServiceSettings,
  requestedRole: string | undefined,
): AuthPrincipal {
  const appId = String(payload.azp ?? payload.appid ?? "");
  const allowed = settings.deployEnvironment === "staging"
    && typeof settings.appId === "string"
    && settings.appId.trim() !== ""
    && appId === settings.appId.trim();
  if (!allowed) throw new Error("JWT token is missing required user claims.");

  if (requestedRole === undefined) {
    return {
      externalId: `stage-test-service:${appId}`,
      email: "stage-testkonto@stage.invalid",
      name: "Stage-testkonto",
      tokenRoles: [STAGE_TEST_SERVICE_ROLE],
      groupIds: [],
    };
  }
  if (requestedRole === STAGE_TEST_PARTICIPANT_ROLE) {
    return {
      externalId: `stage-test-service-participant:${appId}`,
      email: "stage-testkonto-deltaker@stage.invalid",
      name: "Stage-testkonto (deltaker)",
      tokenRoles: [STAGE_TEST_PARTICIPANT_ROLE],
      groupIds: [],
    };
  }
  throw new Error("Unknown stage test role.");
}
