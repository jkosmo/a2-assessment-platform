import type { AppealStatus } from "@prisma/client";
import type { SupportedLocale } from "./locale.js";

type AssessmentOutcome = "pass" | "fail" | "under_review";

type NotificationMessage = {
  subject: string;
  nextStepGuidance: string;
};

type StatusTemplates = Record<AppealStatus, NotificationMessage>;

type ContextLabels = { module: string; submitted: string };
type ResolutionLabels = { outcome: string; passed: string; notPassed: string; resolutionNote: string };

const resolutionLabels: Record<SupportedLocale, ResolutionLabels> = {
  "en-GB": { outcome: "Outcome", passed: "Passed", notPassed: "Not passed", resolutionNote: "Resolution note" },
  nb: { outcome: "Resultat", passed: "Bestått", notPassed: "Ikke bestått", resolutionNote: "Begrunnelse" },
  nn: { outcome: "Resultat", passed: "Bestått", notPassed: "Ikkje bestått", resolutionNote: "Grunngjeving" },
};

const contextLabels: Record<SupportedLocale, ContextLabels> = {
  "en-GB": { module: "Module", submitted: "Submitted" },
  nb: { module: "Modul", submitted: "Innlevert" },
  nn: { module: "Modul", submitted: "Innlevert" },
};

function formatNotificationDate(date: Date, locale: SupportedLocale): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return date.toISOString();
  }
}

function buildAssessmentContextHeader(locale: SupportedLocale, context: { moduleTitle: string; submittedAt: Date }): string {
  const labels = contextLabels[locale];
  return `${labels.module}: ${context.moduleTitle}\n${labels.submitted}: ${formatNotificationDate(context.submittedAt, locale)}`;
}

function buildAppealContextHeader(locale: SupportedLocale, context: { moduleTitle: string }): string {
  const labels = contextLabels[locale];
  return `${labels.module}: ${context.moduleTitle}`;
}

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
    SUPERSEDED: {
      subject: "Your appeal has been closed",
      nextStepGuidance: "Your appeal was closed because you submitted a new attempt for this module.",
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
    SUPERSEDED: {
      subject: "Anken din er lukket",
      nextStepGuidance: "Anken din ble lukket fordi du leverte et nytt forsøk for denne modulen.",
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
    SUPERSEDED: {
      subject: "Anken di er lukka",
      nextStepGuidance: "Anken di vart lukka fordi du leverte eit nytt forsøk for denne modulen.",
    },
  },
};

export function getAppealNotificationMessage(
  locale: SupportedLocale,
  status: AppealStatus,
  context: { moduleTitle: string; resolution?: { passFailTotal: boolean; resolutionNote: string } },
): NotificationMessage {
  const template = notificationMessages[locale][status];
  const header = buildAppealContextHeader(locale, context);
  let body = `${header}\n\n`;
  if (status === "RESOLVED" && context.resolution !== undefined) {
    const labels = resolutionLabels[locale];
    const outcomeText = context.resolution.passFailTotal ? labels.passed : labels.notPassed;
    body += `${labels.outcome}: ${outcomeText}\n${labels.resolutionNote}: ${context.resolution.resolutionNote}\n\n`;
  }
  body += template.nextStepGuidance;
  return {
    subject: template.subject,
    nextStepGuidance: body,
  };
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
  context: { moduleTitle: string; submittedAt: Date },
): NotificationMessage {
  const template = assessmentResultMessages[locale][outcome];
  const header = buildAssessmentContextHeader(locale, context);
  return {
    subject: template.subject,
    nextStepGuidance: `${header}\n\n${template.nextStepGuidance}`,
  };
}

// #495/T-QA-5: diskusjons-varsler. Ingen lenker i e-post (#688) — mottakeren bes logge inn selv.
type DiscussionMessageLabels = {
  questionSubject: string; // {course}
  questionGuidance: string; // {title}
  replySubject: string; // {title}
  replyGuidance: string;
};

const discussionMessages: Record<SupportedLocale, DiscussionMessageLabels> = {
  "en-GB": {
    questionSubject: "New question in {course}",
    questionGuidance: "A participant asked a question: «{title}».\n\nLog in to the platform to view and answer it.",
    replySubject: "New reply in: {title}",
    replyGuidance: "There is a new reply in a discussion you follow: «{title}».\n\nLog in to the platform to read it.",
  },
  nb: {
    questionSubject: "Nytt spørsmål i {course}",
    questionGuidance: "En deltaker stilte et spørsmål: «{title}».\n\nLogg inn på plattformen for å se og svare.",
    replySubject: "Nytt svar i: {title}",
    replyGuidance: "Det er kommet et nytt svar i en diskusjon du følger: «{title}».\n\nLogg inn på plattformen for å lese det.",
  },
  nn: {
    questionSubject: "Nytt spørsmål i {course}",
    questionGuidance: "Ein deltakar stilte eit spørsmål: «{title}».\n\nLogg inn på plattforma for å sjå og svare.",
    replySubject: "Nytt svar i: {title}",
    replyGuidance: "Det har kome eit nytt svar i ein diskusjon du følgjer: «{title}».\n\nLogg inn på plattforma for å lese det.",
  },
};

