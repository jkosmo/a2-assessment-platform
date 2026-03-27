import { localeLabels, supportedLocales, translations as mrTranslations } from "/static/i18n/manual-review-translations.js";
import { translations as appealTranslations } from "/static/i18n/appeal-handler-translations.js";

export { localeLabels, supportedLocales };

const pageTranslations = {
  "en-GB": {
    "reviewPage.title": "Manual Review",
    "reviewPage.subtitle": "Handle manual assessments and appeals in one place.",
    "review.section.manualReview": "Manual Assessment",
    "review.section.appeal": "Appeals",
    "review.tab.manualReview": "Manual assessment",
    "review.tab.appeal": "Appeals",
  },
  nb: {
    "reviewPage.title": "Manuell behandling",
    "reviewPage.subtitle": "Handter fagvurderinger og anker pa ett sted.",
    "review.section.manualReview": "Fagvurdering",
    "review.section.appeal": "Ankebehandling",
    "review.tab.manualReview": "Manuell vurdering",
    "review.tab.appeal": "Anke",
  },
  nn: {
    "reviewPage.title": "Manuell handsaming",
    "reviewPage.subtitle": "Handter fagvurderingar og ankar pa eitt stad.",
    "review.section.manualReview": "Fagvurdering",
    "review.section.appeal": "Ankebehandling",
    "review.tab.manualReview": "Manuell vurdering",
    "review.tab.appeal": "Anke",
  },
};

export const translations = Object.fromEntries(
  supportedLocales.map((locale) => [
    locale,
    {
      ...(mrTranslations[locale] ?? {}),
      ...(appealTranslations[locale] ?? {}),
      ...(pageTranslations[locale] ?? {}),
    },
  ]),
);
