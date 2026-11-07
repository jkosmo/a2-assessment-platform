import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

// #1141 og lenkene (compliance 2026-11-06): alle e-poster til personer som bruker plattformen går gjennom den felles malen, med riktig
// bilde, språk, en linje om hvorfor, og en lenke bare når innstillingen er satt. Den eneste adressen i en e-post er vår egen.

const sent: Array<Record<string, any>> = [];
vi.mock("@azure/communication-email", () => ({
  EmailClient: class {
    beginSend(message: Record<string, unknown>) {
      sent.push(message);
      return Promise.resolve({ pollUntilDone: () => Promise.resolve({ status: "Succeeded" }) });
    }
  },
}));
vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { env, parsePublicAppOrigin } from "../../src/config/env.js";
import {
  notifyAssessmentResult,
  notifyAssessmentUnderReview,
  sendAppealStatusNotification,
  sendCourseAssignmentNotification,
  sendCourseMajorVersionNotification,
  sendDiscussionNotification,
} from "../../src/modules/certification/participantNotificationService.js";
import { EMAIL_ILLUSTRATIONS, EmailContainsLinkError, neutralizeAddresses, renderIllustratedEmail } from "../../src/modules/certification/illustratedEmail.js";
import { buildEmailLink } from "../../src/modules/certification/emailLinks.js";
import { defaultSendCourseReminder } from "../../src/modules/course/courseReminderService.js";

// #994: testen av varselet ved oppstart laster env.js på nytt inne i testkroppen.
warmModuleGraph(() => import("../../src/config/env.js"));

const BASE = "https://plattform.example.test";
const mutableEnv = env as unknown as Record<string, unknown>;
const originalChannel = env.PARTICIPANT_NOTIFICATION_CHANNEL;
const originalBase = env.PUBLIC_APP_BASE_URL;
const originalAcs = [env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING, env.ACS_EMAIL_SENDER];

beforeEach(() => {
  sent.length = 0;
  mutableEnv.PARTICIPANT_NOTIFICATION_CHANNEL = "acs_email";
  mutableEnv.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING = "endpoint=https://acs.example.test/;accesskey=dGVzdA==";
  mutableEnv.ACS_EMAIL_SENDER = "avsender@example.test";
  mutableEnv.PUBLIC_APP_BASE_URL = BASE;
});

afterEach(() => {
  mutableEnv.PARTICIPANT_NOTIFICATION_CHANNEL = originalChannel;
  mutableEnv.PUBLIC_APP_BASE_URL = originalBase;
  [mutableEnv.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING, mutableEnv.ACS_EMAIL_SENDER] = originalAcs;
});

const assessment = { submissionId: "s1", submittedAt: new Date("2026-11-06T10:00:00Z"), recipientEmail: "kari@example.test", recipientName: "Kari", moduleTitle: "Brannvern", moduleId: "modul 1", locale: "nb" as const };
const appeal = { appealId: "a1", submissionId: "s1", previousStatus: null, currentStatus: "OPEN" as const, recipientUserId: "u1", recipientEmail: "kari@example.test", recipientName: "Kari", moduleTitle: "Brannvern", moduleId: "m1", locale: "nb" as const };
const discussion = { recipientEmail: "kari@example.test", subject: "Nytt spørsmål", body: "En deltaker stilte et spørsmål.\n\nLogg inn.", locale: "nb" as const, courseId: "c1", threadId: "t1" };

