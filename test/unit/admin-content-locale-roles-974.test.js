import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// #974: to språk i forfatterkonsollet, og regelen som skiller dem.
//
//   `currentLocale`  — menyspråket. Knapper, datoer, feilmeldinger, x-locale.
//   `contentLocale`  — innholdsspråket. Alt som LESER eller SKRIVER modulinnhold.
//
// Regelen sto skrevet ved `contentLocale` siden 2026-08-17. Ni genereringskall fulgte den ikke:
// «lag modul fra kildemateriale» og «lag MCQ» sendte MENYspråket som språket LLM-en skulle
// skrive innholdet på. Forfatter med menyen på engelsk og innhold på bokmål fikk et engelsk utkast.
// Kriteriegenereringen (7186) hadde alt gjort det riktig — det var én av tre flyter.
//
// ⚠️ RATSJ I BEGGE RETNINGER. 13 igjen er de lovlige: definisjon, oversettelsestabell, x-locale,
// intent-logg (telemetri om inputen), datoformat, språkvelgeren, og fire kommentarer som nevner
// navnet for å forklare regelen. Fjernes én, skal tallet ned i samme commit.
// ─────────────────────────────────────────────────────────────────────────────

const SHELL = fileURLToPath(new URL("../../public/static/admin-content-shell.js", import.meta.url));
const TAK = 13;

describe("#974 — menyspråket styrer ikke innhold i admin-content-shell", () => {
  const src = readFileSync(SHELL, "utf8");
  const lines = src.split("\n");

  it("⚠️ ingen genereringsflyt sender menyspråket som innholdsspråk", () => {
    const treff = lines
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /(generateBlueprintAndConfirm|askForMcqQuestionCount|askForMcqOptionCount|confirmAndGenerate)\(/.test(l) && /currentLocale/.test(l))
      .map(([n, l]) => `${n}: ${l.trim().slice(0, 100)}`);
    expect(treff.join("\n")).toBe("");
  });

  it("⚠️ kildevalget for oversettelse har ikke menyspråket som kandidat", () => {
    const linje = lines.find((l) => l.includes("const preferredOrder = ["));
    expect(linje, "fant ikke preferredOrder — kontrollcase").toBeTruthy();
    expect(linje).not.toContain("currentLocale");
    expect(linje).toContain("contentLocale");
  });

  it(`ratsj: currentLocale forekommer nøyaktig ${TAK} ganger (går tallet ned, senk TAK i samme commit)`, () => {
    const antall = (src.match(/currentLocale/g) ?? []).length;
    expect(antall, `${antall} forekomster av currentLocale i shell`).toBe(TAK);
  });
});
