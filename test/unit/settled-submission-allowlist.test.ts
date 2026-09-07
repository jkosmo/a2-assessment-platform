import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SubmissionStatus } from "../../src/db/prismaRuntime.js";
import {
  SETTLED_SUBMISSION_STATUSES,
  isSettledSubmission,
} from "../../src/modules/submission/submissionOutcome.js";
import { getSubmissionStatusExplanation } from "../../src/modules/submission/submissionReadModels.js";

// ─────────────────────────────────────────────────────────────────────────────
// #951: et forlatt forsøk er ikke et utfall — og spørsmålet må stilles med en HVITELISTE.
//
// ⚠️ MÅLT PROBLEM. 12 erstattede innleveringer på stage sto som `COMPLETED` med et gammelt
// AUTOMATISK vedtak. Alle tolv sa «ikke bestått», så tallene var ikke synlig gale ennå — men
// mekanismen var på plass: sa det gamle vedtaket «bestått», ville rapporten talt forsøket som
// bestått mens `CertificationStatus` aldri ble skrevet. To kilder, to svar, samme deltaker.
//
// ⚠️ HVORFOR IKKE BARE SKRIVE VEDTAKET, SOM SAKEN FORESLO. Fordi det ville gitt kursbevis for et
// forsøk sensoren aldri fikk se, og latt en deltaker unngå vurderingen ved å levere på nytt. At
// sertifiseringen manglet var tilfeldigvis den trygge oppførselen. Feilen lå på LESESIDEN.
// ─────────────────────────────────────────────────────────────────────────────