// Hver e-posttype: hvordan den sendes, hvilket bilde, hvilken lenke, og hvorfor mottakeren får den.
const TYPES: Array<{ name: string; send: () => Promise<unknown>; file: string; url: string; label: string; reason: string }> = [
  { name: "bestått", send: () => notifyAssessmentResult({ ...assessment, passFailTotal: true }), file: "vurdering-bestatt.jpg", url: `${BASE}/participant?moduleId=modul%201`, label: "Åpne modulen", reason: "levert en besvarelse" },
  { name: "ikke bestått", send: () => notifyAssessmentResult({ ...assessment, passFailTotal: false }), file: "vurdering-ikke-bestatt.jpg", url: `${BASE}/participant?moduleId=modul%201`, label: "Åpne modulen", reason: "levert en besvarelse" },
  { name: "til sensor", send: () => notifyAssessmentUnderReview(assessment), file: "vurdering-sensor.jpg", url: `${BASE}/participant?moduleId=modul%201`, label: "Åpne modulen", reason: "levert en besvarelse" },
  { name: "anke", send: () => sendAppealStatusNotification(appeal), file: "anke.jpg", url: `${BASE}/participant?moduleId=m1`, label: "Åpne modulen", reason: "anket en vurdering" },
  { name: "tildelt", send: () => sendCourseAssignmentNotification({ recipientEmail: "kari@example.test", courseTitle: "Kurs", className: "Klasse", locale: "nb", courseId: "c1" }), file: "kurs-tildelt.jpg", url: `${BASE}/participant?courseId=c1`, label: "Åpne kurset", reason: "klassen din" },
  { name: "ny hovedversjon", send: () => sendCourseMajorVersionNotification({ noticeId: "n1", courseId: "c1", recipientEmail: "kari@example.test", courseTitle: "Kurs", versionMajor: 2, changedItemCount: 1, locale: "nb" }), file: "kurs-ny-versjon.jpg", url: `${BASE}/participant?courseId=c1`, label: "Åpne kurset", reason: "kursbevis" },
  { name: "nytt spørsmål", send: () => sendDiscussionNotification({ ...discussion, notificationType: "discussion_question_created" }), file: "diskusjon.jpg", url: `${BASE}/participant?courseId=c1&threadId=t1`, label: "Åpne diskusjonen", reason: "eier kurset" },
  { name: "nytt svar", send: () => sendDiscussionNotification({ ...discussion, notificationType: "discussion_reply_created" }), file: "diskusjon.jpg", url: `${BASE}/participant?courseId=c1&threadId=t1`, label: "Åpne diskusjonen", reason: "følger denne diskusjonen" },
];

