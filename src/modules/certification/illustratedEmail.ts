// #934 skive 4b, #1141 og lenkene: ÉN felles mal for e-post med seilbåten øverst.
//
// Produkteier 2026-11-01/03 (doc/design/GAMIFISERING_DESIGN.md, #1139, #1141), og compliance 2026-11-06 (lenker godkjent):
//   - bildet øverst, så teksten, lenken og en siste linje om hvorfor du får e-posten;
//   - HTML og ren tekst side om side; bildet er et innebygd vedlegg (CID), aldri hentet fra en adresse — det ville
//     vært en sporingspiksel, og noe Outlook blokkerer;
//   - den ENESTE adressen i en e-post er vår egen lenke. Malen lager den selv av `link`. Adresser i titler og annen
//     tekst fra forfattere og deltakere gjøres ufarlige (`neutralizeAddresses`), og e-posten går. Ingen sporing av hvem
//     som åpner e-posten (`disableUserEngagementTracking` i `sendViaAcs`);
//   - tabellbasert HTML (testet i Outlook 2026-11-02: bildet vises uten å laste ned bilder).
//
// Denne fila vet ingenting om kurs eller versjoner. Hver e-posttype lager teksten sin (notificationMessages.ts),
// velger scenen sin (`EMAIL_ILLUSTRATIONS`) og kaller `renderIllustratedEmail`, så `deliverIllustratedEmail`
// (participantNotificationService.ts). Kanalene `log` og `webhook` får ren tekst; bare e-post får HTML og bildet.
//
// Bildene og bildetekstene kommer fra maskotpakken (mascots/<valgt>/mascot.json, doc/design/MASKOTPAKKE.md). Både web
// og worker lager e-post, og begge har samme pakke. En e-post i køen lages ved sending, med pakken som gjelder da.
import { readFileSync } from "node:fs";
import type { SupportedLocale } from "../../i18n/locale.js";
import { activeMascot, mascotImagePath, MASCOT_EMAIL_SITUATIONS, type MascotEmailSituation } from "../mascot/mascotPack.js";
import { LINK_LIKE } from "./linkLike.js";

/** Et bilde i maskotpakken (`images/`), JPEG 600 × 200 under 30 KB, med alt-tekst på alle tre språk. */
export type EmailIllustration = {
  /** Filnavnet i pakkens `images/`; også navnet på vedlegget. */
  file: string;
  /** Innholds-id-en HTML-en viser til (`cid:…`): filnavnet uten endelsen. */
  contentId: string;
  alt: Record<SupportedLocale, string>;
};

/** Scenene, valgt av produkteier i #1141, én per situasjon. Bildet og bildeteksten står i maskotpakken. */
export const EMAIL_ILLUSTRATIONS: Record<MascotEmailSituation, EmailIllustration> = Object.fromEntries(
  MASCOT_EMAIL_SITUATIONS.map((situation) => {
    const { image, alt } = activeMascot().emails[situation];
    return [situation, { file: image, contentId: image.replace(/\.[^.]+$/, ""), alt }];
  }),
) as Record<MascotEmailSituation, EmailIllustration>;

/** Et innebygd vedlegg, i formen ACS tar imot (`EmailAttachment` med `contentId`). */
export type InlineImageAttachment = {
  name: string;
  contentType: string;
  contentInBase64: string;
  contentId: string;
};

export type IllustratedEmail = {
  subject: string;
  /** Ren tekst: avsnittene, lenken og siste linje. Ingen henvisning til bildet. */
  plainText: string;
  html: string;
  attachments: InlineImageAttachment[];
};

/** Vår egen lenke, ferdig bygget av `emailLinks.ts`. Bare malen setter den inn. */
export type EmailLink = { url: string; label: string };

export type IllustratedEmailInput = {
  locale: SupportedLocale;
  subject: string;
  /** Avsnittene, som ren tekst. Escapes i HTML-en; linjeskift inne i et avsnitt blir `<br>`. */
  paragraphs: string[];
  /** Siste linje: hvorfor mottakeren får e-posten (#1141). Liten, grå i HTML. */
  reason?: string;
  illustration: EmailIllustration;
  /** Null: lenker er ikke slått på, eller raden i køen er eldre enn lenkene. E-posten går da uten. */
  link?: EmailLink | null;
};

// Det som ikke kan være igjen etter `neutralizeAddresses` (`LINK_LIKE`, linkLike.ts). Sjekkes før vår egen lenke settes inn.
const ANCHOR_ELEMENT = /<a\s/i;

