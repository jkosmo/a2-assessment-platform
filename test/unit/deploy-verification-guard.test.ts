import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// VAKT: deployen skal alltid verifiseres av en maskin, og porten skal ikke rope ulv.
//
// ⚠️ MÅLT HENDELSE 2026-09-09. Prod-deployen av 2.63.0 lyktes, men jobben feilet — stabilitets-
// sjekken ga opp to minutter for tidlig. Fra kjøringsloggen:
//
//   poll 1–22  (~8 min): gammel container serverte fortsatt forrige versjon
//   poll 23–30 (~5 min): appen svarte ikke i det hele tatt mens ny container startet
//   ga opp 20:27 — /version svarte 2.63.0 klokken 20:29
//
// To ting gikk galt samtidig, og det andre er det alvorlige:
//
//   1. Budsjettet var for stramt for en kald B1-start med migrasjoner ved oppstart.
//   2. Røyktesten sto på `if: success()` og ble derfor HOPPET OVER. En deploy som faktisk hadde
//      lykkes gikk uverifisert av maskinen, nøyaktig i det tilfellet der noe uvanlig skjedde.
//
// Å slå av instrumentet når noe er uvanlig er den verste varianten. En port der rødt betyr «uflaks»
// like ofte som «ekte feil» lærer oss å ignorere den — og da slipper en ekte feil gjennom.
// ─────────────────────────────────────────────────────────────────────────────

const les = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("deployen verifiseres av en maskin, uansett utfall", () => {
  it("⚠️ røyktesten kjører alltid — ikke bare når alt gikk bra", () => {
    const yml = les("../../.github/workflows/deploy-app.yml");
    const linjer = yml.split("\n");

    const steg: { navn: string; betingelse: string | null }[] = [];
    linjer.forEach((linje, i) => {
      if (!linje.includes("name: Post-deploy /healthz smoke test")) return;
      // Betingelsen står på linja rett under navnet i dette oppsettet.
      const neste = linjer[i + 1]?.trim() ?? "";
      steg.push({ navn: "smoke", betingelse: neste.startsWith("if:") ? neste : null });
    });

    // ⚠️ Kontrollcase: finner vi ingen steg, måler vakta ingenting og ville stått grønn.
    expect(steg.length, "ventet røyktesten i både staging- og prod-jobben").toBe(2);

    const feil = steg.filter((s) => s.betingelse !== "if: always()");
    expect(
      feil.map((s) => s.betingelse ?? "(ingen betingelse)").join("\n"),
      "`if: success()` gjør at verifiseringen hoppes over nettopp når noe uvanlig skjedde.\n" +
        "Feilet deployen på ekte, feiler røyktesten også — og da sier den det.",
    ).toBe("");
  });

  it("⚠️ tålmodighetsbudsjettet dekker en kald B1-start med migrasjoner", () => {
    // Hver runde er inntil 15 s HTTP-timeout + 20 s pause = 35 s. Verste MÅLTE kaldstart er ~13 min.
    // Under 22 runder (~13 min) ville vi ligget på grensen der 2.63.0 falt.
    const ps = les("../../scripts/azure/deploy-environment.ps1");
    const rad = ps.split("\n").find((l) => l.includes("[int]$MaxConsecutiveFailures ="));
    expect(rad, "fant ikke budsjettet — kontrollcase").toBeTruthy();

    const tall = Number((rad?.match(/=\s*(\d+)/) ?? [])[1]);
    expect(Number.isFinite(tall), `kunne ikke lese tallet fra: ${rad}`).toBe(true);

    const minutter = (tall * 35) / 60;
    expect(
      minutter,
      `Budsjettet er ${tall} runder ≈ ${minutter.toFixed(0)} min. Verste målte kaldstart var ~13 min\n` +
        "(2.63.0, med to migrasjoner ved oppstart på én B1-instans). Under ~20 min er marginen borte,\n" +
        "og da feiler jobben på en deploy som lyktes.",
    ).toBeGreaterThanOrEqual(20);
  });
});
