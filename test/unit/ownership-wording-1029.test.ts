import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// #1029: ordlyden om eierskap. Historikken, fordi regelen har snudd to ganger:
//   - #943 vaktet LESING av andres innhold, og tekstene sa fortsatt bare «du kan ikke endre». #1029 ga dem ordet «tilgang».
//   - Produkteier åpnet lesingen igjen: seksjoner 2026-09-08, kurs og moduler i #1165 (2.165.0, «Produsenter bør kunne se
//     hverandres innhold»). En produsent ÅPNER nå andres kurs, moduler og seksjoner skrivebeskyttet; bare eierne kan endre.
//
// Det vakta passer på i dag:
//   - `content_ownership` (403) kommer fortsatt ved skriving, og ved det som forbereder en skriving eller viser
//     personopplysninger (`pending-versions`, `publish-audience`, `/enrollments` …, #1165). Setningen sier «tilgang», som
//     dekker begge, og ikke «du kan bare endre», som ville vært feil der lesingen avvises.
//   - Merket i listene er «Kun for eier» med tittelen «bare eierne kan endre» (#1046, #1165), ikke «Skrivebeskyttet». Ordene
//     under står fortsatt utenfor merket: ett merke for alle fire listene, med ett ord.
// ─────────────────────────────────────────────────────────────────────────────

const les = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// Ord vakta holder utenfor eierskapssetningen og merket (se over).
const LOVER_LESETILGANG = [
  "Skrivebeskyttet",
  "Read-only",
  "read-only",
  "only change content you own",
  "bare endre innhold du eier",
  "berre endre innhald du eig",
  "only modify content you own",
];

describe("#1029 — ordlyden om eierskap sier det avslaget faktisk gjelder", () => {
  it("eierskapssetningen sier «tilgang», ikke «endre», i alle tre språk", () => {
    const kilde = les("../../public/i18n/participant-translations.js");
    const rader = kilde.split("\n").filter((l) => l.includes('"errors.api.content_ownership"'));

    // ⚠️ Kontrollcase: finner vi ingen rader, måler vakta ingenting og ville stått grønn.
    expect(rader.length, "ventet nøkkelen i tre språktabeller").toBe(3);

    const avvik = rader.filter((r) => LOVER_LESETILGANG.some((ord) => r.includes(ord)));
    expect(
      avvik.join("\n"),
      "Avslaget gjelder også lesing som forbereder en skriving eller viser personopplysninger (#1165). En setning om at du\n" +
        "«bare kan endre» sender brukeren for å lete etter en redigeringsknapp der lesingen er avvist.",
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

  it("⚠️ merket i kurslista er «Kun for eier», ikke «Skrivebeskyttet»", () => {
    const kilde = les("../../public/static/admin-content-courses.js");
    const rad = kilde.split("\n").find((l) => l.includes("row-readonly-note"));
    expect(rad, "fant ikke merket — kontrollcase").toBeTruthy();
    expect(rad, "merket er «Kun for eier» (#1046); «Skrivebeskyttet» er et annet ord for samme merke").not.toContain("Skrivebeskyttet");
    // Og teksten skal komme fra tabellen, ikke stå hardkodet på ett språk i en trespråklig flate.
    expect(rad, "merket skal oversettes").toContain("adminContent.courses.row.noAccess");
  });

  // #1046 (produkteier 12.09): «Kurs bruker begrepet Kun for eier, moduler og seksjoner
  // Skrivebeskyttet». Samme merke på alle fire listene, med samme ord som kurslista.
  it("⚠️ merket i modul-, seksjons- og klasselista sier det samme som kurslista", () => {
    for (const fil of ["admin-content-library.js", "admin-content-sections.js", "admin-content-classes.js"]) {
      const kilde = les(`../../public/static/${fil}`);
      const rader = kilde.split("\n").filter((l) => l.includes("row-readonly-note") || l.includes("readonly:"));
      expect(rader.length, `${fil}: fant ikke merket — kontrollcase`).toBeGreaterThan(0);
      for (const rad of rader) {
        for (const ord of LOVER_LESETILGANG) expect(rad, `${fil}: «${ord}» er ikke merkets ord («Kun for eier»)`).not.toContain(ord);
      }
    }
  });

  it("merkets nøkler finnes i alle tre språktabeller", () => {
    const kilde = les("../../public/i18n/admin-content-translations.js");
    for (const nøkkel of ["adminContent.courses.row.noAccess", "adminContent.courses.row.noAccessTitle"]) {
      const antall = kilde.split(`"${nøkkel}"`).length - 1;
      expect(antall, `${nøkkel} skal finnes i en-GB, nb og nn`).toBe(3);
    }
  });
});
