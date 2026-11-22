// #1139 skive 1: den ukentlige e-posten, bygget av innholdet (weeklyDigestContent.ts) med den felles malen (illustratedEmail.ts).
//
// Bildet og linja øverst kommer fra SAMME humør i maskotpakken (`moods.<humør>.image`, `.line` og `.alt`, pakkeversjon 3), så
// bilde og setning aldri spriker. Én knapp, «Åpne Mine kurs» (spørsmål 1). Siste linje er avmeldingen (notificationMessages.ts).
import { getWeeklyDigestMessage } from "../../i18n/notificationMessages.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { activeMascot } from "../mascot/mascotPack.js";
import { buildEmailLink } from "../certification/emailLinks.js";
import { renderIllustratedEmail, type EmailIllustration, type IllustratedEmail } from "../certification/illustratedEmail.js";
import type { BoatMood } from "../gamification/boatMood.js";
import type { WeeklyDigestContent } from "./weeklyDigestContent.js";

/** Bildet for humøret, i formen malen tar. Innholds-id-en er filnavnet uten endelse, som for de andre e-postene. */
export function moodIllustration(mood: BoatMood): EmailIllustration {
  const { image, alt } = activeMascot().moods[mood];
  return { file: image, contentId: image.replace(/\.[^.]+$/, ""), alt };
}

export function renderWeeklyDigestEmail(content: WeeklyDigestContent, locale: SupportedLocale): IllustratedEmail {
  const message = getWeeklyDigestMessage(locale, {
    moodLine: activeMascot().moods[content.mood].line[locale],
    overdue: content.overdue,
    dueSoon: content.dueSoon,
    inProgress: content.inProgress,
    notStarted: content.notStarted,
  });
  return renderIllustratedEmail({
    locale,
    subject: message.subject,
    paragraphs: message.paragraphs,
    reason: message.reason,
    illustration: moodIllustration(content.mood),
    link: buildEmailLink(locale, "myCourses", { page: "myCourses" }),
  });
}
