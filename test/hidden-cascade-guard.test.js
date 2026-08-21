import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT: `.hidden` på et element som allerede har en display-settende klasse.
//
// `.hidden { display: none }` står uten `!important`, og taper cascaden mot enhver klasse som
// setter `display` senere i fila. Elementet skjules da aldri. CLAUDE.md kaller dette en
// TILBAKEVENDENDE felle, og repoet har alt tre CSS-lapper som patcher symptomet i stedet for
// årsaken (`.state-rail[hidden]`, `.course-discussion-body[hidden]`, `.course-inline-panel[hidden]`).
//
// Det konkrete utslaget: `participant.html` har `class="module-brief hidden"`, og
// `.module-brief { display: grid }`. En tom OPPGAVE/VEILEDNING-boks med ramme og gradient står
// synlig til `renderSelectedModuleSummary()` rekker å kjøre og rette det med `setHidden`.
//
// ⚠️ Vakta finner de display-settende klassene SELV, ved å lese CSS-en. En hardkodet liste
// (`.row`, `.card`, `.content-card`…) kan per definisjon ikke oppdage klassen ingen tenkte på —
// og det er nøyaktig feilklassen doc/COMPLEXITY_SCAN.md leter etter.
//
// Dekker MARKUP, ikke JS-toggling. `el.classList.add("hidden")` på et vilkårlig element krever at
// man vet hvilket element det er, og det kan ikke avgjøres statisk. Det er en reell begrensning,
// ikke en forglemmelse: 144 slike togglinger finnes i 13 filer (#975).
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC = fileURLToPath(new URL("../public", import.meta.url));

// Kjente tilfeller. Hver MÅ ha en grunn — og hver av dem er en ekte feil som venter på #975,
// ikke en godkjenning.
const EXCEPTIONS = [];

function walk(dir, ext) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full, ext) : entry.endsWith(ext) ? [full] : [];
  });
}

function relOf(file) {
  return file.slice(PUBLIC.length + 1).replace(/\\/g, "/");
}

// Klasser som setter `display` til noe ANNET enn none. `.hidden` og søsknene er selve
// skjulemekanismen og skal ikke telle som motstandere av seg selv.
function displaySettingClasses() {
  const css = [
    ...walk(PUBLIC, ".css").map((f) => readFileSync(f, "utf8")),
    // <style>-blokkene i HTML-en bærer mesteparten av deltakerflatens layout.
    ...walk(PUBLIC, ".html").flatMap((f) => {
      const src = readFileSync(f, "utf8");
      return [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    }),
  ].join("\n");

  const found = new Set();
  // Selektor { ...deklarasjoner... } — grov, men nok: vi trenger bare klassenavnene.
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, body] = m;
    const display = /(^|[;\s])display\s*:\s*([a-z-]+)/i.exec(body);
    if (!display) continue;
    if (display[2].toLowerCase() === "none") continue;
    for (const cls of selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) found.add(cls[1]);
  }
  found.delete("hidden");
  return found;
}

function scan() {
  const displayClasses = displaySettingClasses();
  const hits = [];

  for (const file of walk(PUBLIC, ".html")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/class\s*=\s*"([^"]*)"/g)) {
      const classes = m[1].split(/\s+/).filter(Boolean);
      if (!classes.includes("hidden")) continue;
      const clashing = classes.filter((c) => c !== "hidden" && displayClasses.has(c));
      if (clashing.length === 0) continue;
      hits.push({
        file: relOf(file),
        line: src.slice(0, m.index).split("\n").length,
        classAttr: m[1],
        clashing,
      });
    }
  }
  return { hits, displayClasses };
}

describe(".hidden brukes ikke på elementer med en display-settende klasse", () => {
  it("ingen kolliderende klasser i markup", () => {
    const { hits, displayClasses } = scan();

    // ⚠️ KONTROLLASSERTION. Finner CSS-parsingen ingen display-settende klasser, ville vakta blitt
    // grønn ved å måle NULL — samme felle som en test som «bestod» ved å sjekke en tom liste.
    expect(displayClasses.size, "fant ingen display-settende klasser — leser vakta CSS-en?")
      .toBeGreaterThan(5);

    const problems = hits
      .filter((h) => !EXCEPTIONS.some((e) => e.file === h.file && e.line === h.line))
      .map((h) => `${h.file}:${h.line} — class="${h.classAttr}" kolliderer med .${h.clashing.join(", .")}`);

    expect(
      problems,
      "\n.hidden taper cascaden mot disse klassene, så elementet skjules aldri.\n"
        + "Bruk setHidden(el, on) fra dom-visibility.js, eller inline style.display.\n\n"
        + problems.join("\n"),
    ).toEqual([]);
  });
});
