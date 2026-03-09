import type { AppealStatus } from "@prisma/client";
import type { SupportedLocale } from "./locale.js";

type NotificationMessage = {
  subject: string;
  nextStepGuidance: string;
};

type StatusTemplates = Record<AppealStatus, NotificationMessage>;

const notificationMessages: Record<SupportedLocale, StatusTemplates> = {
  "en-GB": {
    OPEN: {
      subject: "Your appeal has been received",
      nextStepGuidance: "We have registered your appeal. You can follow status changes in the participant portal.",
    },
    IN_REVIEW: {
      subject: "Your appeal is now under review",
      nextStepGuidance: "An appeal handler is actively reviewing your case.",
    },
    RESOLVED: {
      subject: "Your appeal has been resolved",
      nextStepGuidance: "Review the updated result and resolution note in your submission history.",
    },
    REJECTED: {
      subject: "Your appeal has been rejected",
      nextStepGuidance: "Review the latest case note and contact an administrator if clarification is required.",
    },
  },
  nb: {
    OPEN: {
      subject: "Anken din er mottatt",
      nextStepGuidance: "Vi har registrert anken din. Du kan følge status i deltakerportalen.",
    },
    IN_REVIEW: {
      subject: "Anken din er nå under behandling",
      nextStepGuidance: "En ankebehandler vurderer saken din nå.",
    },
    RESOLVED: {
      subject: "Anken din er ferdigbehandlet",
      nextStepGuidance: "Se oppdatert resultat og begrunnelse i innleveringshistorikken din.",
    },
    REJECTED: {
      subject: "Anken din er avvist",
      nextStepGuidance: "Se siste saksnotat og kontakt administrator ved behov for avklaring.",
    },
  },
  nn: {
    OPEN: {
      subject: "Anken di er motteken",
      nextStepGuidance: "Vi har registrert anken di. Du kan følgje status i deltakarportalen.",
    },
    IN_REVIEW: {
      subject: "Anken di er no under behandling",
      nextStepGuidance: "Ein ankebehandlar vurderer saka di no.",
    },
    RESOLVED: {
      subject: "Anken di er ferdigbehandla",
      nextStepGuidance: "Sjå oppdatert resultat og grunngjeving i innleveringshistoria di.",
    },
    REJECTED: {
      subject: "Anken di er avvist",
      nextStepGuidance: "Sjå siste saksnotat og kontakt administrator ved behov for avklaring.",
    },
  },
};

export function getAppealNotificationMessage(locale: SupportedLocale, status: AppealStatus): NotificationMessage {
  return notificationMessages[locale][status];
}
