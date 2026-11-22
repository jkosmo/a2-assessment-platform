import type { AppealStatus } from "@prisma/client";
import type { SupportedLocale } from "./locale.js";
import { mascotEmailText } from "../modules/mascot/mascotPack.js";

type AssessmentOutcome = "pass" | "fail" | "under_review";

type NotificationMessage = {
  subject: string;
  nextStepGuidance: string;
};

// Compliance godkjente lenker i e-post 2026-11-06. Teksten «Logg inn på …» står: den gjelder også uten lenke.
export type EmailLinkKind = "course" | "module" | "discussion" | "myCourses";

const emailLinkLabels: Record<SupportedLocale, Record<EmailLinkKind, string>> = {
  "en-GB": { course: "Open the course", module: "Open the module", discussion: "Open the discussion", myCourses: "Open My courses" },
  nb: { course: "Åpne kurset", module: "Åpne modulen", discussion: "Åpne diskusjonen", myCourses: "Åpne Mine kurs" },
  nn: { course: "Opne kurset", module: "Opne modulen", discussion: "Opne diskusjonen", myCourses: "Opne Mine kurs" },
};

export function getEmailLinkLabel(locale: SupportedLocale, kind: EmailLinkKind): string {
  return emailLinkLabels[locale][kind];
}

// #1141: siste linje i e-posten sier hvorfor mottakeren får den.
// #1142: `classMember` er for den samlede e-posten om nye kurs. «Klassen din er tildelt et kurs» (`assignment`) stemte
// ikke når personen selv er lagt til i en klasse, eller kurset er publisert; den ble fjernet med den gamle e-posten (skive 3).
export type EmailReason = "submission" | "appeal" | "classMember" | "reminder" | "discussionQuestion" | "discussionReply";

const emailReasons: Record<SupportedLocale, Record<EmailReason, string>> = {
  "en-GB": {
    submission: "You are getting this e-mail because you handed in an answer on A-2 læringsplattform.",
    appeal: "You are getting this e-mail because you appealed an assessment on A-2 læringsplattform.",
    classMember: "You are getting this e-mail because you are in a class on A-2 læringsplattform.",
    reminder: "You are getting this e-mail because you have a course with a due date.",
    discussionQuestion: "You are getting this e-mail because you own the course or are an administrator of the platform.",
    discussionReply: "You are getting this e-mail because you follow this discussion.",
  },
  nb: {
    submission: "Du får denne e-posten fordi du har levert en besvarelse på A-2 læringsplattform.",
    appeal: "Du får denne e-posten fordi du har anket en vurdering på A-2 læringsplattform.",
    classMember: "Du får denne e-posten fordi du er med i en klasse på A-2 læringsplattform.",
    reminder: "Du får denne e-posten fordi du har et kurs med frist.",
    discussionQuestion: "Du får denne e-posten fordi du eier kurset eller er administrator på plattformen.",
    discussionReply: "Du får denne e-posten fordi du følger denne diskusjonen.",
  },
  nn: {
    submission: "Du får denne e-posten fordi du har levert eit svar på A-2 læringsplattform.",
    appeal: "Du får denne e-posten fordi du har anka ei vurdering på A-2 læringsplattform.",
    classMember: "Du får denne e-posten fordi du er med i ein klasse på A-2 læringsplattform.",
    reminder: "Du får denne e-posten fordi du har eit kurs med frist.",
    discussionQuestion: "Du får denne e-posten fordi du eig kurset eller er administrator på plattforma.",
    discussionReply: "Du får denne e-posten fordi du følgjer denne diskusjonen.",
  },
};

export function getEmailReason(locale: SupportedLocale, reason: EmailReason): string {
  return emailReasons[locale][reason];
}

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

// #495/T-QA-5: diskusjons-varsler. Lenken legges til av malen (emailLinks.ts), teksten skal virke uten den.
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
// (frist passert). Lenken legges til av malen (emailLinks.ts), teksten skal virke uten den.
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

