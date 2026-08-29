// #972: ÉN felles oversetter fra en `apiFetch`-feil til noe et menneske kan lese.
//
// ⚠️ Hvorfor denne fila finnes i stedet for en fjerde variant: vi hadde tre halve oversettere som
// ikke visste om hverandre — `describeImportError` (#937, to feilkoder), `humanizeApiError` i
// participant.js (#988, ingen kodetabell) og `toActionableErrorMessage` i review.js (aldri
// eksportert). Ingen av dem dekket kodene forfatterkonsollet faktisk møter, så 33 kallsteder
// dumpet i stedet `err.message` — som `apiFetch` bygger som `"<status>: <hele JSON-kroppen>"`
// (api-client.js:167). Resultatet i en toast:
//
//     403: {"error":"content_ownership","message":"You can only modify content you own."}
//
// To feil i én: JSON i grensesnittet, OG serverens språk i et konsoll som defaulter til `en-GB`.
// Begge retninger er brudd — serverens hardkodede bokmål vist til en engelsk forfatter er like
// galt som engelsk vist til en norsk (#980 mot #965).
//
// Kontrakten er FEILKODEN, aldri serverens tekst (doc/DECISIONS.md → «Feilkoden er kontrakten,
// ikke teksten», FEATURE_SURFACE_MAP §24). Serverens `message` er en engelsk reserve for
// API-konsumenter uten oversettelsestabell.
//
// ⚠️ Serverens tekst kastes likevel ikke: den blir DIAGNOSTIKK i detaljfeltet når koden er ukjent.
// Det er en bevisst forskjell mellom forfatter- og deltakerflate — en forfatter kan bruke
// `path: ["bodyMarkdown"]` til å finne feilen i fila si, en kandidat midt i en test kan ikke.
// Derfor returnerer denne fila `detail` som et EGET felt, og lar kallstedet bestemme om det skal
// vises. Deltakerflaten (participant.js) sender sitt kall videre uten `detail`.

/** Generisk nøkkel når koden er ukjent. Bærer `{status}`. */
export const API_ERROR_GENERIC_KEY = "errors.apiGeneric";
/** Generisk nøkkel for `validation_error` — «noe i skjemaet er feil utfylt». */
export const API_ERROR_VALIDATION_KEY = "errors.apiValidation";
/** Prefiks for de kodespesifikke nøklene: `errors.api.content_ownership` osv. */
export const API_ERROR_KEY_PREFIX = "errors.api.";

/**
 * Den parsede feilkroppen. `apiFetch` henger den på som `.body`; faller tilbake til å parse
 * `"<status>: <json>"`-strengen for de kallstedene som bare har en `Error` (f.eks. en feil som
 * har passert `new Error(String(err))`).
 * @param {unknown} error
 * @returns {Record<string, unknown> | null}
 */
export function apiErrorBody(error) {
  const attached = error?.body;
  if (attached && typeof attached === "object") return attached;

  const text = typeof error?.message === "string" ? error.message : "";
  const match = /^(\d{3}):\s*([\s\S]*)$/.exec(text);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[2]);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * HTTP-statusen, fra `.status` hvis den er der, ellers fra prefikset i meldingen.
 * @returns {number | null}
 */
export function apiErrorStatus(error) {
  if (typeof error?.status === "number") return error.status;
  const match = /^(\d{3}):/.exec(typeof error?.message === "string" ? error.message : "");
  return match ? Number(match[1]) : null;
}

/**
 * Feilkoden — det eneste feltet klienten skal ta en beslutning på.
 * @returns {string | null}
 */
export function apiErrorCode(error) {
  const body = apiErrorBody(error);
  const code = body?.error;
  return typeof code === "string" && code.length > 0 ? code : null;
}

// Kallernes `t()` returnerer nøkkelen uendret når den mangler (samme kontrakt i alle konsollene).
// Vi må kunne skille «oversatt» fra «ingen oversettelse», ellers ville en ukjent kode gitt
// `errors.api.thread_locked` som overskrift — verre enn den rå JSON-en vi prøver å bli kvitt.
function translated(t, key) {
  if (typeof t !== "function") return null;
  const value = t(key);
  return typeof value === "string" && value.length > 0 && value !== key ? value : null;
}

