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
// ⚠️ RATSJ I BEGGE RETNINGER. 12 igjen er de lovlige: definisjon, oversettelsestabell, x-locale,
// intent-logg (telemetri om inputen), språkvelgeren (tre), getteren Innstillinger-fanen leser
// datoformatet gjennom (to på én linje), og to kommentarer som nevner navnet for å forklare regelen
// (den tredje fulgte kriteriekoden til admin-content-criteria.js).
// Fjernes én, skal tallet ned i samme commit. Innstillinger-fanen (#1046 punkt 2) telles for seg:
// datoformatet og én kommentar.
// ─────────────────────────────────────────────────────────────────────────────

const SHELL = fileURLToPath(new URL("../../public/static/admin-content-shell.js", import.meta.url));
const TAK = 12;
const SETTINGS_TAB = fileURLToPath(new URL("../../public/static/admin-content-settings-tab.js", import.meta.url));
const TAK_SETTINGS_TAB = 2;

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
    // Publiseringsgaten bor i admin-content-publish.js (#1046 punkt 2); menyspråket kommer ikke
    // inn i ctx der, så et brudd ville stått som `ctx.currentLocale` — det er det som sjekkes.
    const publish = readFileSync(fileURLToPath(new URL("../../public/static/admin-content-publish.js", import.meta.url)), "utf8");
    const linje = publish.split("\n").find((l) => l.includes("const preferredOrder = ["));
    expect(linje, "fant ikke preferredOrder — kontrollcase").toBeTruthy();
    expect(linje).not.toContain("currentLocale");
    expect(linje).toContain("contentLocale");
    expect(publish).not.toContain("currentLocale");
  });

  it(`ratsj: currentLocale forekommer nøyaktig ${TAK} ganger (går tallet ned, senk TAK i samme commit)`, () => {
    const antall = (src.match(/currentLocale/g) ?? []).length;
    expect(antall, `${antall} forekomster av currentLocale i shell`).toBe(TAK);
  });

  it(`ratsj: Innstillinger-fanen leser ctx.currentLocale nøyaktig ${TAK_SETTINGS_TAB} ganger (datoformat + kommentar)`, () => {
    const tab = readFileSync(SETTINGS_TAB, "utf8");
    const antall = (tab.match(/currentLocale/g) ?? []).length;
    expect(antall, `${antall} forekomster av currentLocale i Innstillinger-fanen`).toBe(TAK_SETTINGS_TAB);
    // Og aldri som innholdsspråk: bare toLocaleString leser den.
    for (const l of tab.split("\n")) {
      if (/currentLocale/.test(l) && !l.trim().startsWith("//")) expect(l).toContain("toLocaleString");
    }
  });
});
