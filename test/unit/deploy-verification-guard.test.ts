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
    // ⚠️ Vakta LESTE FEIL ENHET fram til 19.09. Den fant «45 runder» og ganget med 35 s — tallet
    // fra en runde der HTTP-kallet bruker hele tidsavbruddet. Men når den gamle containeren
    // fortsatt svarer, koster en runde bare pausen (~21 s), og 45 runder rakk ~16 min, ikke ~26.
    // Prod-deployen av 2.73.0 ga opp etter 17 min på en app som var oppe fem minutter senere.
    //
    // Budsjettet er nå en FRIST, og vakta leser den direkte — ingen omregning, ingen antakelse om
    // hvor lang en runde er.
    const ps = les("../../scripts/azure/deploy-environment.ps1");
    const rad = ps.split("\n").find((l) => l.includes("[int]$MaxWaitMinutes ="));
    expect(rad, "fant ikke fristen — kontrollcase").toBeTruthy();

    const minutter = Number((rad?.match(/=\s*(\d+)/) ?? [])[1]);
    expect(Number.isFinite(minutter), `kunne ikke lese tallet fra: ${rad}`).toBe(true);

    expect(
      minutter,
      `Fristen er ${minutter} min. Verste målte kaldstart var ~13 min (2.63.0, med to migrasjoner\n` +
        "ved oppstart på én B1-instans), og 2.73.0 brukte ~22 min. Under ~20 min er marginen borte,\n" +
        "og da feiler jobben på en deploy som lyktes.",
    ).toBeGreaterThanOrEqual(20);
  });

  it("⚠️ budsjettet telles ikke i runder — enheten er selve feilen vakta finnes for", () => {
    // Kontrollcase mot tilbakefall: en «forenkling» tilbake til et antall forsøk ville gjeninnført
    // avstanden mellom det budsjettet sier og det det faktisk gjør.
    const ps = les("../../scripts/azure/deploy-environment.ps1");
    expect(
      ps.includes("MaxConsecutiveFailures"),
      "Budsjettet er tilbake i runder. En runde varer ulikt (~21 s når gammel container svarer,\n" +
        "~35 s når den ikke svarer), så et antall runder måler ikke tid. Bruk MaxWaitMinutes.",
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VAKT: porten skal stå der arbeidet er.
//
// ⚠️ MÅLT KONSEKVENS. CI kjørte bare på pull request og på push til `main`. Alt arbeid skjer på
// `dev`, og PR-er til main åpnes med uker mellomrom. `npm test` sto derfor RØD i to uker — elleve
// DOM-tester falt på «document is not defined» — og ble oppdaget først da dev → main ble åpnet.
//
// Det er samme feilklasse som har truffet oss flere ganger: et signal ingen ser, er ikke et signal.
// ─────────────────────────────────────────────────────────────────────────────

describe("CI kjører der arbeidet skjer", () => {
  it("⚠️ CI utløses av pushes til dev, ikke bare til main", () => {
    const yml = les("../../.github/workflows/ci.yml");
    const start = yml.indexOf("on:");
    const slutt = yml.indexOf("\nenv:", start);
    expect(start, "fant ikke on-blokken — kontrollcase").toBeGreaterThanOrEqual(0);

    const blokk = yml.slice(start, slutt);
    expect(
      blokk,
      "CI må kjøre på dev. Uten det står porten bare ved main, og feil kan ligge rødt i ukevis " +
        "mens arbeidet fortsetter — slik jsdom-feilen gjorde i to uker.",
    ).toMatch(/^\s*-\s*dev\s*$/m);

    // ⚠️ Kontrollcase: main skal fortsatt være der. Uten denne kunne noen byttet ut main med dev
    // og testen ville sett like grønn ut, mens porten på standardgrenen forsvant.
    expect(blokk, "main skal fortsatt utløse CI").toMatch(/^\s*-\s*main\s*$/m);
  });

  it("⚠️ eldre CI-kjøringer avbrytes, så køen ikke tester mellomtilstander", () => {
    const yml = les("../../.github/workflows/ci.yml");
    expect(yml, "uten concurrency stables kjøringene ved raske pushes").toContain("concurrency:");
    expect(yml).toContain("cancel-in-progress: true");
  });
});