/**
 * Slår opp den lokaliserte teksten for én feilkode. Returnerer `null` når klienten ikke kjenner
 * koden — kallstedet må da falle tilbake på den generiske teksten, ALDRI på serverens `message`.
 *
 * @param {string | null} code
 * @param {(key: string) => string} t
 * @param {string[]} [variants]  ekstra, mer spesifikke nøkkelledd som prøves først, i rekkefølge.
 *   Brukes av publiseringsdialogen: `item_archived` gjelder både moduler og seksjoner, og bare
 *   klienten vet hvilken av dem raden er (#980).
 * @returns {string | null}
 */
export function apiErrorCodeText(code, t, variants = [], details = null) {
  if (!code) return null;
  let template = null;
  for (const variant of variants) {
    if (!variant) continue;
    const hit = translated(t, `${API_ERROR_KEY_PREFIX}${code}.${variant}`);
    if (hit) { template = hit; break; }
  }
  if (template === null) template = translated(t, `${API_ERROR_KEY_PREFIX}${code}`);
  return template === null ? null : fillErrorPlaceholders(template, details);
  // (null herfra betyr «vi har en setning, men ikke dataene den krever» — kalleren faller da
  // tilbake paa den generiske, lokaliserte setningen i stedet for aa vise en oedelagt.)
}

/**
 * #999: setter tallene fra `details` inn i den oversatte setningen.
 *
 * ⚠️ Serveren sender TALL, ikke ferdig prosa. Sendte den setningen, ville klienten måttet lese
 * tallet ut av en tekst på et språk den ikke valgte — som er nøyaktig problemet #999 retter.
 *
 * Samme mønster som `fillReasonPlaceholders` i decision-reason.js (#950). Lister blir kommaseparert
 * her; skal de skilles annerledes på et språk, hører det i oversettelsen, ikke her.
 *
 * @param {string} template
 * @param {Record<string, unknown> | null} details
 * @returns {string}
 */
export function fillErrorPlaceholders(template, details) {
  if (typeof template !== "string") return "";
  let out = template;
  for (const [key, value] of Object.entries(details ?? {})) {
    const shown = Array.isArray(value) ? value.join(", ") : String(value);
    out = out.split(`{${key}}`).join(shown);
  }
  // ⚠️ Overlever en plassholder, mangler avsenderen dataene setningen krever. Da er den oversatte
  // teksten OEDELAGT, og «Prøv igjen om {retryAfterSeconds} sekunder» er verre enn ingen
  // oversettelse i det hele tatt.
  //
  // Dette skjedde: nøkkelen ble endret til å navngi sekundene, men to håndrullede 429-svar sendte
  // dem ikke. Samme mønster som `localizeDecisionReason` (#950), og av samme grunn — en delt nøkkel
  // har alltid flere avsendere enn den som endret den.
  return /\{\w+\}/.test(out) ? null : out;
}

/**
 * Oversetter en `apiFetch`-feil til `{ headline, detail }` på brukerens språk.
 *
 * `headline` er ALLTID lokalisert: kjent kode → kodens egen setning, ukjent kode → den generiske
 * med statuskoden i. `detail` er diagnostikk for forfatterflater, og er `undefined` når det ikke
 * finnes noe å legge til.
 *
 * @param {unknown} error
 * @param {(key: string) => string} t
 * @param {{ variants?: string[] }} [options]
 * @returns {{ headline: string, detail: string | undefined, code: string | null }}
 */