export function getDiscussionQuestionNotificationMessage(
  locale: SupportedLocale,
  context: { courseTitle: string; threadTitle: string },
): NotificationMessage {
  const t = discussionMessages[locale];
  return {
    subject: t.questionSubject.replace("{course}", context.courseTitle),
    nextStepGuidance: t.questionGuidance.replace("{title}", context.threadTitle),
  };
}

export function getDiscussionReplyNotificationMessage(
  locale: SupportedLocale,
  context: { threadTitle: string },
): NotificationMessage {
  const t = discussionMessages[locale];
  return {
    subject: t.replySubject.replace("{title}", context.threadTitle),
    nextStepGuidance: t.replyGuidance.replace("{title}", context.threadTitle),
  };
}

// #497: kurs-frist-påminnelser. To typer: due_soon (frist nærmer seg, N dager før) og overdue
// (frist passert). Ingen lenker i e-post (#688) — mottakeren bes logge inn selv.
export type CourseReminderKind = "due_soon" | "overdue";

type CourseReminderLabels = {
  dueSoonSubject: string; // {course}
  dueSoonToday: string; // {course}
  dueSoonInDays: string; // {course} {date} {days}
  overdueSubject: string; // {course}
  overdueGuidance: string; // {course} {date}
};

const courseReminderMessages: Record<SupportedLocale, CourseReminderLabels> = {
  "en-GB": {
    dueSoonSubject: "Reminder: «{course}» is due soon",
    dueSoonToday: "The course «{course}» is due today ({date}).\n\nLog in to the platform to complete it.",
    dueSoonInDays:
      "The course «{course}» is due on {date} — {days} day(s) from now.\n\nLog in to the platform to complete it in time.",
    overdueSubject: "Overdue: «{course}» has passed its due date",
    overdueGuidance:
      "The course «{course}» was due on {date} and is not yet completed.\n\nLog in to the platform to complete it as soon as possible.",
  },
  nb: {
    dueSoonSubject: "Påminnelse: «{course}» har frist snart",
    dueSoonToday: "Kurset «{course}» har frist i dag ({date}).\n\nLogg inn på plattformen for å fullføre det.",
    dueSoonInDays:
      "Kurset «{course}» har frist {date} — om {days} dag(er).\n\nLogg inn på plattformen for å fullføre det i tide.",
    overdueSubject: "Forfalt: «{course}» har passert fristen",
    overdueGuidance:
      "Kurset «{course}» hadde frist {date} og er ennå ikke fullført.\n\nLogg inn på plattformen for å fullføre det så snart som mulig.",
  },
  nn: {
    dueSoonSubject: "Påminning: «{course}» har frist snart",
    dueSoonToday: "Kurset «{course}» har frist i dag ({date}).\n\nLogg inn på plattforma for å fullføre det.",
    dueSoonInDays:
      "Kurset «{course}» har frist {date} — om {days} dag(ar).\n\nLogg inn på plattforma for å fullføre det i tide.",
    overdueSubject: "Forfalle: «{course}» har passert fristen",
    overdueGuidance:
      "Kurset «{course}» hadde frist {date} og er enno ikkje fullført.\n\nLogg inn på plattforma for å fullføre det så snart som mogleg.",
  },
};

function formatDateOnly(date: Date, locale: SupportedLocale): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function getCourseReminderNotificationMessage(
  locale: SupportedLocale,
  kind: CourseReminderKind,
  context: { courseTitle: string; dueAt: Date; daysBefore?: number },
): NotificationMessage {
  const t = courseReminderMessages[locale];
  const dateText = formatDateOnly(context.dueAt, locale);
  if (kind === "overdue") {
    return {
      subject: t.overdueSubject.replace("{course}", context.courseTitle),
      nextStepGuidance: t.overdueGuidance.replace("{course}", context.courseTitle).replace("{date}", dateText),
    };
  }
  const days = context.daysBefore ?? 0;
  const guidance =
    days <= 0
      ? t.dueSoonToday.replace("{course}", context.courseTitle).replace("{date}", dateText)
      : t.dueSoonInDays
          .replace("{course}", context.courseTitle)
          .replace("{date}", dateText)
          .replace("{days}", String(days));
  return {
    subject: t.dueSoonSubject.replace("{course}", context.courseTitle),
    nextStepGuidance: guidance,
  };
}
