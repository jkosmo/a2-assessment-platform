import { SubmissionStatus } from "../../db/prismaRuntime.js";
import type { SubmissionStatus as SubmissionStatusType } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// #952/#948: serverens svar på «bestod dette forsøket» — samme regel som klientens
// `public/static/outcome.js`, på serversiden.
//
// ⚠️ Hvorfor den trengs. `decisionService` kan sette `needsManualReview = true` SAMTIDIG som
// `passFailTotal = true` — via `totalsInconsistent` og `llmRecommendsManualReview`, som ingen av
// dem rører terskelsjekken. Vedtaket sier «bestått», innleveringen settes `UNDER_REVIEW`, og
// sertifiseringen hoppes korrekt over.
//
// Tilstanden er ikke gal i seg selv: maskinen mener bestått, et menneske må bekrefte. Feilen er at
// LESERNE tolket paret ulikt — noen krevde statussjekk, andre ikke — så samme forsøk kunne telles
// som PASS i kalibreringsrapporten mens kursvisningen sa IN_PROGRESS.
//
// ⚠️ `SCORED` er uavklart av samme grunn som i klienten: poengene er satt, men rutingsbeslutningen
// er ikke anvendt. Bare `COMPLETED` bærer et autoritativt utfall.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const UNSETTLED: ReadonlySet<string> = new Set([SubmissionStatus.UNDER_REVIEW, SubmissionStatus.SCORED]);

/**
 * Er utfallet avgjort? Et forsøk under vurdering har ikke et endelig svar, uansett hva
 * `passFailTotal` sier.
 */
export function isOutcomeSettled(submissionStatus: SubmissionStatusType | string | null | undefined): boolean {
  if (typeof submissionStatus !== "string" || submissionStatus.length === 0) return false;
  return !UNSETTLED.has(submissionStatus.toUpperCase());
}

/**
 * «Har deltakeren bestått dette forsøket, endelig?»
 *
 * ⚠️ Krever BEGGE ledd. `passFailTotal: true` alene er ikke nok — se filkommentaren over for
 * hvordan et vedtak kan bære det mens innleveringen fortsatt vurderes.
 */
export function isSettledPass(input: {
  passFailTotal?: boolean | null;
  submissionStatus?: SubmissionStatusType | string | null;
}): boolean {
  return input.passFailTotal === true && isOutcomeSettled(input.submissionStatus);
}
