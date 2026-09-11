import { platformConfigRepository } from "../platformConfig/platformConfigRepository.js";

// #645/CL-1: Administrator-controlled toggle for Entra-linked classes (kind=ENTRA). Default OFF —
// only manual classes exist until an Administrator enables this (after Graph permissions are in
// place, CL-5). Stored as a PlatformConfig key so it can be flipped without a deploy.
//
// ⚠️ #1017 (2026-09-11): ENTRA-KLASSER ER HALVBYGDE OG HAR INGEN MOTTAKER. Ingenting kan opprette en
// klasse med kind=ENTRA — `createClass` hardkoder MANUAL, og skjemaet tar bare navn og beskrivelse.
// Denne bryteren kan heller ikke settes fra administrasjonssidene (`PUT /api/admin/platform` har en
// fast nøkkelliste den ikke står i). Målt 2026-08-27: 0 slike klasser på stage; eieren bekrefter at
// tilgangsgrupper ikke styrer hvem som tar hvilke kurs. Grenene som leser `kind === "ENTRA"` (her,
// getUserClassIds, cohortStatusService, courseReminderService) er derfor VAKTER MOT DATA SOM IKKE
// FINNES, ikke en funksjon. Skal funksjonen bygges, er det #678 (CL-5); skal den fjernes, er det en
// contract-migrasjon (enum-verdi + kolonne). Valgt: la stå, merket (#1017 valg A).
export const CLASS_ENTRA_LINKING_KEY = "classEntraLinkingEnabled";

export async function isClassEntraLinkingEnabled(): Promise<boolean> {
  return (await platformConfigRepository.get(CLASS_ENTRA_LINKING_KEY)) === "true";
}
