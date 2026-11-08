import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

// #934 skive 4b: e-posten om at et kurs har fått en ny hovedversjon, og den felles malen med bildet (#1139/#1141).
// Produkteier (doc/DESIGN_934.md, «4b»): riktig språk; INGEN lenker (verken `http`, `www` eller `href`, i HTML eller
// ren tekst); bildet er med som innebygd vedlegg (CID) med alt-tekst; den rene teksten nevner ikke bildet.

const sent: Array<Record<string, unknown>> = [];
vi.mock("@azure/communication-email", () => ({
  EmailClient: class {
    beginSend(message: Record<string, unknown>) {
      sent.push(message);
      return Promise.resolve({ pollUntilDone: () => Promise.resolve({ status: "Succeeded" }) });
    }
  },
}));

import { buildCourseMajorVersionEmail, deliverIllustratedEmail, sendViaAcs } from "../../src/modules/certification/participantNotificationService.js";
import { EMAIL_ILLUSTRATIONS, EmailContainsLinkError, renderIllustratedEmail } from "../../src/modules/certification/illustratedEmail.js";
import { countChangedItems } from "../../src/modules/course/courseVersioning.js";
import { env } from "../../src/config/env.js";
import { activeMascot, mascotImagePath } from "../../src/modules/mascot/mascotPack.js";

const LINK = /http|www|href/i;
const LOCALES = ["nb", "nn", "en-GB"] as const;

afterEach(() => {
  sent.length = 0;
  vi.restoreAllMocks();
});

function email(locale: (typeof LOCALES)[number], changedItemCount: number | null = 3) {
  return buildCourseMajorVersionEmail({ locale, courseTitle: "Brannvern", versionMajor: 4, changedItemCount });
}