// #997: modulen du besto er revidert. Ett varsel per deltaker per revisjon — ikke en kalender
// (det var maset #989 fjernet). Går som ren tekst uten bilde og lenke (sendModuleRevisedNotification).
//
// 2.101.0: produkteier, 2026-10-25 — «dette er ikke bra formulert». Ordlyden er produkteiers, og
// kurset beståtten gjaldt, står i teksten. En modul uten publisert kurs gir setningen uten kurs.
type ModuleRevisedLabels = {
  subject: string; // {module}
  body: string; // {module}
  /** Etter `body` når modulen ligger i minst ett publisert kurs. {courses} */
  lostPassForCourses: string;
  /** Etter `body` når den ikke gjør det. */
  lostPass: string;
  /** Mellom de to siste kursnavnene: «A», «B» og «C». */
  and: string;
  closing: string;
};

const moduleRevisedMessages: Record<SupportedLocale, ModuleRevisedLabels> = {
  "en-GB": {
    subject: "Module revised: {module}",
    body: "Hello!\n\nThe module «{module}», which you had passed, has been revised.",
    lostPassForCourses: " Your earlier pass no longer counts, and you need to take the module again to keep a passed course for {courses}.",
    lostPass: " Your earlier pass no longer counts.",
    and: "and",
    closing: "\n\nLog in to the platform to take the module again.",
  },
  nb: {
    subject: "Modulen er revidert: {module}",
    body: "Hei!\n\nModulen «{module}», som du hadde bestått, er revidert.",
    lostPassForCourses: " Din tidligere bestått teller ikke lenger, og du må oppdatere for å fortsatt ha et bestått kurs for {courses}.",
    lostPass: " Din tidligere bestått teller ikke lenger.",
    and: "og",
    closing: "\n\nLogg inn på plattformen for å ta modulen på nytt.",
  },
  nn: {
    subject: "Modulen er revidert: {module}",
    body: "Hei!\n\nModulen «{module}», som du hadde bestått, er revidert.",
    lostPassForCourses: " Det tidlegare beståtte ditt tel ikkje lenger, og du må oppdatere for framleis å ha eit bestått kurs for {courses}.",
    lostPass: " Det tidlegare beståtte ditt tel ikkje lenger.",
    and: "og",
    closing: "\n\nLogg inn på plattforma for å ta modulen på nytt.",
  },
};

