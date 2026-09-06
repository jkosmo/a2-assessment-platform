import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEVEL_COMPLEXITY, LEVEL_SCOPE } from "../../src/modules/adminContent/llmContentGenerationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// VAKT (#1049): grensene per nivå finnes FLERE steder, og de skal si det samme.
//
// `LEVEL_COMPLEXITY` og `LEVEL_SCOPE` er kilden. Én kopi kan ikke fjernes:
// `scripts/run-generation-benchmark.mjs` er et frittstående skript og må bære tallene selv.
//
// ⚠️ DA DENNE SAKEN STARTET STO TALLENE TO STEDER. Undersøkelsen fant et tredje, produkteier minnet
// om et fjerde, og det fjerde viste seg å være en hel forfatterVEI fra førsteversjonen — en knapp
// som kopierte en prompt med hele tabellen. Den er nå fjernet, og kopien forsvant med den.
//
// Det er den beste utgangen for en kopi: ikke en vakt som holder den i sjakk, men at den ikke
// finnes. Vakta står igjen for de kopiene vi faktisk må leve med.
// ─────────────────────────────────────────────────────────────────────────────

const les = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const NIVÅER = ["basic", "intermediate", "advanced"] as const;

describe("#1049 — kopiene av nivågrensene er enige med kilden", () => {
  it("kilden har alle tre nivåene — kontrollcase", () => {
    // ⚠️ Uten denne er hele vakta grønn hvis en import gir tomt objekt: «ingen nivåer å sjekke» og
    // «alle nivåer stemmer» ser identiske ut nedenfra.
    for (const nivå of NIVÅER) {
      expect(LEVEL_SCOPE[nivå]?.minWords, `${nivå} skal ha minWords`).toBeGreaterThan(0);
      expect(LEVEL_COMPLEXITY[nivå]?.conceptsMax, `${nivå} skal ha conceptsMax`).toBeGreaterThan(0);
    }
  });

  // ⚠️ HER STO EN PÅSTAND OM `public/static/admin-content-external-llm.js`.
  //
  // Den fila hadde en femte kopi av tabellen: prompten forfatteren kopierte og limte inn i en
  // ekstern modell. Hele den veien er fjernet 2026-09-06 — bruk av ekstern LLM skjer gjennom
  // Skill-en, og to måter å gjøre det samme på er én for mange (produkteier).
  //
  // Kopien forsvant med den. Det er den beste utgangen for en kopi: ikke en vakt som holder den i
  // sjakk, men at den ikke finnes.

  it("SKILL-en viser de samme tallene", () => {
    // ⚠️ Produkteier 2026-09-06: «Skillen trenger å kjenne både nivå og omfang, begge deler er
    // viktige dimensjoner når man designer både opplæringsmateriell og testmateriell.»
    //
    // Skill-en pakkes som en zip og distribueres til flere modeller. Den kan ikke importere fra
    // serveren, så tallene MÅ stå der — og da må de holdes i takt. En Skill som er ute av takt er
    // verre enn de andre kopiene: den kjører hos noen andre, og vi ser ikke hva den produserer
    // før en JSON kommer tilbake.
    const kilde = les("../../skills/a2-authoring-api/SKILL.md");
    const avvik: string[] = [];

    for (const nivå of NIVÅER) {
      const rader = kilde.split("\n").filter((l) => l.trim().startsWith(`| ${nivå}`));
      if (rader.length < 2) {
        avvik.push(`${nivå}: ventet både en kompleksitets- og en omfangsrad, fant ${rader.length}`);
        continue;
      }
      const tall = rader.flatMap((r) => (r.match(/\d+/g) ?? []).map(Number));
      for (const [navn, verdi] of [
        ["actorsMax", LEVEL_COMPLEXITY[nivå].actorsMax],
        ["conceptsMax", LEVEL_COMPLEXITY[nivå].conceptsMax],
        ["tradeoffsMax", LEVEL_COMPLEXITY[nivå].tradeoffsMax],
        ["minWords", LEVEL_SCOPE[nivå].minWords],
        ["maxWords", LEVEL_SCOPE[nivå].maxWords],
      ] as const) {
        if (!tall.includes(verdi)) avvik.push(`${nivå}.${navn}=${verdi} står ikke i SKILL.md`);
      }
    }

    expect(
      avvik.join("\n"),
      "SKILL.md og plattformens grenser er uenige.\n" +
        "Skill-en kjører hos en ekstern modell og produserer innhold vi importerer — er tallene\n" +
        "ute av takt, får vi kurs bygget mot grenser vi ikke har.\n" +
        "Husk `npm run skill:package` og redeploy etter endring.",
    ).toBe("");
  });

  it("klientens standardtabell viser de samme tallene", () => {
    // ⚠️ #1049: forfatterflaten trenger tallet for å vise hva som gjelder når omfangsfeltet står
    // tomt — plassholderen er nivåets standard. Klienten kan ikke importere serverens TypeScript,
    // så kopien er bevisst. Da må den holdes i takt, ellers lover Innstillinger noe annet enn det
    // genereringen faktisk bruker, og forfatteren ser ett tall mens modellen får et annet.
    const kilde = les("../../public/static/admin-content-shell.js");
    const avvik: string[] = [];

    for (const nivå of NIVÅER) {
      const rad = kilde.split("\n").find((l) => l.trim().startsWith(`${nivå}: { minWords:`));
      if (!rad) {
        avvik.push(`${nivå}: fant ingen rad i LEVEL_SCOPE_DEFAULTS`);
        continue;
      }
      const tall = (rad.match(/[0-9]+/g) ?? []).map(Number);
      for (const [navn, verdi] of [
        ["minWords", LEVEL_SCOPE[nivå].minWords],
        ["maxWords", LEVEL_SCOPE[nivå].maxWords],
      ] as const) {
        if (!tall.includes(verdi)) avvik.push(`${nivå}.${navn}=${verdi} står ikke i: ${rad.trim()}`);
      }
    }

    expect(
      avvik.join("\n"),
      "Innstillinger viser en annen standard enn genereringen bruker.",
    ).toBe("");
  });

  it("benchmark-skriptet bruker de samme tallene", () => {
    const kilde = les("../../scripts/run-generation-benchmark.mjs");
    const avvik: string[] = [];

    for (const nivå of NIVÅER) {
      const rad = kilde.split("\n").find((l) => l.trim().startsWith(`${nivå}:`));
      if (!rad) {
        avvik.push(`${nivå}: fant ingen rad`);
        continue;
      }
      const tall = (rad.match(/\d+/g) ?? []).map(Number);
      for (const [navn, verdi] of [
        ["minWords", LEVEL_SCOPE[nivå].minWords],
        ["maxWords", LEVEL_SCOPE[nivå].maxWords],
        ["conceptsMax", LEVEL_COMPLEXITY[nivå].conceptsMax],
      ] as const) {
        if (!tall.includes(verdi)) avvik.push(`${nivå}.${navn}=${verdi} står ikke i: ${rad.trim()}`);
      }
    }

    expect(
      avvik.join("\n"),
      "Benchmark-skriptet måler mot andre grenser enn plattformen bruker.\n" +
        "Da måler vi noe annet enn det vi kjører, og tallene er ikke sammenlignbare.",
    ).toBe("");
  });

  it("prosaen i retningslinjene gjentar dem IKKE", () => {
    // Den fjerde kopien er allerede fjernet. Dette holder den borte: kommer tallene tilbake i
    // prosaen, får modellen den samme grensen to ganger fra to kilder i samme prompt.
    const kilde = les("../../src/modules/adminContent/llmContentGenerationService.ts");
    const start = kilde.indexOf("const MODULE_DRAFT_LEVEL_GUIDELINES");
    const slutt = kilde.indexOf("};", start);
    expect(start, "fant ikke retningslinjene — kontrollcase").toBeGreaterThan(0);

    const blokk = kilde.slice(start, slutt);
    const tall = blokk.match(/\d+/g) ?? [];
    expect(
      tall.join(", "),
      "Retningslinjene i prosa skal være tallfrie. Grensene skrives inn strukturert rett under,\n" +
        "og to kilder for samme grense i samme prompt glir fra hverandre.",
    ).toBe("");
  });
});