describe("#934 skive 4b: e-posten om ny hovedversjon", () => {
  it.each(LOCALES)("%s: ingen lenker — verken http, www eller href, i emne, HTML eller ren tekst", (locale) => {
    const e = email(locale);
    expect(e.subject).not.toMatch(LINK);
    expect(e.html).not.toMatch(LINK);
    expect(e.plainText).not.toMatch(LINK);
  });

  it("skrives på mottakerens språk, med kurset, «versjon 4», hvor mange som er endret, og at det gamle beviset gjelder", () => {
    const nb = email("nb");
    expect(nb.subject).toBe("«Brannvern» har fått versjon 4");
    expect(nb.plainText).toContain("versjon 4");
    expect(nb.plainText).toContain("versjon 4. Det er 3 nye eller endrede elementer.");
    expect(nb.plainText).toContain("Kursbeviset du har fra før, gjelder fortsatt for versjonen det ble utstedt for.");
    expect(nb.plainText).toContain("Logg inn på A-2 læringsplattform og åpne kurset under Mine kurs.");

    const nn = email("nn");
    expect(nn.plainText).toContain("Logg inn på A-2 læringsplattform og opne kurset under Mine kurs.");
    expect(nn.plainText).toContain("hovudversjon");
    expect(nn.plainText).toContain("Det er 3 nye eller endra element.");
    expect(nn.plainText).toContain("gjeld framleis");
    expect(nn.plainText).not.toContain("åpne kurset");

    const en = email("en-GB");
    expect(en.subject).toBe("«Brannvern» has a new version: version 4");
    expect(en.plainText).toContain("Log in to A-2 læringsplattform and open the course under My courses.");
    expect(en.plainText).toContain("still applies to the version it was issued for");
    expect(en.plainText).not.toContain("Logg inn");
    expect(en.html).toContain('<html lang="en-GB">');
  });

  it("tallet: ett element i entall, og ingenting om tallet når det mangler (versjon fra før 2.132.0) eller er 0", () => {
    expect(email("nb", 1).plainText).toContain("Det er ett nytt eller endret element.");
    expect(email("en-GB", 1).plainText).toContain("There is one new or changed item.");
    expect(email("en-GB", 3).plainText).toContain("There are 3 new or changed items.");
    for (const n of [null, 0]) {
      const text = email("nb", n).plainText;
      expect(text).not.toMatch(/element/);
      expect(text).toContain("versjon 4.");
    }
  });

  it.each(LOCALES)("%s: bildet er et innebygd vedlegg (CID) med alt-tekst på riktig språk; den rene teksten nevner det ikke", (locale) => {
    const e = email(locale);
    const { contentId, alt } = EMAIL_ILLUSTRATIONS.courseNewVersion;
    expect(e.html).toContain(`src="cid:${contentId}"`);
    expect(e.html).toContain(`alt="${alt[locale]}"`);
    expect(e.attachments).toEqual([
      expect.objectContaining({ name: "kurs-ny-versjon.jpg", contentType: "image/jpeg", contentId }),
    ]);
    expect(e.attachments[0].contentInBase64.length).toBeGreaterThan(1000);
    expect(e.plainText).not.toMatch(/cid:|<img|\.jpg/);
    for (const other of LOCALES) expect(e.plainText).not.toContain(alt[other]);
  });

  it("alt-teksten på bokmål er produkteiers, og de to andre er oversatt", () => {
    const { alt } = EMAIL_ILLUSTRATIONS.courseNewVersion;
    expect(alt.nb).toBe("Båten står på bukker i båtverftet og får et nytt strøk maling");
    expect(alt.nn).not.toBe(alt.nb);
    expect(alt["en-GB"]).toMatch(/boatyard/);
  });

  it("bildet i maskotpakken er en JPEG på 600 × 200 under 30 KB", () => {
    const bytes = readFileSync(mascotImagePath(activeMascot(), EMAIL_ILLUSTRATIONS.courseNewVersion.file));
    expect(bytes.length).toBeLessThan(30 * 1024);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
    // Bredde og høyde står i SOF-segmentet (0xFFC0/0xFFC2).
    let i = 2;
    let size: { width: number; height: number } | null = null;
    while (i < bytes.length - 9) {
      if (bytes[i] !== 0xff) break;
      const marker = bytes[i + 1];
      const length = bytes.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        size = { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
        break;
      }
      i += 2 + length;
    }
    expect(size).toEqual({ width: 600, height: 200 });
  });

  it("en tittel med en adresse hindrer ikke e-posten, og adressen blir ikke en lenke", () => {
    for (const courseTitle of ["Se www.a-2.no", "https://evil.example", "<a href=x>", "Kontakt kurs@a-2.no", "KURS@A-2.NO", "Les mer på portal.a-2.no", "a-2.no/kurs", "portal.example.de", "training.example.co.uk", "docs.example.dev"]) {
      const e = buildCourseMajorVersionEmail({ locale: "nb", courseTitle, versionMajor: 2, changedItemCount: 1 });
      expect(e.html, courseTitle).not.toMatch(/https?:|www\.|<a\s/i);
      expect(e.plainText, courseTitle).not.toMatch(/https?:|www\.|[a-z0-9-]\.(no|example|de|uk|dev)\b/i);
    }
    for (const courseTitle of ["ASP.NET grunnkurs", "Node.js for prosjektledere", "Versjon 2.0 av KI-kurset", "Kurs i HMS. Del 2"]) {
      expect(buildCourseMajorVersionEmail({ locale: "nb", courseTitle, versionMajor: 2, changedItemCount: 1 }).subject, courseTitle).toContain(courseTitle);
    }
  });

  it("malen escaper teksten i HTML-en (en tittel kan ikke legge inn egne elementer)", () => {
    const e = renderIllustratedEmail({
      locale: "nb",
      subject: "S",
      paragraphs: ["<b>fet</b> & \"sitat\""],
      illustration: EMAIL_ILLUSTRATIONS.courseNewVersion,
    });
    expect(e.html).toContain("&lt;b&gt;fet&lt;/b&gt; &amp; &quot;sitat&quot;");
    expect(e.html).not.toContain("<b>fet</b>");
  });
});

