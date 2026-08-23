import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT OVER DEKNINGSVAKTENE: en vakt som ikke kjører i porten er ikke en vakt.
//
// Den obligatoriske pre-stage-porten er `lint` + `test:unit` + `test:dom`. `vitest.unit.config.ts`
// tar `test/unit/**` pluss en håndskrevet liste over rot-filer. En dekningsvakt lagt i test-rota og
// glemt i den lista kjører først i den FULLE kjøringen — altså i CI, altså etter at deployen er
// bestemt.
//
// ⚠️ Dette har skjedd to ganger. Første gang (#896 S3c) etterlot 21 røde tester i et døgn uten at
// porten merket noe; kommentaren i configen forteller historien. Andre gang var #992: jeg la til to
// vakter, leste den kommentaren, og glemte dem likevel — og da QA-porten pekte på det, viste det seg
// at ingen av de fire ELDRE vaktene sto der heller.
//
// En kommentar som forklarer fella stopper den ikke. Denne testen gjør det.
//
// Hvorfor `*-guard`: en dekningsvakt leser filer fra disk og trenger verken database eller server,
// så den KAN alltid kjøre i unit-porten — og den er verdiløs andre steder. Navnekonvensjonen er
// dermed også et løfte om hvor filen hører hjemme.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TEST_DIR = fileURLToPath(new URL("..", import.meta.url));
const CONFIG = fileURLToPath(new URL("../../vitest.unit.config.ts", import.meta.url));

// Vakter som med vilje står utenfor porten. Tom i dag; hver oppføring skal ha en setning om hvorfor
// den ikke kan kjøre uten database eller server.
const EXEMPT = {
  // "test/some-guard.test.js": "grunn",
};

function rootGuardFiles() {
  return readdirSync(TEST_DIR)
    .filter((f) => /-guard\.test\.(js|ts)$/.test(f))
    .map((f) => `test/${f}`);
}

describe("dekningsvaktene kjører i pre-stage-porten", () => {
  const config = readFileSync(CONFIG, "utf8");
  const guards = rootGuardFiles();

  it("KONTROLLASSERTION: vakta finner faktisk vaktfiler", () => {
    // ⚠️ Uten denne blir forbudet under grønt av å måle NULL — endres navnekonvensjonen, eller
    // flyttes vaktene, ville testen bestått mens den dekket ingenting. Nøyaktig den fella ga oss
    // en falsk «47 av 47 er lokalisert».
    expect(guards.length, `fant ingen *-guard.test.* i ${TEST_DIR} — leter vakta riktig sted?`)
      .toBeGreaterThan(0);
  });

  it("hver dekningsvakt i test-rota står i vitest.unit.config.ts", () => {
    const missing = guards
      .filter((g) => !(g in EXEMPT))
      .filter((g) => !config.includes(`"${g}"`))
      .map(
        (g) =>
          `${g} kjører ikke i \`npm run test:unit\`, som er porten før stage-deploy.`
          + ` Legg filnavnet i include-lista i vitest.unit.config.ts, eller før den opp i EXEMPT`
          + ` med en begrunnelse.`,
      );

    expect(missing, `\n${missing.join("\n")}\n`).toEqual([]);
  });

  it("include-lista peker bare på filer som finnes", () => {
    // En oppføring for en slettet fil ser ut som dekning, men er en tom rad. Vitest sier ingenting
    // om et mønster uten treff, så dette er den eneste måten å oppdage det på.
    const listed = [...config.matchAll(/"(test\/[^"*]+\.test\.(?:js|ts))"/g)].map((m) => m[1]);
    expect(listed.length, "fant ingen rot-filer i include-lista — leser vakta riktig fil?")
      .toBeGreaterThan(0);
    const stale = listed.filter((f) => {
      try {
        readFileSync(`${ROOT}${f}`);
        return false;
      } catch {
        return true;
      }
    });
    expect(stale, `include-lista peker på filer som ikke finnes:\n${stale.join("\n")}`).toEqual([]);
  });
});
