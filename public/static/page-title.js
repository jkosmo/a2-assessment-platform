import { resolveInitialLocale } from "/static/i18n-locale.js";

// Sidetittelen (fanen i nettleseren, bokmerker og lenkeforhåndsvisning): «A-2 læringsplattform – Mine kurs».
//
// ⚠️ ÉN kilde. Tittelen sto før i femten varianter («A2 Participant Test Console v2.90.0», «Kurs – A2 v…»)
// og ble satt av hver side når versjonen var hentet. Nå: siden sier hvilken side den er
// (`<html data-page="…">`), og denne fila setter tittelen på brukerens språk, ved lasting og ved
// språkbytte. Versjonsnummeret står i merket øverst på siden, ikke i tittelen.
//
// ⚠️ Den faste `<title>` i HTML-fila skal være lik bokmålsversjonen her. Det er den en lenke-
// forhåndsvisning (Teams, e-post) leser, fordi den ikke kjører skript. En test holder dem like.

export const SUPPORTED = ["nb", "nn", "en-GB"];

export const BRAND = { nb: "A-2 læringsplattform", nn: "A-2 læringsplattform", "en-GB": "A-2 learning platform" };

export const PAGES = {
  participant: { nb: "Mine kurs", nn: "Kursa mine", "en-GB": "My courses" },
  "participant-completed": { nb: "Fullførte moduler", nn: "Fullførte modular", "en-GB": "Completed modules" },
  certificate: { nb: "Kursbevis", nn: "Kursbevis", "en-GB": "Course certificate" },
  profile: { nb: "Profil", nn: "Profil", "en-GB": "Profile" },
  review: { nb: "Manuell behandling", nn: "Manuell handsaming", "en-GB": "Manual review" },
  results: { nb: "Resultater", nn: "Resultat", "en-GB": "Results" },
  "cohort-status": { nb: "Status", nn: "Status", "en-GB": "Status" },
  "participant-activity": { nb: "Aktivitet", nn: "Aktivitet", "en-GB": "Activity" },
  "admin-platform": { nb: "Plattforminnstillinger", nn: "Plattforminnstillingar", "en-GB": "Platform settings" },
  "admin-content": { nb: "Modul", nn: "Modul", "en-GB": "Module" },
  "admin-content-library": { nb: "Moduler", nn: "Modular", "en-GB": "Modules" },
  "admin-content-themes": { nb: "Tema", nn: "Tema", "en-GB": "Themes" },
  "admin-content-courses": { nb: "Kurs", nn: "Kurs", "en-GB": "Courses" },
  "admin-content-sections": { nb: "Seksjoner", nn: "Seksjonar", "en-GB": "Sections" },
  "admin-content-classes": { nb: "Klasser", nn: "Klassar", "en-GB": "Classes" },
  "admin-content-calibration": { nb: "Vurderingskvalitet", nn: "Vurderingskvalitet", "en-GB": "Assessment quality" },
};

/** «A-2 læringsplattform – Mine kurs»; bare merkenavnet når siden er ukjent. */
export function pageTitle(page, locale) {
  const loc = SUPPORTED.includes(locale) ? locale : "nb";
  const name = PAGES[page]?.[loc];
  return name ? `${BRAND[loc]} – ${name}` : BRAND[loc];
}

/** Setter tittelen på et gitt språk — for sider som bytter språk uten å gå via #localeSelect. */
export function applyPageTitle(locale) {
  apply(locale);
}

function apply(locale) {
  const page = document.documentElement.dataset.page ?? "";
  document.title = pageTitle(page, locale);
}

if (typeof document !== "undefined") {
  apply(resolveInitialLocale(SUPPORTED));
  // Språkvelgeren heter #localeSelect på alle sidene. Lytteren ligger på dokumentet, så den virker
  // uansett når siden tegner velgeren.
  document.addEventListener("change", (event) => {
    const select = event.target;
    if (select instanceof HTMLSelectElement && select.id === "localeSelect" && SUPPORTED.includes(select.value)) {
      apply(select.value);
    }
  });
}
