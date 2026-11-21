import { supportedLocales, translations } from "/static/i18n/admin-content-translations.js";
import { resolveInitialLocale, createTranslator } from "/static/i18n-locale.js";

// #1063 (rest): nivå-to-menyene («Kurs · Moduler · Seksjoner · Vurderingskvalitet» og «Klasser ·
// Status · Manuell behandling · Resultater») sto som bokmål i ni HTML-filer. Lenkene står fortsatt
// i HTML-en (rollegating og aktiv fane er sidens/deltakere-subnav.js sitt), men ORDENE kommer
// herfra: ett sett nøkler (area.*), lest på menyspråket, og lest på nytt når språkvelgeren
// endres — sidene tegner om uten å laste på nytt.
//
// #1173: det samme gjelder rammen rundt menyene — «Hopp til hovedinnhold», den skjulte etiketten
// på språkvelgeren og `lang` på <html>. Moduler, Seksjoner, Klasser og Tema oversatte aldri
// `data-i18n` i sin egen HTML, så de sto på engelsk på norske sider. Alle sidene som laster denne
// fila får rammen herfra, i stedet for at hver side må huske det. Bare rammen: resten av `data-i18n`
// på en side eies av sidens egen bunt, og kan ha nøkler denne bunten ikke kjenner.
const CHROME = '.skip-nav[data-i18n], label[for="localeSelect"][data-i18n]';

let locale = resolveInitialLocale(supportedLocales);
const { t } = createTranslator(translations, () => locale);

function translateAreaNav() {
  // Sidene sier lang="en-GB" i HTML-en. Skjermleseren velger uttale etter `lang`, så norsk tekst ble
  // lest med engelsk stemme. Språket på sida er menyspråket.
  document.documentElement.lang = locale;
  for (const el of document.querySelectorAll(`#contentAreaNav [data-i18n^="area."], #deltakereSubnav [data-i18n^="area."], ${CHROME}`)) {
    const key = el.getAttribute("data-i18n");
    const text = key ? t(key) : key;
    if (key && text !== key) el.textContent = text;
  }
  // #1173 (rest): navnet skjermleseren leser for selve menyen («Innholdsadministrasjon», «Deltakere») sto på bokmål.
  for (const el of document.querySelectorAll("#contentAreaNav[data-i18n-aria-label], #deltakereSubnav[data-i18n-aria-label]")) {
    const key = el.getAttribute("data-i18n-aria-label");
    const text = key ? t(key) : key;
    if (key && text !== key) el.setAttribute("aria-label", text);
  }
}

translateAreaNav();
document.addEventListener("change", (event) => {
  const select = event.target instanceof HTMLSelectElement && event.target.id === "localeSelect" ? event.target : null;
  if (!select || !supportedLocales.includes(select.value)) return;
  locale = select.value;
  translateAreaNav();
});
