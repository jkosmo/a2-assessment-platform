import { escapeHtml } from "/static/html-escape.js";
import { LEGACY_STRING_LOCALE } from "/static/localized-value.js";
import { supportedLocales } from "/static/i18n/participant-translations.js";

/**
 * #894: omdøping direkte i lista, og hvilke språk tittelen mangler.
 *
 * ⚠️ Saken ble målt i klikk: en forfatter døpte om 18 elementer og brukte over hundre
 * interaksjoner, fordi hver tittel måtte åpnes, endres, oversettes, lagres og publiseres. Verre
 * enn tidsbruken: den billigste veien ga feil resultat — et halvt kurs endte med titler på feil
 * språk, uten at noe sa fra (#892).
 *
 * Derfor gjør denne fila to ting, og de henger sammen:
 *   1. Omdøping skjer i raden. Enter lagrer på språket lista viser, Escape avbryter.
 *   2. Raden viser HULLENE («nn, en mangler»), og én knapp øverst oversetter alle hullene i lista
 *      i én runde. Oversettingen kommer altså ETTER omdøpingene, ikke mellom dem.
 *
 * Delt mellom modul- og seksjonslista, fordi de har nøyaktig samme problem og skal ikke få hver
 * sin løsning på det (#941-mønsteret).
 */

/**
 * Språkene, i plattformens egen rekkefølge. Hentet, ikke skrevet på nytt: en fjerde språk her ville
 * ellers måttet huskes ett sted til.
 */
export const ALLE_SPRAAK = supportedLocales;
/** Kort merkelapp i lista. Ikke oversatt: det ER språkkodene, og de leses likt på alle tre. */
const KORT = { nb: "nb", nn: "nn", "en-GB": "en" };

/**
 * Språk tittelen mangler.
 *
 * ⚠️ `titleLocales` er tom for en tittel lagret som REN STRENG — lagringsformatets måte å si
 * «skrevet på ett språk, ikke oversatt». Klienten leser en slik streng som bokmål
 * (`LEGACY_STRING_LOCALE`), og da mangler de to andre.
 */
export function manglendeSpraak(item) {
  const finnes = spraakSomFinnes(item);
  return ALLE_SPRAAK.filter((locale) => !finnes.includes(locale));
}

/**
 * Hele språkkartet for en lagret tittel, slik tjeneren leser det.
 *
 * ⚠️ En REN STRENG hører til `LEGACY_STRING_LOCALE` (bokmål) — ikke til språket lista tilfeldigvis
 * står i. Seksjonssidas egen `parseLocalized` legger den under VISNINGSSPRÅKET, som er riktig i
 * editoren og feil her: en omdøping sett i nynorsk ville flyttet den norske teksten til nynorsk og
 * gitt nøyaktig den tilstanden #892 handler om. Konstanten er DEN SAMME som `mergeLocaleInto`
 * bruker, slik at de to ikke kan gli fra hverandre.
 *
 * ⚠️ Brukes bare der klienten har den lagrede teksten. Modulbibliotekets rader har en OPPSLÅTT
 * tittel (tjeneren har alt valgt språk), og der eier tjeneren sammenslåingen i stedet.
 */
export function lagretTittelkart(raw) {
  if (typeof raw !== "string") return {};
  const trimmet = raw.trim();
  if (trimmet.startsWith("{") && trimmet.endsWith("}")) {
    try {
      const lest = JSON.parse(trimmet);
      const ut = {};
      for (const locale of ALLE_SPRAAK) {
        if (typeof lest[locale] === "string" && lest[locale].trim().length > 0) ut[locale] = lest[locale];
      }
      return ut;
    } catch { /* ikke gyldig JSON — les den som ren tekst under */ }
  }
  return trimmet.length > 0 ? { [LEGACY_STRING_LOCALE]: trimmet } : {};
}

/** Språket vi oversetter FRA: det lista viser, hvis tittelen finnes der — ellers det som finnes. */
export function kildespraakFor(item, visningsspraak) {
  const finnes = spraakSomFinnes(item);
  return finnes.includes(visningsspraak) ? visningsspraak : finnes[0];
}

/** Tom `titleLocales` betyr «lagret som ren streng», og den leser tjeneren som bokmål. */
function spraakSomFinnes(item) {
  return Array.isArray(item?.titleLocales) && item.titleLocales.length > 0
    ? item.titleLocales
    : [LEGACY_STRING_LOCALE];
}

/** Merket i lista: hva som mangler, ikke hva som finnes — forfatteren leter etter hull. */
export function spraakMerkeHtml(item, tf) {
  const mangler = manglendeSpraak(item);
  if (mangler.length === 0) return `<span class="lang-complete">${escapeHtml(tf("ui.lang.complete"))}</span>`;
  const koder = mangler.map((l) => KORT[l] ?? l).join(", ");
  return `<span class="lang-gap" title="${escapeHtml(tf("ui.lang.gapTitle"))}">${escapeHtml(tf("ui.lang.gap", { locales: koder }))}</span>`;
}

