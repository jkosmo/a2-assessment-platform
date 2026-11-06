// Lenkene i e-post (compliance 2026-11-06). Adressen kommer fra innstillingen PUBLIC_APP_BASE_URL, som må stå på både
// appen og workeren, for begge sender e-post. Uten innstilling, eller med en ugyldig verdi: ingen lenke, og e-posten går
// uten. Det gjør innstillingen til bryteren som slår lenkene på, og lar #1143 bytte adresse uten kodeendring.
//
// Lenken inneholder bare en id, aldri innlogging. En videresendt lenke gir ikke tilgang til noe.
import { env, parsePublicAppOrigin } from "../../config/env.js";
import { getEmailLinkLabel, type EmailLinkKind } from "../../i18n/notificationMessages.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import type { EmailLink } from "./illustratedEmail.js";

export type EmailLinkTarget = { courseId: string } | { moduleId: string } | { courseId: string; threadId: string };

function targetQuery(target: EmailLinkTarget): string {
  if ("moduleId" in target) return `moduleId=${encodeURIComponent(target.moduleId)}`;
  if ("threadId" in target) return `courseId=${encodeURIComponent(target.courseId)}&threadId=${encodeURIComponent(target.threadId)}`;
  return `courseId=${encodeURIComponent(target.courseId)}`;
}

/** Lenken til malen, eller null når lenker ikke er slått på eller id-en mangler (en rad i køen fra før lenkene). */
export function buildEmailLink(locale: SupportedLocale, kind: EmailLinkKind, target: EmailLinkTarget | null): EmailLink | null {
  const origin = parsePublicAppOrigin(env.PUBLIC_APP_BASE_URL);
  if (!origin || !target) return null;
  return { url: `${origin}/participant?${targetQuery(target)}`, label: getEmailLinkLabel(locale, kind) };
}
