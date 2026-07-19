import {
  localeLabels as baseLocaleLabels,
  supportedLocales as baseSupportedLocales,
  translations as participantTranslations,
} from "./participant-translations.js";

export const supportedLocales = baseSupportedLocales;
export const localeLabels = baseLocaleLabels;

// #498: cohort-status dashboard copy. Inherits nav/identity keys from the participant base; adds the
// dashboard-specific keys here (nb/nn/en-GB).
const extra = {
  "en-GB": {
    "nav.profile": "Profile",
    "cohortPage.title": "Cohort status",
    "cohortPage.subtitle": "Participant status per course — assigned, in progress, overdue, completed.",
    "cohort.picker.label": "Course",
    "cohort.picker.placeholder": "Select a course…",
    "cohort.picker.empty": "No published courses.",
    "cohort.empty": "Select a course to see its cohort status.",
    "cohort.total": "Participants",
    "cohort.generatedAt": "Updated",
    "cohort.status.ASSIGNED": "Assigned",
    "cohort.status.IN_PROGRESS": "In progress",
    "cohort.status.OVERDUE": "Overdue",
    "cohort.status.COMPLETED": "Completed",
    "cohort.byClass.title": "By class",
    "cohort.byClass.class": "Class",
    "cohort.byClass.total": "Participants",
    "cohort.byClass.empty": "No class assignments for this course.",
    "cohort.error": "Could not load cohort status.",
  },
  nb: {
    "nav.profile": "Profil",
    "cohortPage.title": "Kohort-status",
    "cohortPage.subtitle": "Deltakernes status per kurs — tildelt, påbegynt, forfalt, fullført.",
    "cohort.picker.label": "Kurs",
    "cohort.picker.placeholder": "Velg et kurs…",
    "cohort.picker.empty": "Ingen publiserte kurs.",
    "cohort.empty": "Velg et kurs for å se kohort-status.",
    "cohort.total": "Deltakere",
    "cohort.generatedAt": "Oppdatert",
    "cohort.status.ASSIGNED": "Tildelt",
    "cohort.status.IN_PROGRESS": "Påbegynt",
    "cohort.status.OVERDUE": "Forfalt",
    "cohort.status.COMPLETED": "Fullført",
    "cohort.byClass.title": "Per klasse",
    "cohort.byClass.class": "Klasse",
    "cohort.byClass.total": "Deltakere",
    "cohort.byClass.empty": "Ingen klasse-tildelinger for dette kurset.",
    "cohort.error": "Kunne ikke laste kohort-status.",
  },
  nn: {
    "nav.profile": "Profil",
    "cohortPage.title": "Kohort-status",
    "cohortPage.subtitle": "Deltakarane sin status per kurs — tildelt, påbyrja, forfalle, fullført.",
    "cohort.picker.label": "Kurs",
    "cohort.picker.placeholder": "Vel eit kurs…",
    "cohort.picker.empty": "Ingen publiserte kurs.",
    "cohort.empty": "Vel eit kurs for å sjå kohort-status.",
    "cohort.total": "Deltakarar",
    "cohort.generatedAt": "Oppdatert",
    "cohort.status.ASSIGNED": "Tildelt",
    "cohort.status.IN_PROGRESS": "Påbyrja",
    "cohort.status.OVERDUE": "Forfalle",
    "cohort.status.COMPLETED": "Fullført",
    "cohort.byClass.title": "Per klasse",
    "cohort.byClass.class": "Klasse",
    "cohort.byClass.total": "Deltakarar",
    "cohort.byClass.empty": "Ingen klasse-tildelingar for dette kurset.",
    "cohort.error": "Kunne ikkje laste kohort-status.",
  },
};

export const translations = Object.fromEntries(
  supportedLocales.map((locale) => [
    locale,
    { ...(participantTranslations[locale] ?? {}), ...(extra[locale] ?? {}) },
  ]),
);
