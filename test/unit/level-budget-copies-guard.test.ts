import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEVEL_COMPLEXITY, LEVEL_SCOPE } from "../../src/modules/adminContent/llmContentGenerationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// VAKT (#1049): grensene per nivå finnes FLERE steder, og de skal si det samme.
//
// `LEVEL_COMPLEXITY` og `LEVEL_SCOPE` er kilden. Men to kopier kan ikke fjernes:
//
//   `public/static/admin-content-external-llm.js`  bygger prompten forfatteren limer inn i en
//                                                  ekstern modell. Den er modul-uavhengig — modellen
//                                                  velger nivå selv — så hele tabellen må stå der,
//                                                  og den kjører i nettleseren uten tilgang til
//                                                  serverens TypeScript.
//   `scripts/run-generation-benchmark.mjs`         er et frittstående skript.
//
// ⚠️ HVORFOR DETTE ER EN VAKT OG IKKE EN OPPRYDDING. Da denne saken startet sto tallene to steder;
// undersøkelsen fant et tredje, og produkteier minnet om et fjerde. Hver kopi er skrevet i god tro,
// og hver av dem er usynlig for de andre. En endring i kilden ville ikke nådd dem — modellen ville
// fått motstridende grenser, og vi ville ikke visst hvilken den fulgte.
//
// Vakta krever ikke at kopiene forsvinner. Den krever at de er ENIGE.
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

  it("den eksterne LLM-prompten viser de samme tallene", () => {
    const kilde = les("../../public/static/admin-content-external-llm.js");
    const avvik: string[] = [];

    for (const nivå of NIVÅER) {
      const c = LEVEL_COMPLEXITY[nivå];
      const s = LEVEL_SCOPE[nivå];
      // Raden slik den står i markdown-tabellen i prompten.
      const rad = kilde
        .split("\n")
        .find((l) => l.trim().startsWith(`| ${nivå}`) || l.trim().startsWith(`|${nivå}`));

      if (!rad) {
        avvik.push(`${nivå}: fant ingen rad i tabellen`);
        continue;
      }
      const tall = (rad.match(/\d+/g) ?? []).map(Number);
      for (const [navn, verdi] of [
        ["actorsMax", c.actorsMax],
        ["conceptsMax", c.conceptsMax],
        ["tradeoffsMax", c.tradeoffsMax],
        ["minWords", s.minWords],
        ["maxWords", s.maxWords],
      ] as const) {
        if (!tall.includes(verdi)) avvik.push(`${nivå}.${navn}=${verdi} står ikke i raden: ${rad.trim()}`);
      }
    }

    expect(
      avvik.join("\n"),
      "Den eksterne prompten og LEVEL_COMPLEXITY/LEVEL_SCOPE er uenige.\n" +
        "Forfatteren limer den prompten inn i en ekstern modell, så uenigheten gir et utkast\n" +
        "bygget mot andre grenser enn plattformens egne — uten at noe sier fra.",
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