describe("#951 — hvilke innleveringer er avgjort", () => {
  it("⚠️ SUPERSEDED er IKKE avgjort", () => {
    // Selve saken. Et forlatt forsøk bærer fortsatt sitt gamle automatiske vedtak, så den som
    // spør «finnes det et vedtak?» får ja. Derfor må statusen spørres om.
    expect(isSettledSubmission(SubmissionStatus.SUPERSEDED)).toBe(false);
  });

  it("⚠️ men COMPLETED og REJECTED ER avgjort — kontrollcase", () => {
    // Blokkeringens makker. Uten denne kunne `isSettledSubmission` returnert `false` for ALT, og
    // testen over ville sett like grønn ut mens hver bestått-rate ble tom.
    expect(isSettledSubmission(SubmissionStatus.COMPLETED)).toBe(true);
    expect(isSettledSubmission(SubmissionStatus.REJECTED)).toBe(true);
  });

  it("de ikke-avgjorte statusene er ikke avgjort", () => {
    for (const status of [
      SubmissionStatus.SUBMITTED,
      SubmissionStatus.PROCESSING,
      SubmissionStatus.SCORED,
      SubmissionStatus.UNDER_REVIEW,
    ]) {
      expect(isSettledSubmission(status), `${status} skal ikke telle som avgjort`).toBe(false);
    }
  });

  it("null og undefined er ikke avgjort", () => {
    expect(isSettledSubmission(null)).toBe(false);
    expect(isSettledSubmission(undefined)).toBe(false);
  });

  it("⚠️ hvert medlem av hvitelista er en bevisst avgjørelse, ikke et arvet flertall", () => {
    // Hvitelista skal være KORT. Vokser den, er det fordi noen har tatt stilling — ikke fordi en
    // ny status gled inn. Denne testen tvinger den avgjørelsen fram i en diff.
    expect([...SETTLED_SUBMISSION_STATUSES].sort()).toEqual(["COMPLETED", "REJECTED"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VAKT: samme regel på N steder, håndhevet på N−1. Feilklassen har truffet oss sju ganger.
//
// Denne saken fant fem svartelister på serveren — tre i `mcqSemanticReport`, to i
// `completionReport` — som alle spurte «er den IKKE under vurdering?». Klienten hadde allerede
// snudd sin til en hviteliste etter at QA-porten fant den samme feilen i `outcome.js`.
//
// Vakta måler at serveren ikke faller tilbake. En svarteliste her betyr at neste status blir
// «avgjort» som standard, uten at noen tok stilling til det.
// ─────────────────────────────────────────────────────────────────────────────

const les = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("#951 — rapportene spør ikke lenger med en svarteliste", () => {
  const KATALOG = new URL("../../src/modules/reporting/", import.meta.url);

  it("ingen rapport avgjør «avgjort» ved å utelukke UNDER_REVIEW", () => {
    const filer = readdirSync(KATALOG).filter((f) => f.endsWith(".ts"));
    // ⚠️ Kontrollcase: finner vi ingen filer, måler vakta ingenting og ville stått grønn.
    expect(filer.length, "fant ingen rapportfiler — vakta målte ingenting").toBeGreaterThan(0);

    const avvik: string[] = [];
    for (const fil of filer) {
      const linjer = les(`../../src/modules/reporting/${fil}`).split("\n");
      linjer.forEach((linje, i) => {
        if (linje.trim().startsWith("//")) return;
        if (/!==\s*SubmissionStatus\.UNDER_REVIEW/.test(linje)) {
          avvik.push(`${fil}:${i + 1} ${linje.trim()}`);
        }
      });
    }

    expect(
      avvik.join("\n"),
      "En svarteliste gjør enhver NY status avgjort som standard.\n" +
        "Bruk `isSettledSubmission(status)` fra modules/submission/submissionOutcome.ts, som er en\n" +
        "hviteliste: det som ikke står der, teller ikke som et utfall før noen skriver det inn.",
    ).toBe("");
  });

  it("⚠️ klientens hviteliste og serverens sier det samme", () => {
    // To lister for samme begrep glir fra hverandre. Klienten kan ikke importere serverens
    // TypeScript, så kopien er bevisst — da må den holdes i takt. Er de uenige, viser deltakerens
    // egen skjerm ett utfall mens rapporten teller et annet.
    const klient = les("../../public/static/outcome.js");
    const rad = klient.split("\n").find((l) => l.includes("SETTLED_STATUSES = new Set("));
    expect(rad, "fant ikke SETTLED_STATUSES i outcome.js — kontrollcase").toBeTruthy();

    const klientens = (rad?.match(/"([A-Z_]+)"/g) ?? []).map((s) => s.replaceAll('"', "")).sort();
    expect(
      klientens,
      "outcome.js og submissionOutcome.ts er uenige om hva som er et endelig utfall.",
    ).toEqual([...SETTLED_SUBMISSION_STATUSES].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #951: hva deltakeren får VITE når forsøket ble erstattet.
//
// ⚠️ DEN FARLIGE FEILEN ER TAUSHET SOM SER RIKTIG UT. Uten en egen gren falt SUPERSEDED gjennom
// til «Assessment is still processing» — deltakeren ville ventet på et vedtak som aldri kommer,
// og ingenting på skjermen ville avslørt det.
// ─────────────────────────────────────────────────────────────────────────────

describe("#951 — forklaringen deltakeren leser", () => {
  it("⚠️ et erstattet forsøk sier at det ble erstattet, ikke at det behandles", () => {
    const tekst = getSubmissionStatusExplanation("SUPERSEDED");
    expect(tekst).toContain("replaced");
    expect(tekst, "å love behandling for noe som aldri får et vedtak er den verste varianten").not.toContain(
      "still processing",
    );
  });

  it("de andre statusene er urørt — kontrollcase", () => {
    // Uten denne kunne grenen ha svart det samme for ALT, og testen over ville sett lik ut.
    expect(getSubmissionStatusExplanation("COMPLETED")).toContain("Final decision");
    expect(getSubmissionStatusExplanation("UNDER_REVIEW")).toContain("manual review");
    expect(getSubmissionStatusExplanation("PROCESSING")).toContain("still processing");
  });
});