export function describeApiError(error, t, options = {}) {
  const body = apiErrorBody(error);
  const code = apiErrorCode(error);
  const status = apiErrorStatus(error);

  // ⚠️ Ikke en server-konvolutt i det hele tatt: verken status eller kropp. Da er dette en feil
  // klienten selv kastet («Eksport returnerte tom envelope.», en AbortError, en parse-feil), og
  // teksten er skrevet av OSS på brukerens språk — ikke serverens engelske reserve. Å bytte den mot
  // den generiske setningen ville kastet informasjon uten å rette noe språkbrudd.
  if (status === null && body === null) {
    const own = error instanceof Error && typeof error.message === "string" ? error.message : "";
    if (own.length > 0) return { code: null, headline: own, detail: undefined };
  }

  // Zod-utdata hører hjemme i detaljfeltet (`.toast__detail`, som har `white-space: pre-wrap`) —
  // ikke i overskriften, som klippes ved høyre kant i en 360px-bred toast.
  const issues = Array.isArray(body?.issues) && body.issues.length > 0 ? body.issues : null;

  // ⚠️ #996: `validation_error` er TO ting, og å behandle dem likt gjorde meldingen verre enn før.
  //
  //   MED `issues`   → Zod avviste formen. Utdataet hører i detaljfeltet, og overskriften er den
  //                    generiske «noe i skjemaet mangler» — for det er alt vi vet.
  //   UTEN `issues`  → en DOMENEREGEL sa nei, og serverens `message` ER forklaringen. Zod
  //                    produserer alltid `issues`, så fraværet er signalet.
  //
  // Konkret skade før fiksen: forfatteren som prøver å slette en seksjon i et utstedt kursbevis fikk
  // «Noe i skjemaet mangler eller er feil utfylt» i stedet for «den inngår i N kursbevis — arkiver
  // den i stedet». Vi byttet rå JSON (#972) mot FEIL DIAGNOSE, som er verre: rå JSON ser i det
  // minste ut som en systemfeil.
  //
  // ⚠️ At vi viser serverens `message` her er et bevisst unntak fra «koden er kontrakten»
  // (`FEATURE_SURFACE_MAP` §24), ikke en oppmykning av regelen. En forståelig setning på feil språk
  // slår en misvisende setning på riktig språk.
  //
  // #999 krympet unntaket: de fire livssyklusvaktene — innhold i bruk i et kurs, innhold i et
  // utstedt kursbevis, gammelt bevis uten øyeblikksbilde, kurs med påbegynt deltaker — kaster nå
  // `DomainRuleError` med egen kode og treffer derfor kodeoppslaget lenger ned.
  //
  // Unntaket er IKKE fjernet, og det var ikke mulig: 35 andre `ValidationError`-steder kaster
  // fortsatt prosa. Fjernes unntaket nå, faller alle 35 tilbake til «noe i skjemaet er feil
  // utfylt» — nøyaktig regresjonen #996 rettet. Det krymper etter hvert som flere vakter får kode.
  if (code === "validation_error") {
    const domainMessage = !issues && typeof body?.message === "string" && body.message.trim().length > 0
      ? body.message.trim()
      : null;
    if (domainMessage) {
      return { code, headline: domainMessage, detail: undefined };
    }
    return {
      code,
      headline: translated(t, API_ERROR_VALIDATION_KEY) ?? "The request was rejected as invalid.",
      detail: issues ? JSON.stringify(issues, null, 2) : undefined,
    };
  }

  const known = apiErrorCodeText(code, t, options.variants ?? [], body?.details ?? null);
  if (known) {
    // Kjent kode: setningen ER forklaringen. Å legge serverens JSON i detaljfeltet i tillegg ville
    // bare gitt tilbake det vi nettopp fjernet fra overskriften.
    return { code, headline: known, detail: issues ? JSON.stringify(issues, null, 2) : undefined };
  }

  // Ukjent kode. Overskriften er fortsatt lokalisert; serverens engelske `message` blir
  // diagnostikk, slik at en forfatter kan sitere den til en utvikler uten å måtte åpne konsollen.
  const generic = translated(t, API_ERROR_GENERIC_KEY);
  const headline = generic
    ? generic.replace("{status}", String(status ?? "-"))
    : `The request could not be completed (${status ?? "-"}).`;

  const diagnostics = [];
  if (code) diagnostics.push(code);
  if (typeof body?.message === "string" && body.message.length > 0) diagnostics.push(body.message);
  if (issues) diagnostics.push(JSON.stringify(issues, null, 2));
  if (diagnostics.length === 0 && error instanceof Error && error.message) diagnostics.push(error.message);

  return { code, headline, detail: diagnostics.length > 0 ? diagnostics.join("\n") : undefined };
}
