import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT: skjuling som ikke skjuler.
//
// To mekanismer brukes om hverandre i denne kodebasen, og de taper cascaden på HVER SIN måte:
//
//   • `.hidden`-KLASSEN (`display:none` i shared.css, uten `!important`) er en forfatter-regel.
//     Den taper bare mot forfatter-regler som kommer SENERE eller er mer spesifikke — i praksis
//     `<style>`-blokkene i HTML-sidene, som lastes etter shared.css.
//   • `hidden`-ATTRIBUTTET har ingen forfatter-regel bak seg, bare UA-arket. Origin slår
//     spesifisitet, så det taper mot ENHVER forfatter-regel som setter display — også en regel
//     som står tidlig i shared.css.
//
// Attributtet er altså det klart farligste, og det var også der alle de sju ekte feilene i #975
// satt. Vakta må derfor modellere BEGGE, ikke bare telle klassenavn.
//
// Kuren er `setHidden(el, on)` i `public/static/dom-visibility.js`: den setter både attributtet
// (semantikk) og inline `style.display` (effekt), og inline display slår alt.
//
// ⚠️ Vakta finner de display-settende reglene SELV, ved å lese CSS-en i lasterekkefølge per side.
// En hardkodet liste (`.row`, `.card`, `.content-card`…) kan per definisjon ikke oppdage klassen
// ingen tenkte på — og det er nøyaktig feilklassen doc/COMPLEXITY_SCAN.md leter etter.
//
// Dekker (1) markup i HTML-sidene og (2) JS-togglinger der elementet kan slås opp statisk
// (`document.getElementById("…")` / `querySelector("#…")`). Den kan IKKE dekke elementer som
// opprettes i JS uten id — det krever at man vet hvilket element det er, og det kan ikke avgjøres
// statisk. Den begrensningen er reell, og e2e-en `test/e2e/hidden-cascade.spec.ts` måler de
// tilfellene i en ekte nettleser i stedet.
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC = fileURLToPath(new URL("../public", import.meta.url));

// Kjente tilfeller. Hver MÅ ha en grunn — og hver av dem er en ekte feil som venter, ikke en
// godkjenning.
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

// Filene i repoet er CRLF. I JS-regex er `\r` en linjeterminator som `.` IKKE matcher, så et
// naivt `/\/\/.*$/` lar hele kommentaren stå igjen — vakta leste da `stateRail.hidden = …` inne i
// en kommentar som en ekte toggling. Mutasjonstestingen avslørte det; derfor normaliseres alt her.
function read(file) {
  return readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
}

// ── CSS-parsing ──────────────────────────────────────────────────────────────

// Grov, men tilstrekkelig: vi trenger selektor, display-verdi og REKKEFØLGE. @media-blokker
// hoppes over — de kan ikke avgjøres uten en viewport, og en regel som bare gjelder på mobil er
// ikke det denne vakta jakter på.
function parseDisplayRules(css, origin) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (s) => " ".repeat(s.length));
  const rules = [];
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorList = m[1].trim();
    if (selectorList.startsWith("@")) continue;
    const declared = /(^|[;\s])display\s*:\s*([a-z-]+)/i.exec(m[2]);
    if (!declared) continue;
    const line = stripped.slice(0, m.index).split("\n").length;
    for (const part of selectorList.split(",")) {
      const selector = part.trim();
      if (!selector || selector.startsWith("@")) continue;
      rules.push({ selector, display: declared[2].toLowerCase(), origin, line, ...analyzeSelector(selector) });
    }
  }
  return rules;
}