describe("#934 skive 4b: den felles sendingen (#1139, #1141 bruker den samme)", () => {
  it("e-post (ACS) får HTML, ren tekst og bildet som innebygd vedlegg — og sporingen av åpning er slått av", async () => {
    const e = email("nb");
    const result = await sendViaAcs({
      recipientEmail: "kari@example.test",
      subject: e.subject,
      body: e.plainText,
      html: e.html,
      attachments: e.attachments,
      logPayload: { notificationType: "test" },
    });
    expect(result.delivered).toBe(true);
    expect(sent).toHaveLength(1);
    const message = sent[0] as { content: { html?: string; plainText: string }; attachments?: unknown[]; disableUserEngagementTracking?: boolean };
    expect(message.content.html).toBe(e.html);
    expect(message.content.plainText).toBe(e.plainText);
    expect(message.attachments).toEqual(e.attachments);
    expect(message.disableUserEngagementTracking).toBe(true);
  });

  it("uten HTML sender ACS ren tekst, som før — ingen vedlegg, sporingsvalget urørt", async () => {
    await sendViaAcs({ recipientEmail: "kari@example.test", subject: "S", body: "B", logPayload: {} });
    const message = sent[0] as { content: Record<string, unknown>; attachments?: unknown; disableUserEngagementTracking?: unknown };
    expect(message.content).toEqual({ subject: "S", plainText: "B" });
    expect(message.attachments).toBeUndefined();
    expect(message.disableUserEngagementTracking).toBeUndefined();
  });

  it("webhook-kanalen får den rene teksten — ingen HTML og intet bilde", async () => {
    const original = { channel: env.PARTICIPANT_NOTIFICATION_CHANNEL, url: env.PARTICIPANT_NOTIFICATION_WEBHOOK_URL };
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      bodies.push(String((init as RequestInit).body));
      return new Response(null, { status: 204 });
    });
    try {
      (env as { PARTICIPANT_NOTIFICATION_CHANNEL: string }).PARTICIPANT_NOTIFICATION_CHANNEL = "webhook";
      (env as { PARTICIPANT_NOTIFICATION_WEBHOOK_URL?: string }).PARTICIPANT_NOTIFICATION_WEBHOOK_URL = "https://hooks.example.test/x";
      const e = email("nb");
      const result = await deliverIllustratedEmail({ recipientEmail: "kari@example.test", email: e, logPayload: { notificationType: "test" } });
      expect(result.delivered).toBe(true);
      expect(bodies).toHaveLength(1);
      const body = JSON.parse(bodies[0]) as Record<string, unknown>;
      expect(body.body).toBe(e.plainText);
      expect(bodies[0]).not.toMatch(/<html|cid:|contentInBase64/);
    } finally {
      (env as { PARTICIPANT_NOTIFICATION_CHANNEL: string }).PARTICIPANT_NOTIFICATION_CHANNEL = original.channel;
      (env as { PARTICIPANT_NOTIFICATION_WEBHOOK_URL?: string }).PARTICIPANT_NOTIFICATION_WEBHOOK_URL = original.url;
    }
    expect(sent).toHaveLength(0);
  });
});

describe("#934 skive 4b: utrullingen", () => {
  it("e-postjobben er AV når innstillingen ikke er satt — ingen hendelse av den nye typen før den slås på", () => {
    expect(process.env.COURSE_MAJOR_EMAIL_ENABLED).toBeUndefined();
    expect(env.COURSE_MAJOR_EMAIL_ENABLED).toBe(false);
  });
});

describe("#934 skive 4b: hvor mange elementer som er nye eller endret (`changedItemCount`)", () => {
  it("seksjoner med ny versjon eller nye i kurset, og moduler som er blitt levende i kurset", () => {
    const before = { a: "a1", b: "b1", gone: "g1" };
    const after = { a: "a1", b: "b2", c: "c1" };
    expect(countChangedItems(before, after, ["m1"], ["m1", "m2"])).toBe(3); // b endret, c ny, m2 ny
    expect(countChangedItems(before, before, ["m1"], ["m1"])).toBe(0);
    // En modul som er tatt ut, eller bare har fått ny versjon, telles ikke (fra 5a-3: moduler med hevet krav).
    expect(countChangedItems({}, {}, ["m1", "m2"], ["m1"])).toBe(0);
  });
});