describe("hver e-posttype går gjennom malen", () => {
  it.each(TYPES)("$name: riktig bilde, lenke og linje om hvorfor, og sporing av", async ({ send, file, url, label, reason }) => {
    await send();
    expect(sent).toHaveLength(1);
    const message = sent[0];
    expect(message.attachments.map((a: { name: string }) => a.name)).toEqual([file]);
    expect(message.disableUserEngagementTracking).toBe(true);
    const html = message.content.html as string;
    const plain = message.content.plainText as string;
    expect(plain).toContain(`${label}: ${url}`);
    expect(plain).toContain(reason);
    expect(html).toContain(`href="${url.replace("&", "&amp;")}"`);
    expect(html).toContain(">" + label + "<");
    // Den eneste adressen i e-posten er vår egen.
    expect(plain.match(/https?:\/\/\S+/g)).toEqual([url]);
    expect(new Set(html.match(/https?:\/\/[^\s"<]+/g))).toEqual(new Set([url.replace("&", "&amp;")]));
    expect(html.match(/<a\s/g)).toHaveLength(1);
  });

  it.each(TYPES)("$name: uten innstillingen går e-posten, uten lenke", async ({ send, file }) => {
    mutableEnv.PUBLIC_APP_BASE_URL = undefined;
    await send();
    expect(sent).toHaveLength(1);
    const message = sent[0];
    expect(message.attachments[0].name).toBe(file);
    expect(`${message.content.html}${message.content.plainText}`).not.toMatch(/https?:|www\.|<a\s|href=/i);
  });

  it("en anke fra køen uten modul-id (lagt inn før lenkene) går uten lenke, ikke med feil", async () => {
    const { moduleId: _ignored, ...old } = appeal;
    const result = await sendAppealStatusNotification(old);
    expect(result.delivered).toBe(true);
    expect(sent[0].content.plainText).not.toContain("http");
  });

  it.each([
    ["due_soon", "frist-snart.jpg"],
    ["overdue", "frist-forfalt.jpg"],
  ] as const)("påminnelse %s: %s, lenke til kurset og linje om hvorfor", async (kind, file) => {
    const result = await defaultSendCourseReminder({ courseId: "c1", userId: "u1", recipientEmail: "kari@example.test", recipientName: "Kari", courseTitle: "Kurs", locale: "nb", kind, dueAt: new Date("2026-11-10T00:00:00Z"), daysBefore: 3 });
    expect(result).toEqual({ delivered: true, channel: "acs_email", failureReason: undefined });
    expect(sent[0].attachments[0].name).toBe(file);
    expect(sent[0].content.plainText).toContain(`Åpne kurset: ${BASE}/participant?courseId=c1`);
    expect(sent[0].content.plainText).toContain("kurs med frist");
  });

  it("alle språk har lenketekst og linje om hvorfor, og teksten følger mottakeren", async () => {
    await notifyAssessmentResult({ ...assessment, passFailTotal: true, locale: "en-GB" });
    await notifyAssessmentResult({ ...assessment, passFailTotal: true, locale: "nn" });
    expect(sent[0].content.plainText).toContain("Open the module: ");
    expect(sent[0].content.plainText).toContain("You are getting this e-mail");
    expect(sent[1].content.plainText).toContain("Opne modulen: ");
    expect(sent[1].content.plainText).toContain("eit svar");
  });
});

describe("adresser i tekst fra forfattere og deltakere", () => {
  it.each([
    ["Hvordan bruke github.com?", "Hvordan bruke github[.]com?"],
    ["Se https://evil.example/logg-inn nå", "Se evil[.]example/logg-inn nå"],
    ["HTTP://EVIL.EXAMPLE", "EVIL[.]EXAMPLE"],
    ["Https://Evil.Example/Logg.Inn", "Evil[.]Example/Logg[.]Inn"],
    ["http://1.2.3.4/logg-inn", "1[.]2[.]3[.]4/logg-inn"],
    ["http://https://EVIL.EXAMPLE", "EVIL[.]EXAMPLE"],
    ["Se HTTP://EVIL.EXAMPLE.", "Se EVIL[.]EXAMPLE."],
    ["Skriv til kari@firma.no", "Skriv til kari@firma[.]no"],
    ["Skriv til KARI@FIRMA.NO", "Skriv til KARI@FIRMA[.]NO"],
    ["www.a-2.no", "www[.]a-2[.]no"],
    ["WWW.A-2.NO", "WWW[.]A-2[.]NO"],
    ["Se www. der", "Se www[.] der"],
    ["training.example.co.uk", "training[.]example[.]co[.]uk"],
    ["xhttp://evil.example", "xevil[.]example"],
    ["_www.A-2.NO", "_www[.]A-2[.]NO"],
  ])("%s", (input, expected) => {
    expect(neutralizeAddresses(input)).toBe(expected);
  });

  it.each(["xhttp://evil.example", "_www.A-2.NO", "http://https://EVIL.EXAMPLE", "Se www. der"])("%s stopper ikke e-posten", (text) => {
    expect(() => renderIllustratedEmail({ locale: "nb", subject: text, paragraphs: [text], illustration: EMAIL_ILLUSTRATIONS.appeal })).not.toThrow();
  });

  it.each(["ASP.NET grunnkurs", "Node.js for prosjektledere", "Versjon 2.0 av KI-kurset", "Kurs i HMS. Del 2", "Dette gjelder f.eks. to kurs", "Bruk href i HTML"])("%s er ikke en adresse", (text) => {
    expect(neutralizeAddresses(text)).toBe(text);
  });

  it("kjent mangel: et domene uten http og www, med stor bokstav, står urørt, siden det ser ut som ASP.NET", () => {
    expect(neutralizeAddresses("Github.com og EVIL.COM")).toBe("Github.com og EVIL.COM");
  });

  it("en tråd om github.com gir e-posten, med adressen ufarlig i emne og tekst, og bare vår lenke", async () => {
    const result = await sendDiscussionNotification({ ...discussion, subject: "Nytt svar i: github.com", body: "Tråden «github.com».", notificationType: "discussion_reply_created" });
    expect(result.delivered).toBe(true);
    expect(sent[0].content.subject).toBe("Nytt svar i: github[.]com");
    expect(sent[0].content.plainText).toContain("«github[.]com»");
    expect(sent[0].content.html.match(/<a\s/g)).toHaveLength(1);
  });

  it("en begrunnelse i en anke med en adresse blir heller ikke en lenke", async () => {
    await sendAppealStatusNotification({ ...appeal, currentStatus: "RESOLVED", passFailTotal: true, resolutionNote: "Se https://evil.example" });
    expect(sent[0].content.plainText).toContain("Se evil[.]example");
    expect(sent[0].content.plainText).not.toContain("https://evil");
  });

  it("siste linje gjøres også ufarlig", () => {
    const e = renderIllustratedEmail({ locale: "nb", subject: "S", paragraphs: ["Tekst"], reason: "Se github.com", illustration: EMAIL_ILLUSTRATIONS.appeal });
    expect(e.plainText).toContain("Se github[.]com");
  });

  it("sikkerhetsnettet: en adresse som slipper forbi, stopper e-posten", () => {
    const illustration = { ...EMAIL_ILLUSTRATIONS.appeal, alt: { ...EMAIL_ILLUSTRATIONS.appeal.alt, nb: "Se https://evil.example" } };
    expect(() => renderIllustratedEmail({ locale: "nb", subject: "S", paragraphs: ["Tekst"], illustration })).toThrow(EmailContainsLinkError);
  });

  it("en tittel kan ikke legge inn egne elementer i HTML-en", async () => {
    const e = renderIllustratedEmail({ locale: "nb", subject: "S", paragraphs: ['<a href="x">klikk</a>'], illustration: EMAIL_ILLUSTRATIONS.appeal, link: { url: `${BASE}/participant`, label: "Åpne" } });
    expect(e.html.match(/<a\s/g)).toHaveLength(1);
    expect(e.html).toContain("&lt;a href=&quot;x&quot;&gt;klikk&lt;/a&gt;");
  });
});

describe("adressen til plattformen", () => {
  it.each([
    ["https://plattform.example.test", "https://plattform.example.test"],
    ["https://plattform.example.test/", "https://plattform.example.test"],
    ["https://plattform.example.test/noe/annet", "https://plattform.example.test"],
    ["http://localhost:3000", "http://localhost:3000"],
  ])("%s gir %s", (value, expected) => {
    expect(parsePublicAppOrigin(value)).toBe(expected);
  });

  it.each(["", "   ", "http://plattform.example.test", "javascript:alert(1)", "ikke en adresse", "ftp://plattform.example.test"])("«%s» gir ingen lenke", (value) => {
    expect(parsePublicAppOrigin(value)).toBeNull();
  });

  it.each([
    ["http://plattform.example.test", true],
    ["https://plattform.example.test", false],
  ])("%s ved oppstart: varsel er %s", async (value, warns) => {
    vi.resetModules();
    vi.stubEnv("PUBLIC_APP_BASE_URL", value);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await import("../../src/config/env.js");
      const warned = warn.mock.calls.some(([text]) => String(text).includes("PUBLIC_APP_BASE_URL"));
      expect(warned).toBe(warns);
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("id-en kodes, så den ikke kan legge til noe i adressen", () => {
    expect(buildEmailLink("nb", "module", { moduleId: "a&b=c" })?.url).toBe(`${BASE}/participant?moduleId=a%26b%3Dc`);
  });

  it("ingen id gir ingen lenke", () => {
    expect(buildEmailLink("nb", "module", null)).toBeNull();
  });
});

describe("neste e-post kan ikke glemme malen", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
    });
  }

  it("bare malen, varselet til administratorer og det siste av «modulen er revidert» kaller sendViaAcs", () => {
    const callers = sourceFiles(path.resolve("src"))
      .filter((file) => /\bsendViaAcs\(/.test(readFileSync(file, "utf8").replace(/export async function sendViaAcs\(/, "")))
      .map((file) => path.basename(file))
      .sort();
    expect(callers).toEqual(["failedAssessmentAlert.ts", "participantNotificationService.ts"]);

    const service = readFileSync(path.resolve("src/modules/certification/participantNotificationService.ts"), "utf8").replace(/export async function sendViaAcs\(/, "");
    // Ett kall i malen, ett i «modulen er revidert».
    expect(service.match(/\bsendViaAcs\(/g)).toHaveLength(2);
  });

  it("alle bildene finnes, er JPEG, og er under 30 KB", () => {
    for (const { file } of Object.values(EMAIL_ILLUSTRATIONS)) {
      const bytes = readFileSync(path.resolve("src/assets/email", file));
      expect(bytes.length, file).toBeLessThan(30 * 1024);
      expect(bytes[0], file).toBe(0xff);
      expect(bytes[1], file).toBe(0xd8);
    }
  });

  it("alle scenene har alt-tekst på tre språk", () => {
    for (const { file, alt } of Object.values(EMAIL_ILLUSTRATIONS)) {
      for (const locale of ["nb", "nn", "en-GB"] as const) expect(alt[locale].trim(), `${file} ${locale}`).not.toBe("");
    }
  });
});
