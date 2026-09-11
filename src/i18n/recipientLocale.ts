import { env } from "../config/env.js";
import { normalizeLocale, type SupportedLocale } from "./locale.js";

/**
 * #970: språket en e-post til en BRUKER skal skrives på, når det ikke finnes en besvarelse å lese
 * språket fra (påminnelser, tildelinger, diskusjonsvarsler).
 *
 * `preferredLocale` er «sist sett» — skrevet av `upsertUserFromPrincipal` ved hver forespørsel.
 * Null betyr at brukeren ikke har logget inn siden kolonnen kom; da gjelder den konfigurerte
 * standarden, samme som en forespørsel uten språkmerke ville fått.
 *
 * ⚠️ Resultat- og ankevarsler bruker fortsatt språket på BESVARELSEN (`input.locale`). Det er
 * riktig: de handler om noe brukeren skrev på et bestemt språk. Denne hjelperen er for varsler om
 * ting brukeren ikke har skrevet ennå.
 */
export function recipientLocale(user: { preferredLocale?: string | null } | null | undefined): SupportedLocale {
  return normalizeLocale(user?.preferredLocale) ?? env.DEFAULT_LOCALE;
}
