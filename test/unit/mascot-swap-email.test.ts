import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readFasit, replaceStrings, sha256 } from "../support/mascotFasit.js";
import { emailSituations, installEmailTestHooks, sendSituation, type EmailHarnessState } from "../support/mascotEmailSituations.js";
import { activeMascot, loadMascotPack, MASCOT_EMAIL_SITUATIONS, mascotImagePath, type MascotPack } from "../../src/modules/mascot/mascotPack.js";
import { buildCourseAssignmentDigestEmail } from "../../src/modules/certification/participantNotificationService.js";

// Maskotpakken, skive 2 (doc/design/MASKOTPAKKE.md): et bytte endrer alle flatene i e-postene, og ingenting annet.
//
// Testpakken (test/fixtures/mascot-swap/mascots/testbat) er valgt i stedet for seilbåten, og de samme e-postene som i
// fasiten sendes gjennom de ekte sendefunksjonene. To ting vises for hver e-post:
//   1. alt som kommer fra pakken, er testpakkens: bildet (vedlegget), bildeteksten og verft-setningen;
//   2. når testpakkens tekster og filnavn byttes tilbake til seilbåtens, er e-posten lik fasiten byte for byte. Alt
//      annet (emne, avsnitt, lenke, HTML rundt) er altså uendret.
// Punkt 1 må med: uten det ville en e-post som overså pakken og brukte seilbåten, også vært lik fasiten.

const h = vi.hoisted((): EmailHarnessState => ({ sent: [], notice: null, user: null }));

vi.mock("../../src/modules/mascot/mascotPack.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/mascot/mascotPack.js")>();
  const { SWAP_ROOT } = await import("../support/mascotFasit.js");
  actual.useMascotPack(actual.loadMascotPack(SWAP_ROOT));
  return actual;
});
vi.mock("@azure/communication-email", () => ({
  EmailClient: class {
    beginSend(message: Record<string, unknown>) {
      h.sent.push(message);
      return Promise.resolve({ pollUntilDone: () => Promise.resolve({ status: "Succeeded" }) });
    }
  },
}));
vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../src/db/prisma.js", () => ({
  prisma: {
    courseVersionNotice: {
      findUnique: vi.fn(async () => h.notice),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    course: { findUnique: vi.fn(async () => ({ title: "Brannvern for alle", publishedAt: new Date("2026-01-01T00:00:00Z"), archivedAt: null, versionMajor: 4 })) },
    user: { findUnique: vi.fn(async () => h.user) },
    courseVersion: { findUnique: vi.fn(async () => ({ changedItemCount: 3 })) },
  },
}));

installEmailTestHooks(h);

const seilbat = loadMascotPack(process.cwd());
const LOCALES = ["nb", "nn", "en-GB"] as const;
const withoutExtension = (file: string) => file.replace(/\.[^.]+$/, "");
/** Verft-setningen slik den står i e-posten: kurset og versjonen fra fasitens e-poster. */
const intro = (pack: MascotPack, locale: (typeof LOCALES)[number]) =>
  pack.emailTexts.courseNewVersionIntro[locale].split("{course}").join("Brannvern for alle").split("{major}").join("4");
const imageFile = (pack: MascotPack, file: string) => {
  const bytes = readFileSync(mascotImagePath(pack, file));
  return { bytes: bytes.length, sha256: sha256(bytes) };
};

type Recorded = Awaited<ReturnType<typeof sendSituation>>[string];

