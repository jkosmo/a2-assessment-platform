import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// #1029: etter #943 er LESING eierskapsvaktet, og tekstene beskrev fortsatt bare skriving.
//
// ⚠️ HVORFOR DET ER MER ENN ORDKLØVERI. «Skrivebeskyttet» betyr «du kan se, men ikke endre». Det
// var sant før #943. Etterpå kunne den som så merket ikke se heller — merket lovet en tilgang
// systemet ikke lenger gir, og den som klikket seg videre fikk et avslag merket sa ikke ville komme.
//
// En feilmelding som sender brukeren for å lete etter en redigeringsknapp, når problemet er at hen
// ikke får åpne noe i det hele tatt, er en feil diagnose. Det er samme klasse som #996 rettet:
// forståelig setning om feil sak er verre enn en vag setning om riktig sak.
// ─────────────────────────────────────────────────────────────────────────────

const les = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// Ord som lover at lesing går bra. De hører ikke hjemme i en tekst som avviser lesing.
const LOVER_LESETILGANG = [
  "Skrivebeskyttet",
  "Read-only",
  "read-only",
  "only change content you own",
  "bare endre innhold du eier",
  "berre endre innhald du eig",
  "only modify content you own",
];

describe("#1029 — tekstene lover ikke lenger lesetilgang de ikke gir", () => {
  it("eierskapssetningen sier «tilgang», ikke «endre», i alle tre språk", () => {
    const kilde = les("../../public/i18n/participant-translations.js");
    const rader = kilde.split("\n").filter((l) => l.includes('"errors.api.content_ownership"'));

    // ⚠️ Kontrollcase: finner vi ingen rader, måler vakta ingenting og ville stått grønn.
    expect(rader.length, "ventet nøkkelen i tre språktabeller").toBe(3);

    const avvik = rader.filter((r) => LOVER_LESETILGANG.some((ord) => r.includes(ord)));
    expect(
      avvik.join("\n"),
      "Etter #943 avvises også LESING. En setning om at du «bare kan endre» sender brukeren\n" +
        "for å lete etter en redigeringsknapp, når hen ikke får åpne noe i det hele tatt.",
    ).toBe("");
  });

  it("serverens fallback sier det samme", () => {
    // Fallbacken er det en API-konsument uten oversettelsestabell får. Sier den noe annet enn
    // klienttabellen, har vi to sannheter om samme avslag.
    const kilde = les("../../src/modules/content/contentOwnershipService.ts");
    const rad = kilde.split("\n").find((l) => l.includes('"content_ownership"') && l.includes("ForbiddenError"));
    expect(rad, "fant ikke kastet — kontrollcase").toBeTruthy();
    expect(rad).not.toContain("only modify content you own");
    expect(rad, "fallbacken skal beskrive tilgang, ikke endring").toContain("access");
  });

  it("⚠️ merket i kurslista lover ikke lenger at du kan se", () => {
    const kilde = les("../../public/static/admin-content-courses.js");
    const rad = kilde.split("\n").find((l) => l.includes("row-readonly-note"));
    expect(rad, "fant ikke merket — kontrollcase").toBeTruthy();
    expect(rad, "«Skrivebeskyttet» lover en lesetilgang #943 fjernet").not.toContain("Skrivebeskyttet");
    // Og teksten skal komme fra tabellen, ikke stå hardkodet på ett språk i en trespråklig flate.
    expect(rad, "merket skal oversettes").toContain("adminContent.courses.row.noAccess");
  });

  it("merkets nøkler finnes i alle tre språktabeller", () => {
    const kilde = les("../../public/i18n/admin-content-translations.js");
    for (const nøkkel of ["adminContent.courses.row.noAccess", "adminContent.courses.row.noAccessTitle"]) {
      const antall = kilde.split(`"${nøkkel}"`).length - 1;
      expect(antall, `${nøkkel} skal finnes i en-GB, nb og nn`).toBe(3);
    }
  });
});
