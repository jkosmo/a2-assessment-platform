import { SubmissionStatus } from "../../db/prismaRuntime.js";

type SubmissionStatusType = (typeof SubmissionStatus)[keyof typeof SubmissionStatus];

/**
 * Statusene der innleveringen HAR et endelig utfall.
 *
 * ⚠️ DETTE ER EN HVITELISTE, OG DET ER HELE POENGET. Klienten lærte dette først: `outcome.js`
 * hadde en svarteliste som listet `UNDER_REVIEW` og `SCORED` som ikke-avgjort, og QA-porten fant
 * at den var feil — enhver ny status ble avgjort som standard, uten at noen tok stilling til det.
 * Den ble snudd til en hviteliste.
 *
 * Serveren hadde fortsatt svartelista. `mcqSemanticReport` filtrerte på `status !== UNDER_REVIEW`
 * tre steder, og `completionReport` gjorde det samme to steder. Da #951 la til `SUPERSEDED`, ville
 * alle fem talt et forlatt forsøk som et endelig resultat.
 *
 * Med en hviteliste er en ny status IKKE avgjort før noen skriver den inn her. Det er riktig vei
 * å feile: en status vi ikke har tenkt på skal ikke stille tause krav på å bli talt.
 *
 * ⚠️ `REJECTED` er med fordi den ER et endelig utfall, selv om ingen kodesti skriver den i dag
 * (#953). Samme begrunnelse som i `outcome.js`, og listene skal si det samme.
 *
 * ⚠️ `SUPERSEDED` er IKKE med (#951). Forsøket ble forlatt da deltakeren leverte på nytt, og et
 * menneske rakk aldri å avgjøre det. Innleveringen bærer fortsatt et gammelt AUTOMATISK vedtak, så
 * den som spør «finnes det et vedtak?» får ja — derfor må statusen spørres om, ikke vedtaket.
 */
export const SETTLED_SUBMISSION_STATUSES: ReadonlySet<SubmissionStatusType> = new Set([
  SubmissionStatus.COMPLETED,
  SubmissionStatus.REJECTED,
]);

/**
 * Er innleveringen avgjort, altså et datapunkt som kan telles som bestått eller strøket?
 *
 * Prinsippet er #948 sitt: en sak som ikke er avgjort skal ikke telle i en bestått-rate i det hele
 * tatt — verken som bestått (smigrende) eller strøket (alarmerende). Begge gjør en ikke-avgjort sak
 * om til et datapunkt.
 */
export function isSettledSubmission(status: SubmissionStatusType | null | undefined): boolean {
  return status != null && SETTLED_SUBMISSION_STATUSES.has(status);
}