describe("maskotpakken, skive 2: et bytte i e-postene", () => {
  it("testpakken er valgt, og den er en annen enn seilbåten (kontrollcase)", () => {
    const testbat = activeMascot();
    expect(testbat.id).toBe("testbat");
    for (const situation of MASCOT_EMAIL_SITUATIONS) {
      expect(testbat.emails[situation].image).not.toBe(seilbat.emails[situation].image);
      for (const locale of LOCALES) expect(testbat.emails[situation].alt[locale]).not.toBe(seilbat.emails[situation].alt[locale]);
    }
    for (const locale of LOCALES) expect(intro(testbat, locale)).not.toBe(intro(seilbat, locale));
    // #1142: setningen i den samlede e-posten om nye kurs (i fasiten fra skive 3).
    for (const locale of LOCALES) expect(testbat.emailTexts.courseAssignedIntro[locale]).not.toBe(seilbat.emailTexts.courseAssignedIntro[locale]);
  });

  it.each(Object.keys(emailSituations(h)))("%s: bildet, bildeteksten og verft-setningen er testpakkens, resten er fasiten", async (situation) => {
    const testbat = activeMascot();
    const key = situation as (typeof MASCOT_EMAIL_SITUATIONS)[number];
    const actual = await sendSituation(h, situation);

    // 1. Det som kommer fra pakken, er testpakkens.
    const ownImage = imageFile(testbat, testbat.emails[key].image);
    for (const [name, email] of Object.entries(actual)) {
      const locale = name.split(" | ")[1] as (typeof LOCALES)[number];
      expect(email.html, name).toContain(`alt="${testbat.emails[key].alt[locale]}"`);
      expect(email.html, name).toContain(`src="cid:${withoutExtension(testbat.emails[key].image)}"`);
      expect(email.attachments, name).toEqual([
        { name: testbat.emails[key].image, contentType: "image/jpeg", contentId: withoutExtension(testbat.emails[key].image), ...ownImage },
      ]);
      if (key === "courseNewVersion") expect(email.plainText, name).toContain(intro(testbat, locale));
      if (key === "courseAssigned") expect(email.plainText, name).toContain(`${testbat.emailTexts.courseAssignedIntro[locale]} `);
    }

    // 2. Byttet tilbake er e-posten lik fasiten.
    const pairs: Array<[string, string]> = [];
    for (const situationKey of MASCOT_EMAIL_SITUATIONS) {
      pairs.push([withoutExtension(testbat.emails[situationKey].image), withoutExtension(seilbat.emails[situationKey].image)]);
      for (const locale of LOCALES) pairs.push([testbat.emails[situationKey].alt[locale], seilbat.emails[situationKey].alt[locale]]);
    }
    for (const locale of LOCALES) pairs.push([intro(testbat, locale), intro(seilbat, locale)]);
    for (const locale of LOCALES) pairs.push([testbat.emailTexts.courseAssignedIntro[locale], seilbat.emailTexts.courseAssignedIntro[locale]]);
    const seilbatImage = imageFile(seilbat, seilbat.emails[key].image);
    const reversed = Object.fromEntries(
      Object.entries(replaceStrings(actual, pairs)).map(([name, email]: [string, Recorded]) => [
        name,
        { ...email, attachments: email.attachments.map((a: Recorded["attachments"][number]) => ({ ...a, ...seilbatImage })) },
      ]),
    );
    expect(reversed).toEqual(readFasit(`email/${situation}.json`));
  });
});

// #1142: den samlede e-posten om nye kurs, bygget direkte (uten sendefunksjonen): det som kommer fra pakken, er testpakkens.
// Sendt gjennom sendefunksjonen står den i fasiten som `courseAssigned` (skive 3), og testes over.
describe("#1142: e-posten om nye kurs med testpakken", () => {
  it.each(LOCALES)("%s: setningen, bildet og bildeteksten er testpakkens", (locale) => {
    const testbat = activeMascot();
    const email = buildCourseAssignmentDigestEmail({ locale, courses: [{ title: "Brannvern for alle", classNames: ["Avdeling Vest"], dueAt: null }] });
    expect(email.plainText).toContain(`${testbat.emailTexts.courseAssignedIntro[locale]} `);
    expect(email.plainText).not.toContain(seilbat.emailTexts.courseAssignedIntro[locale]);
    expect(email.html).toContain(`alt="${testbat.emails.courseAssigned.alt[locale]}"`);
    expect(email.attachments.map((a) => a.name)).toEqual([testbat.emails.courseAssigned.image]);
  });
});

// Testpakken ligger utenfor mascots/, så den aldri kan velges i drift.
it("testpakken ligger ikke i mascots/", () => {
  expect(path.relative(path.join(process.cwd(), "mascots"), activeMascot().dir).startsWith("..")).toBe(true);
});