// Nøkkelkompounden er den siste enkeltselektoren — det er den som beskriver elementet selv.
// Selektorer med kombinator eller tilstands-pseudoklasse kan ikke avgjøres statisk, og de
// utelates hellere enn å gi falske treff.
function analyzeSelector(selector) {
  const withoutArgs = selector.replace(/\([^)]*\)/g, "");
  const hasCombinator = /[\s>+~]/.test(withoutArgs.trim());
  const key = selector.split(/[\s>+~]+/).filter(Boolean).pop() ?? "";
  const classes = [...key.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((x) => x[1]);
  const ids = [...key.matchAll(/#([a-zA-Z][\w-]*)/g)].map((x) => x[1]);
  const attrs = [...key.matchAll(/\[([^\]]+)\]/g)].map((x) => x[1].split(/[=~|^$*]/)[0].trim());
  const pseudo = [...key.matchAll(/:(?!:)([a-zA-Z-]+)/g)].map((x) => x[1]);
  const tag = /^([a-zA-Z][\w-]*)/.exec(key)?.[1]?.toLowerCase() ?? null;
  return {
    hasCombinator,
    hasPseudo: pseudo.length > 0,
    classes,
    ids,
    attrs,
    tag,
    specificity: [ids.length, classes.length + attrs.length + pseudo.length, tag ? 1 : 0],
  };
}

const beats = (a, b) => (a.specificity[0] !== b.specificity[0]
  ? a.specificity[0] > b.specificity[0]
  : a.specificity[1] !== b.specificity[1]
    ? a.specificity[1] > b.specificity[1]
    : a.specificity[2] !== b.specificity[2]
      ? a.specificity[2] > b.specificity[2]
      : a.order >= b.order);

// ── Sidemodell: cascade i lasterekkefølge ────────────────────────────────────

const sheetCache = new Map();
function sheetRules(name) {
  if (!sheetCache.has(name)) {
    const path = join(PUBLIC, "static", name);
    sheetCache.set(name, parseDisplayRules(read(path), `static/${name}`));
  }
  return sheetCache.get(name);
}

function buildPages() {
  return walk(PUBLIC, ".html").map((file) => {
    const src = read(file);
    let rules = [];
    for (const link of src.matchAll(/<link[^>]+href="\/static\/([\w.-]+\.css)"/g)) {
      try {
        rules = rules.concat(sheetRules(link[1]));
      } catch {
        // En side kan peke på et ark som ikke finnes lokalt; da har vi bare mindre å måle på.
      }
    }
    // <style>-blokkene kommer etter <link>-ene i alle sidene våre, og bærer mesteparten av
    // deltakerflatens layout. De vinner derfor over shared.css ved lik spesifisitet.
    for (const style of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      rules = rules.concat(parseDisplayRules(style[1], `${relOf(file)}<style>`));
    }
    return {
      file: relOf(file),
      src,
      rules: rules.map((rule, order) => ({ ...rule, order })),
      elements: parseElements(src, relOf(file)),
    };
  });
}

function parseElements(src, file) {
  const withoutStyle = src.replace(/<style[^>]*>[\s\S]*?<\/style>/g, (s) => " ".repeat(s.length));
  const elements = [];
  for (const m of withoutStyle.matchAll(/<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const attrs = m[2];
    // `aria-hidden` er en helt annen sak og skal ikke forveksles med skjulingsattributtet.
    const withoutAria = attrs.replace(/\baria-hidden\b/g, "");
    elements.push({
      file,
      tag: m[1].toLowerCase(),
      id: /\bid\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? null,
      classes: (/\bclass\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? "").split(/\s+/).filter(Boolean),
      hasHiddenAttr: /(^|\s)hidden(\s*=|\s|$)/.test(withoutAria),
      inlineDisplay: /\bstyle\s*=\s*"[^"]*\bdisplay\s*:\s*([a-z-]+)/.exec(attrs)?.[1] ?? null,
      line: src.slice(0, m.index).split("\n").length,
    });
  }
  return elements;
}

// ── Kjernen: skjuler mekanismen faktisk elementet? ───────────────────────────

const UA_HIDDEN_RULE = {
  selector: "[hidden] (UA-arket)",
  display: "none",
  origin: "user-agent",
  // Forfatter-origin slår UA-origin uansett spesifisitet, så UA-regelen modelleres som taperen
  // av enhver kamp mot en forfatter-regel.
  specificity: [-1, -1, -1],
  order: -1,
};

function winningRule(page, element, mechanism) {
  const classes = new Set(element.classes);
  if (mechanism === "class") classes.add("hidden");
  const hiddenAttrOn = mechanism === "attr" || element.hasHiddenAttr;

  const candidates = page.rules.filter((rule) => {
    if (rule.hasCombinator || rule.hasPseudo) return false;
    if (rule.tag && rule.tag !== element.tag) return false;
    if (rule.ids.some((id) => id !== element.id)) return false;
    if (!rule.classes.every((cls) => classes.has(cls))) return false;
    if (!rule.attrs.every((attr) => attr === "hidden" && hiddenAttrOn)) return false;
    return true;
  });

  let winner = hiddenAttrOn ? UA_HIDDEN_RULE : null;
  for (const rule of candidates) if (!winner || beats(rule, winner)) winner = rule;
  return winner;
}

function isHidden(page, element, mechanism) {
  // Inline style.display slår alle regler — det er nettopp derfor setHidden bruker den.
  if (element.inlineDisplay) return { hides: element.inlineDisplay === "none", by: `style="display:${element.inlineDisplay}"` };
  const winner = winningRule(page, element, mechanism);
  if (!winner) return { hides: false, by: "ingen regel skjuler elementet" };
  return { hides: winner.display === "none", by: `${winner.selector} {display:${winner.display}} — ${winner.origin}:${winner.line ?? "-"}` };
}

// ── JS-togglinger som kan slås opp statisk ───────────────────────────────────

const TOGGLE_PATTERNS = [
  [/([A-Za-z_$][\w$]*)\s*\.\s*classList\s*\.\s*(?:add|remove|toggle)\(\s*["'`]hidden["'`]/g, "class"],
  [/(?<![\w.-])([A-Za-z_$][\w$]*)\s*\.\s*hidden\s*=(?!=)/g, "attr"],
  [/([A-Za-z_$][\w$]*)\s*\.\s*(?:set|remove|toggle)Attribute\(\s*["'`]hidden["'`]/g, "attr"],
];

function scanJsToggles(pages) {
  const byId = new Map();
  for (const page of pages) {
    for (const element of page.elements) {
      if (!element.id) continue;
      if (!byId.has(element.id)) byId.set(element.id, []);
      byId.get(element.id).push({ page, element });
    }
  }

  const toggles = [];
  for (const file of walk(PUBLIC, ".js")) {
    const rel = relOf(file);
    if (rel.includes("vendor/")) continue;
    const src = read(file);
    const lookups = new Map();
    for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w.]*\bgetElementById\(\s*["'`]([^"'`]+)["'`]/g)) {
      lookups.set(m[1], m[2]);
    }
    for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w.]*\bquerySelector\(\s*["'`]#([\w-]+)["'`]/g)) {
      if (!lookups.has(m[1])) lookups.set(m[1], m[2]);
    }

    src.split("\n").forEach((rawLine, index) => {
      const code = rawLine.replace(/\/\/.*$/, "");
      for (const [pattern, mechanism] of TOGGLE_PATTERNS) {
        for (const m of code.matchAll(pattern)) {
          const id = lookups.get(m[1]);
          for (const target of (id ? byId.get(id) ?? [] : [])) {
            toggles.push({
              file: rel,
              line: index + 1,
              variable: m[1],
              mechanism,
              target,
              verdict: isHidden(target.page, target.element, mechanism),
            });
          }
        }
      }
    });
  }
  return toggles;
}

// ── Testene ──────────────────────────────────────────────────────────────────

const pages = buildPages();

const markupCases = pages.flatMap((page) =>
  page.elements.flatMap((element) =>
    ["class", "attr"]
      .filter((mechanism) => (mechanism === "class" ? element.classes.includes("hidden") : element.hasHiddenAttr))
      .map((mechanism) => ({ page, element, mechanism, verdict: isHidden(page, element, mechanism) })),
  ),
);

const jsCases = scanJsToggles(pages);

describe("skjuling som faktisk skjuler (#975)", () => {
  // ⚠️ KONTROLLASSERTIONER. Uten dem kan vakta bli grønn av å måle NULL — den fella traff dette
  // repoet før, med en «47 av 47 er lokalisert» som i virkeligheten hadde funnet 0. Hver av dem
  // hevder at MÅLEAPPARATET fant noe, ikke at resultatet var pent.
  it("kontroll: vakta finner faktisk display-regler, markup og JS-togglinger å måle på", () => {
    const displayRules = pages.reduce((sum, page) => sum + page.rules.length, 0);
    expect(displayRules, "fant ingen display-regler — leser vakta CSS-en i det hele tatt?").toBeGreaterThan(50);

    const pagesWithInlineStyleRules = pages.filter((page) => page.rules.some((r) => r.origin.includes("<style>")));
    expect(
      pagesWithInlineStyleRules.length,
      "fant ingen display-regler i <style>-blokkene — det er nettopp DE som slår `.hidden`, "
        + "så uten dem måler vakta den harmløse halvparten av problemet",
    ).toBeGreaterThan(3);

    expect(markupCases.length, "fant ingen .hidden/[hidden] i markup — er HTML-parsingen i stykker?")
      .toBeGreaterThan(20);

    expect(
      jsCases.length,
      "fant ingen JS-toggling som kunne slås opp mot et element — er oppslaget av "
        + "`document.getElementById(\"…\")` i stykker?",
    ).toBeGreaterThan(50);

    // Begge mekanismene må være representert. Dekker vakta bare klassen, går den glipp av
    // attributtet — og det var attributtet som var ødelagt i alle sju tilfellene i #975.
    for (const mechanism of ["class", "attr"]) {
      const seen = [...markupCases, ...jsCases].filter((c) => c.mechanism === mechanism);
      expect(seen.length, `fant ingen tilfeller av mekanismen «${mechanism}» — vakta måler bare halve problemet`)
        .toBeGreaterThan(5);
    }
  });

  it("kontroll: modellen dømmer et konstruert kollisjonstilfelle som ødelagt", () => {
    // Motprøven til testene under: hvis modellen sier «skjules» om ALT, sier den ingenting. Her er
    // et element som HELT SIKKERT ikke skjules — samme form som participant.html:446 hadde før
    // fiksen — og modellen må se det.
    const page = pages.find((p) => p.rules.some((r) => r.origin.includes("<style>") && r.display !== "none" && r.classes.length === 1));
    expect(page, "fant ingen side med en display-settende klasse i <style> å prøve modellen mot").toBeTruthy();
    const rule = page.rules.find((r) => r.origin.includes("<style>") && r.display !== "none" && r.classes.length === 1 && !r.tag);
    const fake = { file: page.file, tag: "div", id: null, classes: [rule.classes[0]], hasHiddenAttr: false, inlineDisplay: null, line: 0 };

    expect(isHidden(page, fake, "class").hides, `.${rule.classes[0]} {display:${rule.display}} skal slå .hidden`).toBe(false);
    expect(isHidden(page, fake, "attr").hides, `.${rule.classes[0]} {display:${rule.display}} skal slå [hidden]`).toBe(false);

    // MAKKEREN: samme element med inline display:none MÅ dømmes som skjult. Uten denne vet vi ikke
    // om modellen måler regelen eller bare svarer «ikke skjult» om alt.
    const cured = { ...fake, inlineDisplay: "none" };
    expect(isHidden(page, cured, "class").hides, "setHidden() sin inline display:none skal slå alt").toBe(true);
  });

  it("markup: ingen .hidden/[hidden] som taper cascaden", () => {
    const problems = markupCases
      .filter((c) => !c.verdict.hides)
      .filter((c) => !EXCEPTIONS.some((e) => e.file === c.page.file && e.line === c.element.line))
      .map((c) => `${c.page.file}:${c.element.line} [${c.mechanism}] <${c.element.tag}`
        + `${c.element.id ? ` id="${c.element.id}"` : ""}${c.element.classes.length ? ` class="${c.element.classes.join(" ")}"` : ""}>`
        + ` — vinner: ${c.verdict.by}`);

    expect(
      problems,
      "\nDisse elementene skjules ALDRI, selv om markupen sier at de skal.\n"
        + "Legg til style=\"display:none\" i markupen og la setHidden() styre dem videre.\n\n"
        + problems.join("\n"),
    ).toEqual([]);
  });

  it("JS: ingen el.hidden / classList.hidden-toggling som taper cascaden", () => {
    const problems = jsCases
      .filter((c) => !c.verdict.hides)
      .map((c) => `${c.file}:${c.line} [${c.mechanism}] ${c.variable} → ${c.target.page.file}:${c.target.element.line}`
        + ` — vinner: ${c.verdict.by}`);

    expect(
      problems,
      "\nDisse togglingene gjør ingenting — elementet blir stående synlig.\n"
        + "Bruk setHidden(el, on) fra /static/dom-visibility.js.\n\n"
        + problems.join("\n"),
    ).toEqual([]);
  });

  it("ingen CSS-lapp patcher fella i stedet for å bruke setHidden", () => {
    // Mønster 3 i doc/COMPLEXITY_SCAN.md: en fiks oppå en fiks. `.state-rail[hidden]`,
    // `.course-discussion-body[hidden]` og `.course-inline-panel[hidden]` var tre slike — hver av
    // dem gjenoppretter `display:none` for ETT element i stedet for å fjerne årsaken. De skjuler
    // også at fella finnes, så neste element med samme klasse får feilen på nytt.
    const sources = [
      ...walk(PUBLIC, ".css").map((f) => ({ file: relOf(f), text: read(f) })),
      ...walk(PUBLIC, ".html").flatMap((f) => {
        const src = read(f);
        return [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => ({ file: relOf(f), text: m[1] }));
      }),
    ];

    // Kontroll: uten CSS å lese blir denne testen grønn av ingenting.
    expect(sources.length, "fant ingen CSS-kilder å lese").toBeGreaterThan(3);

    const patches = [];
    for (const { file, text } of sources) {
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, (s) => " ".repeat(s.length));
      for (const m of stripped.matchAll(/([^{}]*\[hidden\][^{}]*)\{([^{}]*)\}/g)) {
        if (!/display\s*:\s*none/i.test(m[2])) continue;
        patches.push(`${file}:${stripped.slice(0, m.index).split("\n").length} — ${m[1].trim()}`);
      }
    }

    expect(
      patches,
      "\nEn `[hidden]`-regel som setter display:none er en lapp oppå .hidden-fella, ikke kuren.\n"
        + "Fjern regelen og bruk setHidden(el, on) på elementet i stedet.\n\n"
        + patches.join("\n"),
    ).toEqual([]);
  });
});
