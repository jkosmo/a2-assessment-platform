// #1033: hva skillet skriver i `envelope.provenance` på alt det leverer gjennom filveien.
//
// Bakgrunn: filveien (eksport → forfatteren importerer) er skillets hovedvei, og den ga aldri noe
// spor i plattformens revisjonslogg om at innholdet var agent-produsert — importen skjer lokalt,
// uten agent. Av 348 flervalgsspørsmål på stage bar 6 stempelet. Dermed kunne ingen måle om en
// strammere instruks (#1032) faktisk ga bedre spørsmål: ny og gammel produksjon var umulige å
// skille.
//
// ⚠️ Dette er en PÅSTAND fila kommer med, ikke et bevis — hvem som helst kan skrive feltet. Til
// måling er det godt nok. Til noe som skal ha rettsvirkning er det ikke det; da må API-veien med
// agent-token brukes, der plattformen selv ser hvem som skrev.
//
// SKILL_VERSION følger plattformens package.json (testen `skill-provenance-1033` håndhever det), så
// «hvilken versjon av skillet laget dette?» kan besvares fra revisjonsraden.

export const SKILL_NAME = "a2-authoring-api";
export const SKILL_VERSION = "2.72.0";

/**
 * @param {{ agentRunId?: string }} [options]  agentRunId når kjøringen har en (samme id som API-veien bruker)
 * @returns {{ producer: "agent_authoring", tool: string, toolVersion: string, agentRunId?: string }}
 */
export function skillProvenance(options = {}) {
  return {
    producer: "agent_authoring",
    tool: SKILL_NAME,
    toolVersion: SKILL_VERSION,
    ...(options.agentRunId ? { agentRunId: options.agentRunId } : {}),
  };
}
