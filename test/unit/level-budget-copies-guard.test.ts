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
