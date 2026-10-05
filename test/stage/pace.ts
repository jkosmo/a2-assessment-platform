// Appen slipper gjennom 120 API-forespørsler i minuttet per bruker (`generalApiLimiter`). Utgivelses-
// testen er én bruker som åpner mange sider raskt, og hver side henter fem–ti ting. Uten en takt går
// den over grensa: lister kommer tomme tilbake, og rapporten viser feil som ikke finnes i appen.
// (Sett 2026-10-05 i en prøvekjøring mot en lokal app, der alt svarer på millisekunder. Mot stage
// er nettet tregere, så grensa ble ikke nådd før — men testen hadde ingenting som hindret det.)
//
// Hver forespørsel venter på tur, med jevn avstand. Jevnt, ikke i rykk: en test som måtte vente et
// helt minutt på neste ledige plass, ville gått i tidsavbrudd.
//
// ⚠️ Takten gjelder én prosess. Utgivelsestesten kjøres derfor med én arbeider
// (`scripts/test/stage-release-report.mjs`).

/** 100 i minuttet: under grensa på 120, med rom for det nettleseren henter utenom. */
const AVSTAND_MS = 600;
let nesteLedige = 0;

/** Venter til det er denne forespørselens tur. */
export async function vent(): Promise<void> {
  const nå = Date.now();
  const tur = Math.max(nå, nesteLedige);
  nesteLedige = tur + AVSTAND_MS;
  if (tur > nå) await new Promise((ferdig) => setTimeout(ferdig, tur - nå));
}
