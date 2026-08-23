// #937: én felles oversetter fra importfeil til noe et menneske kan handle på.
//
// ⚠️ Grunnen til at dette er en DELT fil og ikke tre kopier: første QA-runde fant at fiksen lå på
// seksjonsflaten alene, mens modul- og kursimport ga samme rå Zod-dump én side unna. Andre runde
// fant at serverfiksen var på plass alle tre stedene, men at klientfiksen igjen bare var på én.
// Samme feil, to ganger, fordi «husk å gjøre det tre steder» er en dårlig mekanisme.
//
// Kontrakten er FEILKODEN, aldri serverens tekst. Konsollene er trespråklige og defaulter til
// en-GB, så en setning fra serveren ville blitt vist ordrett på feil språk. Serverens `message` er
// kun en reserve for API-konsumenter uten en egen tabell.

// #985: «alt annet»-grenen returnerte `body.message` som overskrift — fila skrev ned regelen på
// linje 8-10 og brøt den fire linjer senere. Den grenen går nå gjennom den delte kodetabellen i
// api-error.js, som er den eneste som kjenner `content_ownership`, `item_archived` og resten.
// Importfeilene beholder sin egen ordlyd her, fordi de skal snakke om FILA («dette ser ikke ut som
// en seksjonspakke»), ikke om et API-kall.
import { describeApiError } from "/static/api-error.js";

/**
 * @param {unknown} error   feilen fra apiFetch — bærer `.body` (parset) og `.message` ("<status>: <json>")
 * @param {{ notAnEnvelope: string }} labels  tekster på brukerens språk
 * @param {(key: string) => string} [t]  konsollets i18n-oppslag, for kodene importen ikke eier selv
 * @returns {{ headline: string, detail: string | undefined }}
 */
export function describeImportError(error, labels, t) {
  const body = error?.body;
  const code = body?.error;

  if (code === "not_an_export_envelope") {
    return { headline: labels.notAnEnvelope, detail: undefined };
  }

  if (code === "validation_error") {
    // Zod-utdata hører hjemme i detaljfeltet (`.toast__detail`, som har `white-space: pre-wrap`) —
    // ikke i overskriften, som klippes ved høyre kant i en 360px-bred toast.
    return {
      headline: labels.notAnEnvelope,
      detail: JSON.stringify(body?.issues ?? [], null, 2),
    };
  }

  // Alt annet — typisk `content_ownership` eller `import_target_not_found` — er ikke en
  // fil-feil, men et vanlig API-avslag. Den delte tabellen eier de kodene.
  const described = describeApiError(error, t);
  return { headline: described.headline, detail: described.detail };
}
