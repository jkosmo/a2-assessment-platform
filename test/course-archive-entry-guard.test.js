import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT: hver vei inn i et kurs må gå gjennom arkivsjekken.
//
// #938 stengte den ene døra (`setCourseItems`). QA-porten fant at den andre sto åpen
// (`setCourseModules`) — i #938 sin egen fiks. To dører, én sjekk: klassisk «riktig fiks,
// ufullstendig flate».
//
// ⚠️ En liste over «stedene som må sjekke» ville ikke funnet den andre døra, for ingen visste at
// den fantes. Derfor leter vakta selv: den finner hver funksjon i courseCommands.ts som SKRIVER
// courseItem-rader, og krever at den kaller `assertContentUsableInCourse`. En tredje inngang blir
// rød den dagen den skrives — ikke den dagen QA-porten tilfeldigvis ser den.
//
// Unntak må stå her, med begrunnelse. Et unntak man må skrive ned er et unntak man tenker over.
// ─────────────────────────────────────────────────────────────────────────────

const FILE = fileURLToPath(new URL("../src/modules/course/courseCommands.ts", import.meta.url));

// Skrivere som med vilje IKKE trenger sjekken. Tom i dag; hver framtidig oppføring skal ha en
// setning om hvorfor det er trygt.
const EXEMPT = {
  // "someFunction": "grunn",
};

/** Del fila i toppnivå-funksjoner: navn + kropp fram til neste `export async function` / EOF. */
function topLevelFunctions(src) {
  const re = /^export async function (\w+)\s*\(/gm;
  const starts = [...src.matchAll(re)].map((m) => ({ name: m[1], at: m.index }));
  return starts.map((s, i) => ({
    name: s.name,
    body: src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : src.length),
    line: src.slice(0, s.at).split("\n").length,
  }));
}

const WRITES_ITEMS = /client\.courseItem\.(createMany|create|update|updateMany)\b/;

describe("#938/#992: alle innganger til et kurs går gjennom arkivsjekken", () => {
  const src = readFileSync(FILE, "utf8");
  const fns = topLevelFunctions(src);

  it("KONTROLLASSERTION: vakta finner faktisk skrivere å sjekke", () => {
    // ⚠️ Uten denne blir vakta grønn av å måle NULL. Døper noen om `courseItem`-modellen, eller
    // flytter skrivingen til en annen fil, ville forbudet under bestått uten å dekke noe.
    // Nøyaktig den fella ga oss en falsk «47 av 47 er lokalisert» tidligere.
    const writers = fns.filter((f) => WRITES_ITEMS.test(f.body));
    expect(writers.length, "fant ingen courseItem-skrivere i courseCommands.ts — leter vakta riktig sted?")
      .toBeGreaterThanOrEqual(2);
    expect(fns.map((f) => f.name)).toEqual(expect.arrayContaining(["setCourseItems", "setCourseModules"]));
  });

  it("hver skriver kaller assertContentUsableInCourse", () => {
    const problems = fns
      .filter((f) => WRITES_ITEMS.test(f.body))
      .filter((f) => !(f.name in EXEMPT))
      .filter((f) => !f.body.includes("assertContentUsableInCourse("))
      .map(
        (f) =>
          `courseCommands.ts:${f.line} ${f.name}() skriver courseItem-rader uten å kalle`
          + ` assertContentUsableInCourse. Legg til kallet, eller før opp funksjonen i EXEMPT`
          + ` med en begrunnelse.`,
      );

    expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
  });

  it("EXEMPT peker bare på funksjoner som finnes", () => {
    // Et unntak for en funksjon som er borte ser ut som noen holder styr på noe, men dekker
    // ingenting — og skjuler at listen aldri gjøres opp.
    const names = new Set(fns.map((f) => f.name));
    const stale = Object.keys(EXEMPT).filter((n) => !names.has(n));
    expect(stale, `EXEMPT peker på funksjoner som ikke finnes:\n${stale.join("\n")}`).toEqual([]);
  });
});
