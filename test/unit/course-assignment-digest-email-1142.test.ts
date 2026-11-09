import { afterEach, beforeEach, describe, expect, it } from "vitest";

// #1142 skive 2: den samlede e-posten når en deltaker har fått nye kurs (doc/design/PLAN_1142.md, punkt 5 og 8).
// Bare e-posten: den er ikke koblet til noe som sender før skive 3.
//
// Lenker er godkjent (compliance 2026-11-06), så kravet fra saken om «ingen http, www eller href» er byttet ut med:
// nøyaktig ÉN lenke, til «Mine kurs» uten id (rett til kurset når e-posten nevner bare ett), og ingen annen adresse i HTML eller ren tekst. Uten innstillingen
// PUBLIC_APP_BASE_URL: ingen lenke og ingen href. Kurstitler og klassenavn skrives av forfattere og SMO-er, og en
// adresse der gjøres ufarlig av malen.

import { env } from "../../src/config/env.js";
import { buildCourseAssignmentDigestEmail, type CourseAssignmentDigestCourseInput } from "../../src/modules/certification/participantNotificationService.js";
import { EMAIL_ILLUSTRATIONS } from "../../src/modules/certification/illustratedEmail.js";

const BASE = "https://plattform.example.test";
const MY_COURSES = `${BASE}/participant`;
const LOCALES = ["nb", "nn", "en-GB"] as const;
type Locale = (typeof LOCALES)[number];

const mutableEnv = env as unknown as Record<string, unknown>;
const originalBase = env.PUBLIC_APP_BASE_URL;

beforeEach(() => {
  mutableEnv.PUBLIC_APP_BASE_URL = BASE;
});

afterEach(() => {
  mutableEnv.PUBLIC_APP_BASE_URL = originalBase;
});

const date = (iso: string) => new Date(`${iso}T00:00:00Z`);

// Eksempelet fra planen, i en annen rekkefølge enn den e-posten skal ha.
const THREE: CourseAssignmentDigestCourseInput[] = [
  { courseId: "kurs-1", title: "Personvern i praksis", classNames: ["Nyansatte", "Avdeling Vest"], dueAt: null },
  { courseId: "kurs-2", title: "Etikk i rådgivning", classNames: ["Nyansatte"], dueAt: date("2027-01-15") },
  { courseId: "kurs-3", title: "Brannvern for alle", classNames: ["Avdeling Vest"], dueAt: date("2026-12-01") },
];
const ONE: CourseAssignmentDigestCourseInput[] = [{ courseId: "kurs-4", title: "Brannvern for alle", classNames: ["Avdeling Vest"], dueAt: date("2026-12-01") }];

const build = (locale: Locale, courses: CourseAssignmentDigestCourseInput[] = THREE) => buildCourseAssignmentDigestEmail({ locale, courses });

const LABEL: Record<Locale, string> = { nb: "Åpne Mine kurs", nn: "Opne Mine kurs", "en-GB": "Open My courses" };