function quotedList(titles: string[], and: string): string {
  const quoted = titles.map((title) => `«${title}»`);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} ${and} ${quoted[quoted.length - 1]}`;
}

export function getModuleRevisedNotificationMessage(
  locale: SupportedLocale,
  context: { moduleTitle: string; courseTitles?: string[] },
): NotificationMessage {
  const t = moduleRevisedMessages[locale];
  const courses = (context.courseTitles ?? []).filter((title) => title.trim());
  const lost = courses.length > 0 ? t.lostPassForCourses.replace("{courses}", quotedList(courses, t.and)) : t.lostPass;
  return {
    subject: t.subject.replace("{module}", context.moduleTitle),
    nextStepGuidance: t.body.replace("{module}", context.moduleTitle) + lost + t.closing,
  };
}

// #934 skive 4b: kurset har fått en ny hovedversjon. Til dem som har kursbevis for en eldre versjon (doc/DESIGN_934.md).
// Siste avsnitt sier hvor kurset ligger, så teksten virker også uten lenken fra malen. Tonen som i #1139: voksen, litt
// humor (båten er på verftet, som på bildet), aldri skam — det gamle beviset står, og ingen har gjort noe galt.
// Teksten er avsnitt, ikke én streng: den felles malen (illustratedEmail.ts) lager både HTML og ren tekst av dem.
// Setningen som nevner maskoten («har vært en tur på verftet») står hel i maskotpakken (`courseNewVersionIntro`).
export type CourseMajorVersionMessage = { subject: string; paragraphs: string[]; reason: string };

type CourseMajorVersionLabels = {
  subject: string; // {course} {major}
  greeting: string;
  changedOne: string;
  // «Det er …», ikke «3 elementer …»: rett etter «versjon 4.» ville tallet lest som «versjon 4.3».
  changedMany: string; // {n}
  certificate: string; // {major}
  closing: string;
  reason: string; // {course}
};

const courseMajorVersionMessages: Record<SupportedLocale, CourseMajorVersionLabels> = {
  "en-GB": {
    subject: "«{course}» has a new version: version {major}",
    greeting: "Hello!",
    changedOne: "There is one new or changed item.",
    changedMany: "There are {n} new or changed items.",
    certificate:
      "The course certificate you already have still applies to the version it was issued for. What you have done still counts: to get a certificate for version {major}, you only need to take what is new or changed.",
    closing: "Log in to A-2 læringsplattform and open the course under My courses.",
    reason: "You are getting this e-mail because you have a course certificate for «{course}».",
  },
  nb: {
    subject: "«{course}» har fått versjon {major}",
    greeting: "Hei!",
    changedOne: "Det er ett nytt eller endret element.",
    changedMany: "Det er {n} nye eller endrede elementer.",
    certificate:
      "Kursbeviset du har fra før, gjelder fortsatt for versjonen det ble utstedt for. Det du har gjort, teller: for å få kursbevis for versjon {major} tar du bare det som er nytt eller endret.",
    closing: "Logg inn på A-2 læringsplattform og åpne kurset under Mine kurs.",
    reason: "Du får denne e-posten fordi du har kursbevis for «{course}».",
  },
  nn: {
    subject: "«{course}» har fått versjon {major}",
    greeting: "Hei!",
    changedOne: "Det er eitt nytt eller endra element.",
    changedMany: "Det er {n} nye eller endra element.",
    certificate:
      "Kursbeviset du har frå før, gjeld framleis for versjonen det vart utferda for. Det du har gjort, tel: for å få kursbevis for versjon {major} tek du berre det som er nytt eller endra.",
    closing: "Logg inn på A-2 læringsplattform og opne kurset under Mine kurs.",
    reason: "Du får denne e-posten fordi du har kursbevis for «{course}».",
  },
};

export function getCourseMajorVersionNotificationMessage(
  locale: SupportedLocale,
  context: { courseTitle: string; versionMajor: number; changedItemCount: number | null },
): CourseMajorVersionMessage {
  const t = courseMajorVersionMessages[locale];
  const fill = (template: string) =>
    template.split("{course}").join(context.courseTitle).split("{major}").join(String(context.versionMajor));
  const n = context.changedItemCount;
  // Tallet mangler for en hovedversjon laget før 2.132.0, og er 0 når bare noe er tatt ut: da sier e-posten ingenting om det.
  const changed = n == null || n <= 0 ? "" : n === 1 ? t.changedOne : t.changedMany.split("{n}").join(String(n));
  return {
    subject: fill(t.subject),
    paragraphs: [t.greeting, [fill(mascotEmailText("courseNewVersionIntro", locale)), changed].filter(Boolean).join(" "), fill(t.certificate), t.closing],
    reason: fill(t.reason),
  };
}

// #1142: ÉN e-post når en deltaker har fått nye kurs (doc/design/PLAN_1142.md, punkt 5). Erstattet e-posten per kurs ved
// tildeling i skive 3. Ett kurs og flere kurs har hvert sitt emne og sin innledning; lista er ett avsnitt med linjeskift, som malen
// gjør til `<br>`. Siste avsnitt sier hvor kursene ligger, så teksten virker også uten lenken fra malen.
// Begynnelsen av innledningen («Fortøyningen er sluppet:») står i maskotpakken (`courseAssignedIntro`); resten her.
export type CourseAssignmentDigestCourse = {
  /** Tittelen på mottakerens språk. */
  title: string;
  /** Klassene personen har kurset fra. */
  classNames: string[];
  /** Den tidligste fristen blant klassene, eller null. */
  dueAt: Date | null;
};

export type CourseAssignmentDigestMessage = { subject: string; paragraphs: string[] };

type CourseAssignmentDigestLabels = {
  subjectOne: string; // {course}
  subjectMany: string; // {n}
  greeting: string;
  introOne: string;
  introMany: string; // {n}
  fromClass: string; // {class}
  fromClasses: string; // {classes}
  and: string;
  due: string; // {date}
  /** Ett kurs: knappen går rett til kurset. */
  closingOne: string;
  /** Flere kurs: knappen går til «Mine kurs». */
  closingMany: string;
};

const courseAssignmentDigestMessages: Record<SupportedLocale, CourseAssignmentDigestLabels> = {
  "en-GB": {
    subjectOne: "You have a new course: «{course}»",
    subjectMany: "You have {n} new courses",
    greeting: "Hello!",
    introOne: "you have a new course on A-2 læringsplattform.",
    introMany: "you have {n} new courses on A-2 læringsplattform.",
    fromClass: "from the class {class}",
    fromClasses: "from the classes {classes}",
    and: "and",
    due: "due {date}",
    closingOne: "Log in to A-2 læringsplattform and open the course under My courses.",
    closingMany: "Log in to A-2 læringsplattform and open My courses.",
  },
  nb: {
    subjectOne: "Du har fått et nytt kurs: «{course}»",
    subjectMany: "Du har fått {n} nye kurs",
    greeting: "Hei!",
    introOne: "du har fått et nytt kurs på A-2 læringsplattform.",
    introMany: "du har fått {n} nye kurs på A-2 læringsplattform.",
    fromClass: "fra klassen {class}",
    fromClasses: "fra klassene {classes}",
    and: "og",
    due: "frist {date}",
    closingOne: "Logg inn på A-2 læringsplattform og åpne kurset under Mine kurs.",
    closingMany: "Logg inn på A-2 læringsplattform og åpne Mine kurs.",
  },
  nn: {
    subjectOne: "Du har fått eit nytt kurs: «{course}»",
    subjectMany: "Du har fått {n} nye kurs",
    greeting: "Hei!",
    introOne: "du har fått eit nytt kurs på A-2 læringsplattform.",
    introMany: "du har fått {n} nye kurs på A-2 læringsplattform.",
    fromClass: "frå klassen {class}",
    fromClasses: "frå klassane {classes}",
    and: "og",
    due: "frist {date}",
    closingOne: "Logg inn på A-2 læringsplattform og opne kurset under Mine kurs.",
    closingMany: "Logg inn på A-2 læringsplattform og opne Mine kurs.",
  },
};

/** Tidligste frist først, kurs uten frist sist, så tittel i mottakerens alfabet. Klassene sorteres på navn. */
export function sortCourseAssignmentDigestCourses(locale: SupportedLocale, courses: CourseAssignmentDigestCourse[]): CourseAssignmentDigestCourse[] {
  const collator = new Intl.Collator(locale);
  return courses
    .map((course) => ({ ...course, classNames: [...course.classNames].sort(collator.compare) }))
    .sort((a, b) => {
      if (a.dueAt && b.dueAt && a.dueAt.getTime() !== b.dueAt.getTime()) return a.dueAt.getTime() - b.dueAt.getTime();
      if (a.dueAt && !b.dueAt) return -1;
      if (!a.dueAt && b.dueAt) return 1;
      return collator.compare(a.title, b.title);
    });
}

// ── #1139: den ukentlige e-posten (doc/design/PLAN_1139.md, punkt 1 og 2) ──────────────────────────────────────────────────
//
// Emnet er fast. Innholdet i rekkefølge: hilsen, båtens linje for humøret (fra maskotpakken, i weeklyDigestEmail.ts), frister som
// har gått ut, frister innen to uker, kurs i gang med steg igjen, tildelte kurs som ikke er påbegynt, avslutning. Siste linje er
// ALLTID avmeldingen, steg for steg, med bryterens navn nøyaktig som på profilen (`WEEKLY_EMAIL_TOGGLE_NAME`; testen sammenligner
// med profilens oversettelse). Tonen: humor og et snev av dårlig samvittighet, aldri skam. Båten står for humoren; resten er rett
// fram.

/** Bryteren på profilen. Profilens oversettelse skal bruke nøyaktig denne teksten (skive 2, testen sammenligner). */
export const WEEKLY_EMAIL_TOGGLE_NAME: Record<SupportedLocale, string> = {
  "en-GB": "Weekly e-mail from the boat",
  nb: "Ukentlig e-post fra båten",
  nn: "Vekentleg e-post frå båten",
};

/** Så mange kurs vises per gruppe; resten blir «… og N til». */
export const WEEKLY_DIGEST_MAX_PER_GROUP = 8;

type WeeklyDigestLabels = {
  subject: string;
  greeting: string;
  overdue: string;
  dueSoon: string;
  inProgress: string;
  notStarted: string;
  due: string; // {date}
  stepsLeftOne: string;
  stepsLeftMany: string; // {n}
  more: string; // {n}
  closing: string;
  reason: string; // {toggle}
};

const weeklyDigestMessages: Record<SupportedLocale, WeeklyDigestLabels> = {
  "en-GB": {
    subject: "The learning platform: status of your courses",
    greeting: "Hello!",
    overdue: "The due date has passed:",
    dueSoon: "Due soon:",
    inProgress: "In progress:",
    notStarted: "Assigned, not started:",
    due: "due {date}",
    stepsLeftOne: "1 step left",
    stepsLeftMany: "{n} steps left",
    more: "… and {n} more",
    closing: "Log in to A-2 læringsplattform and open My courses.",
    reason:
      "You get this e-mail on Mondays because you have courses waiting on A-2 læringsplattform. To stop it: log in, open Profile and turn off «{toggle}».",
  },
  nb: {
    subject: "Læringsplattformen, status på dine kurs",
    greeting: "Hei!",
    overdue: "Fristen har gått ut:",
    dueSoon: "Frist snart:",
    inProgress: "I gang:",
    notStarted: "Tildelt, ikke påbegynt:",
    due: "frist {date}",
    stepsLeftOne: "1 steg igjen",
    stepsLeftMany: "{n} steg igjen",
    more: "… og {n} til",
    closing: "Logg inn på A-2 læringsplattform og åpne Mine kurs.",
    reason:
      "Du får denne e-posten på mandager fordi du har kurs som venter på A-2 læringsplattform. Vil du ikke ha den: logg inn, åpne Profil og slå av «{toggle}».",
  },
  nn: {
    subject: "Læringsplattforma, status på kursa dine",
    greeting: "Hei!",
    overdue: "Fristen har gått ut:",
    dueSoon: "Frist snart:",
    inProgress: "I gang:",
    notStarted: "Tildelt, ikkje påbyrja:",
    due: "frist {date}",
    stepsLeftOne: "1 steg att",
    stepsLeftMany: "{n} steg att",
    more: "… og {n} til",
    closing: "Logg inn på A-2 læringsplattform og opne Mine kurs.",
    reason:
      "Du får denne e-posten på måndagar fordi du har kurs som ventar på A-2 læringsplattform. Vil du ikkje ha han: logg inn, opne Profil og slå av «{toggle}».",
  },
};

export type WeeklyDigestMessageCourse = { title: string; dueAt: Date | null; stepsLeft: number; started: boolean };

/** Fristen som dato i Oslo (fristdager er Oslo-dager, planen 12.11). */
function formatOsloDate(date: Date, locale: SupportedLocale): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Oslo" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Teksten i den ukentlige e-posten. `moodLine` er båtens linje (maskotpakken). Gruppene uten kurs utelates; minst én gruppe har
 * kurs (behandleren sender aldri en tom e-post).
 */
export function getWeeklyDigestMessage(
  locale: SupportedLocale,
  input: {
    moodLine: string;
    overdue: WeeklyDigestMessageCourse[];
    dueSoon: WeeklyDigestMessageCourse[];
    inProgress: WeeklyDigestMessageCourse[];
    notStarted: WeeklyDigestMessageCourse[];
  },
): { subject: string; paragraphs: string[]; reason: string } {
  const t = weeklyDigestMessages[locale];
  const groups: Array<[string, WeeklyDigestMessageCourse[], { due: boolean; steps: boolean }]> = [
    [t.overdue, input.overdue, { due: true, steps: true }],
    [t.dueSoon, input.dueSoon, { due: true, steps: true }],
    [t.inProgress, input.inProgress, { due: true, steps: true }],
    [t.notStarted, input.notStarted, { due: true, steps: false }],
  ];
  const sections = groups
    .filter(([, courses]) => courses.length > 0)
    .map(([heading, courses, show]) => {
      const lines = courses.slice(0, WEEKLY_DIGEST_MAX_PER_GROUP).map((course) => {
        const details: string[] = [];
        if (show.due && course.dueAt) details.push(t.due.split("{date}").join(formatOsloDate(course.dueAt, locale)));
        if (show.steps && course.started && course.stepsLeft > 0) {
          details.push(course.stepsLeft === 1 ? t.stepsLeftOne : t.stepsLeftMany.split("{n}").join(String(course.stepsLeft)));
        }
        return `• «${course.title}»${details.length > 0 ? ` – ${details.join(", ")}` : ""}`;
      });
      const hidden = courses.length - WEEKLY_DIGEST_MAX_PER_GROUP;
      if (hidden > 0) lines.push(t.more.split("{n}").join(String(hidden)));
      return `${heading}\n${lines.join("\n")}`;
    });
  if (sections.length === 0) throw new Error("A weekly digest needs at least one course.");
  return {
    subject: t.subject,
    paragraphs: [t.greeting, input.moodLine.trim(), ...sections, t.closing],
    reason: t.reason.split("{toggle}").join(WEEKLY_EMAIL_TOGGLE_NAME[locale]),
  };
}

export function getCourseAssignmentDigestMessage(
  locale: SupportedLocale,
  courses: CourseAssignmentDigestCourse[],
): CourseAssignmentDigestMessage {
  // Behandleren sender aldri en tom liste (PLAN_1142 punkt 4: tom liste gir ingen e-post). Skjer det likevel, er det en feil.
  if (courses.length === 0) throw new Error("A course assignment digest needs at least one course.");
  const t = courseAssignmentDigestMessages[locale];
  const sorted = sortCourseAssignmentDigestCourses(locale, courses);
  const lines = sorted.map((course) => {
    const parts = [`• «${course.title}»`];
    if (course.classNames.length === 1) parts.push(` – ${t.fromClass.split("{class}").join(`«${course.classNames[0]}»`)}`);
    if (course.classNames.length > 1) parts.push(` – ${t.fromClasses.split("{classes}").join(quotedList(course.classNames, t.and))}`);
    if (course.dueAt) parts.push(`, ${t.due.split("{date}").join(formatDateOnly(course.dueAt, locale))}`);
    return parts.join("");
  });
  const one = sorted.length === 1;
  const n = String(sorted.length);
  // Pakkens tekst og resten skilles av ett mellomrom her, så pakken ikke må huske et mellomrom på slutten.
  const intro = `${mascotEmailText("courseAssignedIntro", locale).trim()} ${one ? t.introOne : t.introMany.split("{n}").join(n)}`;
  return {
    subject: one ? t.subjectOne.split("{course}").join(sorted[0]!.title) : t.subjectMany.split("{n}").join(n),
    paragraphs: [t.greeting, intro, lines.join("\n"), one ? t.closingOne : t.closingMany],
  };
}
