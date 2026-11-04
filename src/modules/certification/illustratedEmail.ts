// #934 skive 4b (og #1139, #1141): ÉN felles mal for e-post til deltakerne med seilbåten øverst.
//
// Produkteier 2026-11-01/03 (doc/design/GAMIFISERING_DESIGN.md, #1139, #1141):
//   - bildet øverst, så teksten, og en siste linje om hvorfor du får e-posten;
//   - HTML og ren tekst side om side; bildet er et innebygd vedlegg (CID), aldri hentet fra en adresse — det ville
//     vært en sporingspiksel, og noe Outlook blokkerer;
//   - INGEN lenker (firmapolicy, #688): verken `http`, `www` eller `href`, i HTML eller tekst. Heller ingen sporing
//     av hvem som åpner e-posten (`disableUserEngagementTracking` i `sendViaAcs`);
//   - tabellbasert HTML (testet i Outlook 2026-11-02: bildet vises uten å laste ned bilder).
//
// Denne fila vet ingenting om kurs eller versjoner. Hver e-posttype lager teksten sin (notificationMessages.ts),
// velger scenen sin (`EMAIL_ILLUSTRATIONS`) og kaller `renderIllustratedEmail`, så `deliverIllustratedEmail`
// (participantNotificationService.ts). Kanalene `log` og `webhook` får ren tekst; bare e-post får HTML og bildet.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupportedLocale } from "../../i18n/locale.js";

/** Et ferdig bilde i repoet (`src/assets/email/`), JPEG 600 × 200 under 30 KB, med alt-tekst på alle tre språk. */
export type EmailIllustration = {
  /** Filnavnet i `src/assets/email/`. */
  file: string;
  /** Innholds-id-en HTML-en viser til (`cid:…`). */
  contentId: string;
  alt: Record<SupportedLocale, string>;
};

/** Scenene. #1141 legger til én per e-posttype. */
export const EMAIL_ILLUSTRATIONS = {
  // #934: seilbåten står på bukker i båtverftet og får et nytt strøk maling (utkast A, valgt 2026-11-03).
  courseNewVersion: {
    file: "kurs-ny-versjon.jpg",
    contentId: "kurs-ny-versjon",
    alt: {
      nb: "Båten står på bukker i båtverftet og får et nytt strøk maling",
      nn: "Båten står på bukkar i båtverftet og får eit nytt strøk måling",
      "en-GB": "The boat stands on trestles in the boatyard, getting a fresh coat of paint",
    },
  },
} as const satisfies Record<string, EmailIllustration>;

/** Et innebygd vedlegg, i formen ACS tar imot (`EmailAttachment` med `contentId`). */
export type InlineImageAttachment = {
  name: string;
  contentType: string;
  contentInBase64: string;
  contentId: string;
};

export type IllustratedEmail = {
  subject: string;
  /** Ren tekst: avsnittene og siste linje. Ingen henvisning til bildet. */
  plainText: string;
  html: string;
  attachments: InlineImageAttachment[];
};

export type IllustratedEmailInput = {
  locale: SupportedLocale;
  subject: string;
  /** Avsnittene, som ren tekst. Escapes i HTML-en; linjeskift inne i et avsnitt blir `<br>`. */
  paragraphs: string[];
  /** Siste linje: hvorfor mottakeren får e-posten (#1141). Liten, grå i HTML. */
  reason?: string;
  illustration: EmailIllustration;
};

/** Det lenkesperra ser etter. Samme mønster som enhetstestene for hver e-posttype. */
const LINK_LIKE = /https?:|www\.|href/i;
/**
 * Det e-postklienter gjør til lenker av seg selv, uten `http` eller `www`: e-postadresser og domenenavn (QA-porten
 * 2.132.0). Hvilke endelser en klient kjenner, varierer, så alt med små bokstaver rundt punktumet regnes som et domene
 * (ingen liste over toppdomener). Små bokstaver med vilje: «ASP.NET» og «Node.js» er kursnavn, og da skal e-posten gå.
 */
const AUTOLINKED_EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const AUTOLINKED_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/;

/**
 * Ble avsenderen bedt om å sende noe som ligner en lenke (typisk en tittel som inneholder en adresse)? Da sendes
 * e-posten ikke: firmapolicy er ingen lenker, og en nettadresse i ren tekst blir en lenke i Outlook.
 */
export class EmailContainsLinkError extends Error {
  constructor(where: string) {
    super(`The e-mail would contain something that looks like a link (${where}); not sent (no-links policy).`);
    this.name = "EmailContainsLinkError";
  }
}

const imageCache = new Map<string, string>();

/** Bildet som base64, lest fra repoet én gang. Hele repoet følger med i utrullingen (deploy-app.yml). */
function illustrationBase64(file: string): string {
  const cached = imageCache.get(file);
  if (cached) return cached;
  const bytes = readFileSync(path.resolve(process.cwd(), "src", "assets", "email", file));
  const encoded = bytes.toString("base64");
  imageCache.set(file, encoded);
  return encoded;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphHtml(text: string): string {
  return escapeHtml(text).split("\n").join("<br>");
}

/**
 * Bygger e-posten: bildet øverst (CID), avsnittene, og siste linje. Kaster `EmailContainsLinkError` hvis noe i den
 * ligner en lenke — da er det teksten som er feil, ikke sendingen, og ingenting skal sendes.
 */
export function renderIllustratedEmail(input: IllustratedEmailInput): IllustratedEmail {
  const { illustration } = input;
  const alt = illustration.alt[input.locale];
  const texts = [input.subject, ...input.paragraphs, ...(input.reason ? [input.reason] : [])];
  for (const text of texts) {
    if (LINK_LIKE.test(text) || AUTOLINKED_EMAIL.test(text) || AUTOLINKED_DOMAIN.test(text)) throw new EmailContainsLinkError("text");
  }

  const plainText = [...input.paragraphs, ...(input.reason ? [input.reason] : [])].join("\n\n");

  const body = input.paragraphs
    .map((text) => `<p style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#1f2933;">${paragraphHtml(text)}</p>`)
    .join("\n");
  const reason = input.reason
    ? `<p style="margin:24px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#5f6b7a;">${paragraphHtml(input.reason)}</p>`
    : "";
  const html = [
    "<!DOCTYPE html>",
    `<html lang="${input.locale}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.subject)}</title>`,
    "</head>",
    '<body style="margin:0;padding:0;background-color:#f4f1ea;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f1ea;">',
    '<tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;">',
    `<tr><td style="padding:0;"><img src="cid:${illustration.contentId}" width="600" height="200" alt="${escapeHtml(alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>`,
    `<tr><td style="padding:24px 24px 28px 24px;">\n${body}\n${reason}\n</td></tr>`,
    "</table>",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");

  if (LINK_LIKE.test(html)) throw new EmailContainsLinkError("html");
  if (LINK_LIKE.test(plainText)) throw new EmailContainsLinkError("plain text");

  return {
    subject: input.subject,
    plainText,
    html,
    attachments: [
      {
        name: illustration.file,
        contentType: "image/jpeg",
        contentInBase64: illustrationBase64(illustration.file),
        contentId: illustration.contentId,
      },
    ],
  };
}
