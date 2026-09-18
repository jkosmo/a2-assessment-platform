import { supportedLocales, translations } from "/static/i18n/admin-content-translations.js";
import { resolveInitialLocale, createTranslator } from "/static/i18n-locale.js";

// #1063 (rest): nivå-to-menyene («Kurs · Moduler · Seksjoner · Vurderingskvalitet» og «Klasser ·
// Status · Manuell behandling · Resultater») sto som bokmål i ni HTML-filer. Lenkene står fortsatt
// i HTML-en (rollegating og aktiv fane er sidens/deltakere-subnav.js sitt), men ORDENE kommer
// herfra: ett sett nøkler (area.*), lest på menyspråket, og lest på nytt når språkvelgeren
// endres — sidene tegner om uten å laste på nytt.

let locale = resolveInitialLocale(supportedLocales);
const { t } = createTranslator(translations, () => locale);

function translateAreaNav() {
  for (const el of document.querySelectorAll('#contentAreaNav [data-i18n^="area."], #deltakereSubnav [data-i18n^="area."]')) {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  }
}

translateAreaNav();
document.addEventListener("change", (event) => {
  const select = event.target instanceof HTMLSelectElement && event.target.id === "localeSelect" ? event.target : null;
  if (!select || !supportedLocales.includes(select.value)) return;
  locale = select.value;
  translateAreaNav();
});