describe("#1142 skive 2: lenken", () => {
  it.each(LOCALES)("%s: nøyaktig én lenke, til «Mine kurs» uten id, og ingen annen adresse i HTML eller ren tekst", (locale) => {
    const e = build(locale);
    expect(e.html.match(/<a\s/g)).toHaveLength(1);
    expect(e.html).toContain(`href="${MY_COURSES}"`);
    expect(e.html).toContain(`>${LABEL[locale]}<`);
    expect(new Set(e.html.match(/https?:\/\/[^\s"<]+/g))).toEqual(new Set([MY_COURSES]));
    expect(e.plainText.match(/https?:\/\/\S+/g)).toEqual([MY_COURSES]);
    expect(e.plainText).toContain(`${LABEL[locale]}: ${MY_COURSES}`);
    expect(`${e.html}${e.plainText}`).not.toMatch(/participant\?|courseId|moduleId|threadId|www\./);
    expect(e.subject).not.toMatch(/https?:|www\./);
  });

  // Produkteier 2026-11-09: nevner e-posten bare ett kurs, går knappen rett til kurset. «Mine kurs» bare når det er flere.
  const ONE_COURSE_LABEL: Record<Locale, string> = { nb: "Åpne kurset", nn: "Opne kurset", "en-GB": "Open the course" };
  const ONE_COURSE_CLOSING: Record<Locale, string> = {
    nb: "Logg inn på A-2 læringsplattform og åpne kurset under Mine kurs.",
    nn: "Logg inn på A-2 læringsplattform og opne kurset under Mine kurs.",
    "en-GB": "Log in to A-2 læringsplattform and open the course under My courses.",
  };
  it.each(LOCALES)("%s, ett kurs: nøyaktig én lenke, rett til kurset, og avslutningen sier «kurset»", (locale) => {
    const e = build(locale, ONE);
    const courseUrl = `${BASE}/participant?courseId=kurs-4`;
    expect(e.html.match(/<a\s/g)).toHaveLength(1);
    expect(e.html).toContain(`href="${courseUrl}"`);
    expect(e.html).toContain(`>${ONE_COURSE_LABEL[locale]}<`);
    expect(e.plainText.match(/https?:\/\/\S+/g)).toEqual([courseUrl]);
    expect(e.plainText).toContain(`${ONE_COURSE_CLOSING[locale]}\n\n${ONE_COURSE_LABEL[locale]}: ${courseUrl}`);
    expect(e.plainText).not.toContain(LABEL[locale]);
  });

  it.each(LOCALES)("%s, to kurs: fortsatt «Mine kurs» uten id", (locale) => {
    const e = build(locale, THREE.slice(0, 2));
    expect(e.html).toContain(`href="${MY_COURSES}"`);
    expect(e.plainText).not.toContain("courseId");
    expect(e.plainText).not.toContain(ONE_COURSE_CLOSING[locale]);
  });

  it.each(LOCALES)("%s, ett kurs uten PUBLIC_APP_BASE_URL: ingen lenke, men teksten sier hvor kurset ligger", (locale) => {
    mutableEnv.PUBLIC_APP_BASE_URL = undefined;
    const e = build(locale, ONE);
    expect(`${e.html}${e.plainText}`).not.toMatch(/https?:|<a\s|href=/i);
    expect(e.plainText).toContain(ONE_COURSE_CLOSING[locale]);
  });

  it.each(LOCALES)("%s: uten PUBLIC_APP_BASE_URL går e-posten uten lenke og uten href", (locale) => {
    mutableEnv.PUBLIC_APP_BASE_URL = undefined;
    const e = build(locale);
    expect(`${e.subject}${e.html}${e.plainText}`).not.toMatch(/https?:|www\.|<a\s|href=/i);
    expect(e.plainText).not.toContain(LABEL[locale]);
    // Teksten sier likevel hvor kursene ligger.
    expect(e.plainText).toContain(locale === "en-GB" ? "open My courses." : "Mine kurs.");
  });

  it("en kurstittel eller et klassenavn med en adresse gjøres ufarlig, og vår lenke er fortsatt den eneste", () => {
    const titles = ["Se www.a-2.no", "https://evil.example/logg-inn", "Kontakt kurs@a-2.no", "Les mer på portal.example.de", '<a href="x">klikk</a>'];
    const e = build(
      "nb",
      titles.map((title, i) => ({ courseId: `kurs-url-${i}`, title, classNames: [`Klasse github.com ${i}`, "WWW.EVIL.EXAMPLE"], dueAt: null })),
    );
    expect(e.html.match(/<a\s/g)).toHaveLength(1);
    expect(new Set(e.html.match(/https?:\/\/[^\s"<]+/g))).toEqual(new Set([MY_COURSES]));
    expect(e.plainText.match(/https?:\/\/\S+/g)).toEqual([MY_COURSES]);
    expect(`${e.html}${e.plainText}`).not.toMatch(/www\.|evil\.example|a-2\.no|example\.de|github\.com/i);
    expect(e.plainText).toContain("«Se www[.]a-2[.]no»");
    expect(e.plainText).toContain("fra klassene «Klasse github[.]com 0» og «WWW[.]EVIL[.]EXAMPLE»");
    expect(e.html).toContain("&lt;a href=&quot;x&quot;&gt;klikk&lt;/a&gt;");

    const subject = build("nb", [{ courseId: "kurs-5", title: "Se https://evil.example", classNames: ["K"], dueAt: null }]).subject;
    expect(subject).toBe("Du har fått et nytt kurs: «Se evil[.]example»");
  });
});

describe("#1142 skive 2: teksten", () => {
  it("nb, tre kurs: hele den rene teksten, som i planen", () => {
    const e = build("nb");
    expect(e.subject).toBe("Du har fått 3 nye kurs");
    expect(e.plainText).toBe(
      [
        "Hei!",
        "Fortøyningen er sluppet: du har fått 3 nye kurs på A-2 læringsplattform.",
        [
          "• «Brannvern for alle» – fra klassen «Avdeling Vest», frist 1. desember 2026",
          "• «Etikk i rådgivning» – fra klassen «Nyansatte», frist 15. januar 2027",
          "• «Personvern i praksis» – fra klassene «Avdeling Vest» og «Nyansatte»",
        ].join("\n"),
        "Logg inn på A-2 læringsplattform og åpne Mine kurs.",
        `Åpne Mine kurs: ${MY_COURSES}`,
        "Du får denne e-posten fordi du er med i en klasse på A-2 læringsplattform.",
      ].join("\n\n"),
    );
    // Lista er ett avsnitt, med linjeskift som <br>.
    expect(e.html).toContain("«Avdeling Vest», frist 1. desember 2026<br>• «Etikk i rådgivning»");
  });

  it("nn, tre kurs", () => {
    const e = build("nn");
    expect(e.subject).toBe("Du har fått 3 nye kurs");
    expect(e.plainText).toBe(
      [
        "Hei!",
        "Fortøyinga er sleppt: du har fått 3 nye kurs på A-2 læringsplattform.",
        [
          "• «Brannvern for alle» – frå klassen «Avdeling Vest», frist 1. desember 2026",
          "• «Etikk i rådgivning» – frå klassen «Nyansatte», frist 15. januar 2027",
          "• «Personvern i praksis» – frå klassane «Avdeling Vest» og «Nyansatte»",
        ].join("\n"),
        "Logg inn på A-2 læringsplattform og opne Mine kurs.",
        `Opne Mine kurs: ${MY_COURSES}`,
        "Du får denne e-posten fordi du er med i ein klasse på A-2 læringsplattform.",
      ].join("\n\n"),
    );
    expect(e.html).toContain('<html lang="nn">');
  });

  it("en-GB, tre kurs", () => {
    const e = build("en-GB");
    expect(e.subject).toBe("You have 3 new courses");
    expect(e.plainText).toBe(
      [
        "Hello!",
        "The mooring lines are cast off: you have 3 new courses on A-2 læringsplattform.",
        [
          "• «Brannvern for alle» – from the class «Avdeling Vest», due 1 December 2026",
          "• «Etikk i rådgivning» – from the class «Nyansatte», due 15 January 2027",
          "• «Personvern i praksis» – from the classes «Avdeling Vest» and «Nyansatte»",
        ].join("\n"),
        "Log in to A-2 læringsplattform and open My courses.",
        `Open My courses: ${MY_COURSES}`,
        "You are getting this e-mail because you are in a class on A-2 læringsplattform.",
      ].join("\n\n"),
    );
    expect(e.html).toContain('<html lang="en-GB">');
  });

  it.each([
    ["nb", "Du har fått et nytt kurs: «Brannvern for alle»", "Fortøyningen er sluppet: du har fått et nytt kurs på A-2 læringsplattform."],
    ["nn", "Du har fått eit nytt kurs: «Brannvern for alle»", "Fortøyinga er sleppt: du har fått eit nytt kurs på A-2 læringsplattform."],
    ["en-GB", "You have a new course: «Brannvern for alle»", "The mooring lines are cast off: you have a new course on A-2 læringsplattform."],
  ] as const)("%s, ett kurs: eget emne med tittelen, og innledningen i entall", (locale, subject, intro) => {
    const e = build(locale, ONE);
    expect(e.subject).toBe(subject);
    expect(e.plainText).toContain(intro);
    expect(e.plainText).toContain("• «Brannvern for alle» – ");
  });

  it("to kurs: emnet og innledningen er flertall, også når det bare er to", () => {
    const e = build("nb", THREE.slice(0, 2));
    expect(e.subject).toBe("Du har fått 2 nye kurs");
    expect(e.plainText).toContain("du har fått 2 nye kurs på A-2 læringsplattform.");
  });

  it("med og uten frist: fristen står bare når kurset har en", () => {
    const withDue = build("nb", ONE).plainText;
    expect(withDue).toContain("• «Brannvern for alle» – fra klassen «Avdeling Vest», frist 1. desember 2026\n");
    const withoutDue = build("nb", [{ ...ONE[0]!, dueAt: null }]).plainText;
    expect(withoutDue).toContain("• «Brannvern for alle» – fra klassen «Avdeling Vest»\n");
    expect(withoutDue).not.toContain("frist");
  });

  it("to og tre klasser: alle nevnes, sortert på navn, med «og» før den siste", () => {
    const two = build("nb", [{ courseId: "kurs-6", title: "K", classNames: ["Nyansatte", "Avdeling Vest"], dueAt: null }]).plainText;
    expect(two).toContain("• «K» – fra klassene «Avdeling Vest» og «Nyansatte»");
    const three = build("en-GB", [{ courseId: "kurs-7", title: "K", classNames: ["Sør", "Nord", "Midt"], dueAt: null }]).plainText;
    expect(three).toContain("• «K» – from the classes «Midt», «Nord» and «Sør»");
  });

  it("uten klasse (skal ikke skje) står kurset og fristen likevel", () => {
    expect(build("nb", [{ courseId: "kurs-8", title: "K", classNames: [], dueAt: date("2026-12-01") }]).plainText).toContain("• «K», frist 1. desember 2026\n");
  });

  it("tittelen velges for mottakerens språk", () => {
    const title = JSON.stringify({ nb: "Brannvern for alle", nn: "Brannvern for alle (nn)", "en-GB": "Fire safety for everyone" });
    const courses = [{ courseId: "kurs-sprak", title, classNames: ["Avdeling Vest"], dueAt: null }];
    expect(build("nb", courses).subject).toBe("Du har fått et nytt kurs: «Brannvern for alle»");
    expect(build("nn", courses).subject).toBe("Du har fått eit nytt kurs: «Brannvern for alle (nn)»");
    expect(build("en-GB", courses).subject).toBe("You have a new course: «Fire safety for everyone»");
    expect(build("en-GB", courses).plainText).toContain("• «Fire safety for everyone» – ");
    expect(build("en-GB", courses).plainText).not.toContain("{");
  });

  it("linja om hvorfor er den nye (`classMember`), ikke «klassen din er tildelt et kurs»", () => {
    for (const locale of LOCALES) {
      const text = build(locale).plainText;
      expect(text).not.toMatch(/klassen din er tildelt|your class has been assigned/);
    }
    expect(build("nb").html).toContain("Du får denne e-posten fordi du er med i en klasse på A-2 læringsplattform.");
  });

  it("en tom liste er en feil, ikke en tom e-post", () => {
    expect(() => build("nb", [])).toThrow();
  });
});

describe("#1142 skive 2: rekkefølgen", () => {
  const titlesInOrder = (locale: Locale, courses: CourseAssignmentDigestCourseInput[]) =>
    [...build(locale, courses).plainText.matchAll(/^• «([^»]+)»/gm)].map((m) => m[1]);

  it("tidligste frist først, kurs uten frist sist, og samme frist etter tittel", () => {
    const courses: CourseAssignmentDigestCourseInput[] = [
      { courseId: "kurs-9", title: "Uten frist B", classNames: ["K"], dueAt: null },
      { courseId: "kurs-10", title: "Bølgefysikk", classNames: ["K"], dueAt: date("2026-12-10") },
      { courseId: "kurs-11", title: "Uten frist A", classNames: ["K"], dueAt: null },
      { courseId: "kurs-12", title: "Ankring", classNames: ["K"], dueAt: date("2026-12-10") },
      { courseId: "kurs-13", title: "Zoologi", classNames: ["K"], dueAt: date("2026-11-20") },
      { courseId: "kurs-14", title: "Ytterst", classNames: ["K"], dueAt: date("2027-03-01") },
    ];
    expect(titlesInOrder("nb", courses)).toEqual(["Zoologi", "Ankring", "Bølgefysikk", "Ytterst", "Uten frist A", "Uten frist B"]);
    // Rekkefølgen inn spiller ingen rolle.
    expect(titlesInOrder("nb", [...courses].reverse())).toEqual(titlesInOrder("nb", courses));
  });

  it("titlene sorteres i mottakerens alfabet: Æ kommer etter Z på norsk", () => {
    const courses: CourseAssignmentDigestCourseInput[] = [
      { courseId: "kurs-15", title: "Ærlighet i arbeidslivet", classNames: ["K"], dueAt: null },
      { courseId: "kurs-16", title: "Zoologi", classNames: ["K"], dueAt: null },
    ];
    expect(titlesInOrder("nb", courses)).toEqual(["Zoologi", "Ærlighet i arbeidslivet"]);
    expect(titlesInOrder("nn", courses)).toEqual(["Zoologi", "Ærlighet i arbeidslivet"]);
    expect(titlesInOrder("en-GB", courses)).toEqual(["Ærlighet i arbeidslivet", "Zoologi"]);
  });
});

describe("#1142 skive 2: bildet", () => {
  it.each(LOCALES)("%s: båten som kaster loss, som innebygd vedlegg (CID) med alt-tekst på riktig språk; den rene teksten nevner det ikke", (locale) => {
    const e = build(locale);
    const { contentId, alt, file } = EMAIL_ILLUSTRATIONS.courseAssigned;
    expect(file).toBe("kurs-tildelt.jpg");
    expect(e.html).toContain(`src="cid:${contentId}"`);
    expect(e.html).toContain(`alt="${alt[locale]}"`);
    expect(e.attachments).toEqual([expect.objectContaining({ name: "kurs-tildelt.jpg", contentType: "image/jpeg", contentId })]);
    expect(e.attachments[0]!.contentInBase64.length).toBeGreaterThan(1000);
    expect(e.plainText).not.toMatch(/cid:|<img|\.jpg/);
    for (const other of LOCALES) expect(e.plainText).not.toContain(alt[other]);
  });
});