/** Radene som mangler minst ett språk, og som denne forfatteren får endre. */
export function medHullAv(synlige) {
  return (synlige ?? []).filter((item) => item.canManage !== false && manglendeSpraak(item).length > 0);
}

/**
 * Hodeknappen «Oversett det som mangler (N)».
 *
 * ⚠️ Tallet skal si hva knappen KOMMER TIL Å GJØRE, og det gjelder de synlige radene. Derfor hører
 * kallet i `afterTableRender` (list-page.js): et filterklikk tegner bare tabellen, og etter et slikt
 * klikk ville et tall satt ved full tegning stått igjen og lovet noe annet enn knappen gjør.
 */
export function oppdaterHullknapp(knappId, medHull, tf) {
  const knapp = document.getElementById(knappId);
  if (!knapp) return;
  knapp.textContent = tf("ui.lang.translateGaps", { count: medHull.length });
  knapp.disabled = medHull.length === 0;
}

/**
 * Den samlede oversettingsrunden, én gang for begge listene.
 *
 * Bare TO ting skiller modulene fra seksjonene: hvor kildeteksten ligger, og hvordan en tittel
 * patches. Resten — hvilke språk som mangler, hvilket vi oversetter fra, og hva som skjer når ett
 * språk ikke kommer gjennom — er samme regel, og skal ikke ha to utgaver som kan gli fra hverandre.
 *
 * ⚠️ Et språk som ikke går gjennom, blir stående TOMT og nevnt ved navn. Å fylle det med
 * kildeteksten ville gitt en tittel som ser oversatt ut og leser som feil språk — det er #892, og
 * det er nettopp derfor denne saken var blokkert av den.
 *
 * `lagre(item, nyeSpraak, kilde, kildetekst)` eier patchen, for de to listene har ULIKE kontrakter:
 * modulenes tittel-PATCH slår sammen på tjeneren, seksjonenes erstatter.
 */
export async function oversettManglende(elementer, { visningsspraak, kildetekstFor, oversett, lagre }) {
  let oversatt = 0;
  const feilet = [];
  for (const item of elementer) {
    const mangler = manglendeSpraak(item);
    const kilde = kildespraakFor(item, visningsspraak);
    const kildetekst = String(kildetekstFor(item, kilde) ?? "").trim();
    if (!kildetekst || mangler.length === 0) continue;
    try {
      const svar = await oversett({ title: kildetekst, sourceLocale: kilde, targetLocales: mangler });
      const nye = svar?.title ?? {};
      if (Object.keys(nye).length > 0) {
        await lagre(item, nye, kilde, kildetekst);
        oversatt += Object.keys(nye).length;
      }
      for (const locale of svar?.failedLocales ?? []) feilet.push(`${kildetekst} (${locale})`);
    } catch {
      feilet.push(kildetekst);
    }
  }
  return { oversatt, feilet };
}

/** Toasten etter runden: hvor mange som kom gjennom, og hvilke som står igjen tomme. */
export function oversettToast({ oversatt, feilet }, tf) {
  const talt = tf("ui.lang.translated", { count: oversatt });
  if (feilet.length === 0) return [talt, "success"];
  return [`${talt} ${tf("ui.lang.translateFailed", { items: feilet.join(", ") })}`, "error"];
}

/**
 * Bytter navnecella i en rad til et skrivefelt.
 *
 * `onSave(nyTittel)` skal lagre og returnere når det er gjort; kalleren tegner lista på nytt.
 * Feltet er bevisst uten egen lagreknapp: Enter og Escape er hele kontrakten, og den står i hintet
 * ved siden av feltet så den ikke må gjettes.
 */
export function startOmdoping({ rad, gjeldendeTittel, visningsspraak, spraakNavn, tf, onSave, onCancel }) {
  const celle = rad.querySelector("td");
  if (!celle) return;
  const original = celle.innerHTML;
  const feltId = `rename-${Math.random().toString(36).slice(2, 9)}`;
  celle.innerHTML = `<div class="row-rename">
    <label class="sr-only" for="${feltId}">${escapeHtml(tf("ui.rename.label", { locale: spraakNavn }))}</label>
    <input id="${feltId}" type="text" value="${escapeHtml(gjeldendeTittel)}" autocomplete="off" />
    <span class="row-rename-hint">${escapeHtml(tf("ui.rename.hint"))}</span>
  </div>`;
  const felt = celle.querySelector("input");
  felt.focus();
  felt.select();

  let ferdig = false;
  const avbryt = () => {
    if (ferdig) return;
    ferdig = true;
    celle.innerHTML = original;
    onCancel?.();
  };

  felt.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      avbryt();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const verdi = felt.value.trim();
    // Tom tittel er ikke en omdøping. Å lagre den ville gitt en rad uten navn.
    if (!verdi || verdi === gjeldendeTittel) {
      avbryt();
      return;
    }
    ferdig = true;
    felt.disabled = true;
    await onSave(verdi, visningsspraak);
  });
  // Klikker forfatteren et annet sted, er det ikke en lagring — det er et avbrudd.
  felt.addEventListener("blur", () => setTimeout(avbryt, 120));
}
