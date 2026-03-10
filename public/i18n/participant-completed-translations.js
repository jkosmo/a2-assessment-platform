import {
  localeLabels as baseLocaleLabels,
  supportedLocales as baseSupportedLocales,
  translations as participantTranslations,
} from "./participant-translations.js";

export const supportedLocales = baseSupportedLocales;
export const localeLabels = baseLocaleLabels;

const extraTranslations = {
  "en-GB": {
    "completedPage.title": "Completed Modules",
    "completedPage.subtitle": "See what you have finished and your latest score per module.",
    "completedPage.versionLabel": "Version:",
    "completed.title": "My completed modules",
    "completed.limit": "Max modules",
    "completed.load": "Load completed modules",
    "completed.empty": "No completed modules found.",
    "completed.meta.loadedPrefix": "Completed modules loaded",
    "completed.table.module": "Module",
    "completed.table.completedAt": "Completed",
    "completed.table.status": "Status",
    "completed.table.score": "Total score",
    "completed.table.passFail": "Pass/fail",
    "completed.value.pass": "Pass",
    "completed.value.fail": "Fail",
  },
  nb: {
    "completedPage.title": "Fullførte moduler",
    "completedPage.subtitle": "Se hva du har fullført og siste poengsum per modul.",
    "completedPage.versionLabel": "Versjon:",
    "completed.title": "Mine fullførte moduler",
    "completed.limit": "Maks moduler",
    "completed.load": "Last fullførte moduler",
    "completed.empty": "Ingen fullførte moduler funnet.",
    "completed.meta.loadedPrefix": "Fullførte moduler lastet",
    "completed.table.module": "Modul",
    "completed.table.completedAt": "Fullført",
    "completed.table.status": "Status",
    "completed.table.score": "Total poengsum",
    "completed.table.passFail": "Bestått/ikke bestått",
    "completed.value.pass": "Bestått",
    "completed.value.fail": "Ikke bestått",
  },
  nn: {
    "completedPage.title": "Fullførte modular",
    "completedPage.subtitle": "Sjå kva du har fullført og siste poengsum per modul.",
    "completedPage.versionLabel": "Versjon:",
    "completed.title": "Mine fullførte modular",
    "completed.limit": "Maks modular",
    "completed.load": "Last fullførte modular",
    "completed.empty": "Ingen fullførte modular funne.",
    "completed.meta.loadedPrefix": "Fullførte modular lasta",
    "completed.table.module": "Modul",
    "completed.table.completedAt": "Fullført",
    "completed.table.status": "Status",
    "completed.table.score": "Total poengsum",
    "completed.table.passFail": "Bestått/ikkje bestått",
    "completed.value.pass": "Bestått",
    "completed.value.fail": "Ikkje bestått",
  },
};

export const translations = Object.fromEntries(
  supportedLocales.map((locale) => [
    locale,
    {
      ...(participantTranslations[locale] ?? {}),
      ...(extraTranslations[locale] ?? {}),
    },
  ]),
);
