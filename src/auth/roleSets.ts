import { AppRole } from "../db/prismaRuntime.js";
import type { AppRole as AppRoleType } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// #962: ETT hjem for «hvilke roller får gjøre dette».
//
// ⚠️ Hvorfor denne fila finnes.
//
// Spørsmålet ble besvart tjue steder. Tre av dem hadde et navngitt sett — men hvert sitt, i hver
// sin modul (`ADMIN_READ_ROLES`, `ADMIN_AUDIT_ROLES`, `MODERATOR_ROLES`). De sytten andre var
// `roles.includes("ADMINISTRATOR")` skrevet på stedet.
//
// Konsekvensen er ikke bare gjentakelse. Den er at INGEN KAN LESE POLICYEN. For å svare på «hvem
// ser en deltakers revisjonsspor» måtte man finne `auditService.ts:216` — og for å oppdage at
// svaret er videre enn `/api/reports`, måtte man tilfeldigvis lese begge.
//
// ⚠️ Denne fila ENDRER INGEN TILGANG. Hvert sett er nøyaktig det kallstedet hadde fra før,
// inkludert der settene er uenige. Å samle dem er første steg; å avgjøre om de BØR være uenige er
// en produktbeslutning, og den står i #962.
//
// `test/role-set-guard.test.js` nekter nye innebygde rollesjekker utenfor denne fila.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Har brukeren minst én av rollene? Den ene formuleringen, så `some/includes` ikke skrives på nytt.
 *
 * ⚠️ `roles` er `readonly string[]`, ikke `AppRoleType[]`, med vilje. Tre kallsteder
 * (`contentOwnershipService`, `agentAuthoringTokenService`) bærer rollene som rene strenger — de
 * kommer fra en request-kontekst eller et token, altså utenfra. Å tvinge dem til enum-typen her
 * ville bare flyttet en cast til kallstedet og latt som om input var validert.
 *
 * Det som ER typet, er `allowed`: settet må bestå av ekte roller. En skrivefeil i en av
 * konstantene under kompilerer ikke — og det er den siden som avgjør policyen.
 */
export function hasAnyRole(roles: readonly string[] | undefined, allowed: readonly AppRoleType[]): boolean {
  if (!roles || roles.length === 0) return false;
  return roles.some((role) => (allowed as readonly string[]).includes(role));
}

/**
 * Administrator alene. Brukt der handlingen er ren drift eller overstyring — sletting av eierskap,
 * plattformkonfigurasjon, tvungen tilgang til andres innhold.
 */
export const ADMIN_ONLY: readonly AppRoleType[] = [AppRole.ADMINISTRATOR];

/**
 * Deltakerrollen alene.
 *
 * ⚠️ Brukt til MEDLEMSKAPSUTLEDNING, ikke til å nekte noe: `getUserClassIds` legger til
 * systemklassen «Alle deltakere» for den som har rollen. Skillet er verdt å holde i hodet — en
 * vakt nekter, dette utvider. En feil her gir for mange klasser, ikke for mye tilgang.
 */
export const PARTICIPANTS: readonly AppRoleType[] = [AppRole.PARTICIPANT];

/**
 * De som forfatter innhold. Merk at ADMINISTRATOR er med overalt hvor SMO er — administrator er
 * aldri MINDRE privilegert enn en forfatter, og et sett der den mangler ville vært en feil.
 */
export const CONTENT_AUTHORS: readonly AppRoleType[] = [
  AppRole.ADMINISTRATOR,
  AppRole.SUBJECT_MATTER_OWNER,
];

/** Vurderingskøen. */
export const REVIEW_HANDLERS: readonly AppRoleType[] = [AppRole.ADMINISTRATOR, AppRole.REVIEWER];

/** Ankekøen. */
export const APPEAL_HANDLERS: readonly AppRoleType[] = [AppRole.ADMINISTRATOR, AppRole.APPEAL_HANDLER];

/**
 * Diskusjonsmoderering — kan slette andres innlegg og lukke tråder.
 */
export const DISCUSSION_MODERATORS: readonly AppRoleType[] = [
  AppRole.ADMINISTRATOR,
  AppRole.SUBJECT_MATTER_OWNER,
];

/**
 * Rapportlesing. `/api/reports` monteres med nøyaktig dette settet.
 */
export const REPORT_READERS: readonly AppRoleType[] = [AppRole.ADMINISTRATOR, AppRole.REPORT_READER];

/**
 * Den som leser en innleverings fulle revisjonsspor, inkludert aktørens e-post.
 *
 * ⚠️ AVKLART 2026-08-23, hele settet. Produkteier begrunnet to av rollene eksplisitt:
 *
 *   SUBJECT_MATTER_OWNER  «å regne som en lærer som har det praktiske pedagogiske ansvaret for
 *                          oppfølging av kandidater»
 *   REPORT_READER         «potensielt kandidaters mentorer som skal kunne følge opp kompetansemål
 *                          avtalt i eksempelvis medarbeidersamtaler»
 *
 * Settet er altså ikke «alle som er litt privilegerte». Det er alle med et OPPFØLGINGSFORHOLD til
 * en kandidat: administrator, lærer, vurderer, ankebehandler, mentor. Revisjonssporet viser hva som
 * faktisk skjedde med en innlevering, og det er nettopp det de fem trenger.
 *
 * QA-porten meldte fem roller her mot to i `REPORT_READERS` som en divergens. Den er tilsynelatende:
 * de to svarer på ULIKE spørsmål. `/api/reports` er analyse på tvers av organisasjonen;
 * revisjonssporet er oppfølging av ett menneske.
 *
 * ⚠️ DET SOM IKKE ER LØST, og som produkteiers begrunnelse gjør SKARPERE: begge rollene ble
 * begrunnet med et FORHOLD — «mine kandidater», «mine mentees» — og det forholdet finnes ikke i
 * datamodellen. Derfor ser hver av de fem ALLE kandidater i ALLE kurs. Rollene er riktige; det er
 * avgrensningen som mangler. Se #1000.
 *
 * Se `doc/DECISIONS.md` → «SMO leser revisjonsspor fordi SMO er lærer».
 */
export const SUBMISSION_AUDIT_READERS: readonly AppRoleType[] = [
  AppRole.ADMINISTRATOR,
  AppRole.SUBJECT_MATTER_OWNER,
  AppRole.REVIEWER,
  AppRole.APPEAL_HANDLER,
  AppRole.REPORT_READER,
];

/**
 * ⚠️ Modul-lesing for admin-flatene — også fem roller, og heller ikke det samme som
 * `SUBMISSION_AUDIT_READERS` selv om de ser like ut ved første øyekast.
 *
 * Gjengitt uendret fra `moduleService.ts`. Om de to burde vært ett sett er også et #962-spørsmål.
 */
export const MODULE_ADMIN_READERS: readonly AppRoleType[] = [
  AppRole.ADMINISTRATOR,
  AppRole.SUBJECT_MATTER_OWNER,
  AppRole.REVIEWER,
  AppRole.APPEAL_HANDLER,
  AppRole.REPORT_READER,
];