// Uten ordgrense, så de fanger alt LINK_LIKE fanger: «xhttp://…» skal gjøres ufarlig, ikke stoppe e-posten.
const URL_SCHEME = /https?:\/*/gi;
const WWW_PREFIX = /www\./gi;
/** Står det `http` eller `www` foran, er resten en adresse uansett store og små bokstaver. Må tas før skjemadelen fjernes. */
const EXPLICIT_ADDRESS = /(?:https?:\/*|www\.)\S*/gi;
/** Bare punktum inne i adressen: punktumet som avslutter en setning, skal stå. */
const DOT_INSIDE_ADDRESS = /\.(?=[\p{L}\p{N}-])/gu;
/**
 * Det e-postklienter gjør til lenker av seg selv, uten `http` eller `www`: e-postadresser og domenenavn (QA-porten
 * 2.132.0). Hvilke endelser en klient kjenner, varierer, så alt med små bokstaver rundt punktumet regnes som et domene
 * (ingen liste over toppdomener). Små bokstaver med vilje: «ASP.NET» og «Node.js» er kursnavn. «f.eks» står i ankebegrunnelser.
 */
const EMAIL_ADDRESS = /[^\s@]+@[^\s@]+\.[a-z]{2,}/gi;
const DOMAIN_NAME = /(?<!\[)\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/g;
const NOT_A_DOMAIN = new Set(["f.eks"]);

/**
 * Gjør adresser i tekst ufarlige: `github[.]com`, `kari@firma[.]no`. Titler og begrunnelser skrives av forfattere og
 * deltakere, og en adresse der ville blitt en lenke i Outlook. E-posten skal fortsatt gå: et spørsmål om «github.com»
 * er ikke en grunn til at eieren ikke får vite om det.
 */
export function neutralizeAddresses(text: string): string {
  return text
    .replace(EXPLICIT_ADDRESS, (address) => address.replace(DOT_INSIDE_ADDRESS, "[.]"))
    .replace(URL_SCHEME, "")
    .replace(EMAIL_ADDRESS, (address) => {
      const at = address.lastIndexOf("@");
      return `${address.slice(0, at + 1)}${address.slice(at + 1).split(".").join("[.]")}`;
    })
    .replace(WWW_PREFIX, (prefix) => `${prefix.slice(0, -1)}[.]`)
    .replace(DOMAIN_NAME, (name) => (NOT_A_DOMAIN.has(name) ? name : name.split(".").join("[.]")));
}

/** Skal ikke kunne skje: teksten er allerede gjort ufarlig. Finnes så en feil i malen stopper e-posten i stedet for å sende en fremmed adresse. */
export class EmailContainsLinkError extends Error {
  constructor(where: string) {
    super(`The e-mail would contain an address that is not ours (${where}); not sent.`);
    this.name = "EmailContainsLinkError";
  }
}

const imageCache = new Map<string, string>();

/** Bildet som base64, lest fra pakken én gang. Hele repoet, også mascots/, følger med i utrullingen (deploy-app.yml). */
function illustrationBase64(file: string): string {
  const cached = imageCache.get(file);
  if (cached) return cached;
  const bytes = readFileSync(mascotImagePath(activeMascot(), file));
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

const FONT = "font-family:Arial,Helvetica,sans-serif;";

/**
 * Knapp som tabell, så Outlook tegner den. Adressen står også synlig, så mottakeren kan se hvor den går.
 *
 * ⚠️ Luften rundt teksten står på CELLEN, ikke på lenken. Outlook for Windows ser bort fra `padding` på `<a>`, og
 * knappen ble da bare så stor som bokstavene (produkteier 2026-11-09, skjermbilde fra prod).
 */
function linkHtml(link: EmailLink): string {
  const url = escapeHtml(link.url);
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px 0;">',
    `<tr><td bgcolor="#1f4e79" style="background-color:#1f4e79;border-radius:4px;padding:12px 20px;"><a href="${url}" style="display:inline-block;${FONT}font-size:16px;font-weight:bold;line-height:20px;color:#ffffff;text-decoration:none;">${escapeHtml(link.label)}</a></td></tr>`,
    "</table>",
    `<p style="margin:0 0 8px 0;${FONT}font-size:13px;line-height:20px;color:#5f6b7a;word-break:break-all;">${url}</p>`,
  ].join("\n");
}

/** Bygger e-posten: bildet øverst (CID), avsnittene, lenken og siste linje. */
export function renderIllustratedEmail(input: IllustratedEmailInput): IllustratedEmail {
  const { illustration, link } = input;
  const alt = illustration.alt[input.locale];
  const subject = neutralizeAddresses(input.subject);
  const paragraphs = input.paragraphs.map(neutralizeAddresses);
  const reasonText = input.reason ? neutralizeAddresses(input.reason) : undefined;

  const body = paragraphs
    .map((text) => `<p style="margin:0 0 16px 0;${FONT}font-size:16px;line-height:24px;color:#1f2933;">${paragraphHtml(text)}</p>`)
    .join("\n");
  const reason = reasonText
    ? `<p style="margin:24px 0 0 0;${FONT}font-size:13px;line-height:20px;color:#5f6b7a;">${paragraphHtml(reasonText)}</p>`
    : "";
  const page = (cta: string) =>
    [
      "<!DOCTYPE html>",
      `<html lang="${input.locale}">`,
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(subject)}</title>`,
      "</head>",
      '<body style="margin:0;padding:0;background-color:#f4f1ea;">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f1ea;">',
      '<tr><td align="center" style="padding:24px 12px;">',
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;">',
      `<tr><td style="padding:0;"><img src="cid:${illustration.contentId}" width="600" height="200" alt="${escapeHtml(alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>`,
      `<tr><td style="padding:24px 24px 28px 24px;">\n${body}\n${cta}\n${reason}\n</td></tr>`,
      "</table>",
      "</td></tr>",
      "</table>",
      "</body>",
      "</html>",
    ].join("\n");

  // Kontrollen står FØR lenken settes inn: alt annet i e-posten skal være fritt for adresser.
  // Den rene teksten er de samme avsnittene, så den trenger ingen egen kontroll.
  const withoutLink = page("");
  if (LINK_LIKE.test(withoutLink) || ANCHOR_ELEMENT.test(withoutLink)) throw new EmailContainsLinkError("html");

  const plainText = [...paragraphs, ...(link ? [`${link.label}: ${link.url}`] : []), ...(reasonText ? [reasonText] : [])].join("\n\n");

  return {
    subject,
    plainText,
    html: link ? page(linkHtml(link)) : withoutLink,
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
