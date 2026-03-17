import type { AppealStatus } from "@prisma/client";
import type { SupportedLocale } from "./locale.js";

type AssessmentOutcome = "pass" | "fail" | "under_review";

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

type AssessmentResultTemplates = Record<AssessmentOutcome, NotificationMessage>;

const assessmentResultMessages: Record<SupportedLocale, AssessmentResultTemplates> = {
  "en-GB": {
    pass: {
      subject: "You have passed your assessment",
      nextStepGuidance: "Congratulations! Your submission has been assessed and you have passed. You can view your result in the participant portal.",
    },
    fail: {
      subject: "Assessment result: not passed",
      nextStepGuidance: "Your submission has been assessed. Unfortunately you did not pass this time. You can review the result and submit an appeal in the participant portal.",
    },
    under_review: {
      subject: "Your assessment is under manual review",
      nextStepGuidance: "Your submission is being reviewed by an assessor. You will receive a notification when the review is complete.",
    },
  },
  nb: {
    pass: {
      subject: "Du har bestått vurderingen",
      nextStepGuidance: "Gratulerer! Innleveringen din er vurdert og du har bestått. Du kan se resultatet i deltakerportalen.",
    },
    fail: {
      subject: "Vurderingsresultat: ikke bestått",
      nextStepGuidance: "Innleveringen din er vurdert. Du bestod dessverre ikke denne gangen. Du kan se resultatet og sende inn en anke i deltakerportalen.",
    },
    under_review: {
      subject: "Vurderingen din er til manuell gjennomgang",
      nextStepGuidance: "Innleveringen din gjennomgås av en sensor. Du vil motta en varsling når gjennomgangen er fullført.",
    },
  },
  nn: {
    pass: {
      subject: "Du har bestått vurderinga",
      nextStepGuidance: "Gratulerer! Innleveringa di er vurdert og du har bestått. Du kan sjå resultatet i deltakarportalen.",
    },
    fail: {
      subject: "Vurderingsresultat: ikkje bestått",
      nextStepGuidance: "Innleveringa di er vurdert. Du bestod dessverre ikkje denne gongen. Du kan sjå resultatet og sende inn ein klage i deltakarportalen.",
    },
    under_review: {
      subject: "Vurderinga di er til manuell gjennomgang",
      nextStepGuidance: "Innleveringa di vert gjennomgått av ein sensor. Du vil motta ei varsling når gjennomgangen er fullført.",
    },
  },
};

export function getAssessmentResultNotificationMessage(
  locale: SupportedLocale,
  outcome: AssessmentOutcome,
): NotificationMessage {
  return assessmentResultMessages[locale][outcome];
}
