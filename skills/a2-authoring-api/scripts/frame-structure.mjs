// #1109: formen på rammene i en tekst — ÉN tabell over rammetypene og hva som telles i hver, delt av
// skillets språkkontroll (localization-check.mjs) og plattformens oversetter
// (src/modules/adminContent/translationStructureGuard.ts, via `#frame-structure` i package.json).
//
// Hvorfor: en oversettelse skal ha nøyaktig de samme rammene som kilden — like mange av hver type, samme
// fasit i hver «sjekk deg selv», like mange steg, kort og sjekkpunkter. Ellers ser deltakeren feil fasit
// eller markørene som tekst. Skillet hadde kontrollen; plattformens egen oversetter hadde den ikke.
//
// ⚠️ NY RAMME ELLER NY DEL AV EN RAMME: én oppføring i FRAME_KINDS under, ikke en ny kontroll et annet
// sted. Begge veiene (skillet og plattformen) leser tabellen. `drawnAs` er klassen plattformens HTML gir
// rammen når den TEGNES (src/modules/course/contentBlocks.ts); bare plattformen bruker den, fordi bare
// den har tegneren.
//
// Reglene er de samme som i contentBlocks.ts: samme åpningslinjer (markørord, tittel påkrevd, valgfri
// eller ingen), samme lukkelinje, og en ramme som ikke ville blitt tegnet (to riktige svar, færre enn to
// steg, tomt eksempelsvar), er ingen ramme. Overskriftene i en ramme telles av `countHeadings`: skillet
// har ingen markdown-leser og teller linjer (`countHeadingLines`); plattformen sender inn markeds egen
// lesing, som også ser at en overskrift i en liste eller en kodeblokk ikke begynner et steg.
//
// Node stdlib only, pure, repo-testable (test/unit/frame-structure-1109.test.ts).

/** Et alternativ i «sjekk deg selv»: `- [ ]` eller `- [x]` (også `*` og stor X) og tekst etter. */
const CHECK_OPTION = /^[ \t]*[-*][ \t]+\[([ xX])\][ \t]+\S/;
/** En linje i sjekklista i «skriv selv»: samme form; en `x` godtas og betyr det samme. */
const WRITE_CHECK_ITEM = /^[ \t]*[-*][ \t]+\[[ xX]\][ \t]+\S/;
/** En ATX-overskrift slik marked leser den: inntil tre mellomrom, 1–6 #, så mellomrom eller linjeslutt. */
const HEADING_LINE = /^ {0,3}#{1,6}(?=[ \t]|$)/;
/** Åpningen på en kodeblokk med gjerder (``` eller ~~~). */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** Kodeblokkene i en tekst: en funksjon som sier om en linje er i en kodeblokk (gjerdene medregnet). */
function fenceTracker() {
  let fence = null;
  return (line) => {
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
      if (close.test(line)) fence = null;
      return true;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = open[1];
      return true;
    }
    return false;
  };
}

/**
 * Overskriftene i en tekst, linje for linje, utenfor kodeblokker. Skillets lesing: den ser ikke en
 * setext-overskrift (tekst med === under) og teller en innrykket overskrift i en liste. Plattformen
 * bruker markeds egen lesing i stedet (se toppen av fila).
 */
export function countHeadingLines(text) {
  const inFence = fenceTracker();
  let count = 0;
  for (const line of String(text ?? "").split("\n")) {
    if (inFence(line)) continue;
    if (HEADING_LINE.test(line)) count += 1;
  }
  return count;
}

/** #1110: følgen til et alternativ — en innrykket linje (to mellomrom eller en tabulator) under det. */
const CHECK_FEEDBACK = /^(?: {2,}|\t)[ \t]*\S/;

/**
 * Fasiten i en «sjekk deg selv»: "010" = det andre av tre alternativer er riktig; "0f1" = det første har en
 * følge (#1110). `null` = ikke tegnet. En følge som forsvant eller flyttet seg i en oversettelse, gir en
 * annen form — deltakeren ville fått følgen på feil valg, eller ingen.
 */
function checkShape(inner) {
  const lines = inner.split("\n");
  let at = 0;
  while (at < lines.length && lines[at].trim() === "") at += 1;
  let pattern = "";
  while (at < lines.length) {
    const option = CHECK_OPTION.exec(lines[at]);
    if (option) pattern += option[1].toLowerCase() === "x" ? "1" : "0";
    else if (pattern !== "" && CHECK_FEEDBACK.test(lines[at])) {
      if (!pattern.endsWith("f")) pattern += "f";
    } else break;
    at += 1;
  }
  // contentBlocks.ts: minst to alternativer og nøyaktig ett riktig, ellers ingen blokk.
  const options = pattern.replace(/f/g, "");
  if (options.length < 2 || options.replace(/0/g, "").length !== 1) return null;
  return pattern;
}

/**
 * #1107: et par i «finn parene» — `- begrep = forklaring`, delt ved første « = » utenfor et kodespenn.
 * Samme regel som splitPairLine i src/modules/course/contentBlocks.ts.
 */
function splitPairLine(line) {
  const item = /^[ \t]*[-*][ \t]+(\S.*?)[ \t]*$/.exec(line);
  if (!item) return null;
  const body = item[1];
  let inCode = false;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === "`") inCode = !inCode;
    if (inCode || (body[i] !== " " && body[i] !== "\t")) continue;
    const sep = /^[ \t]+=[ \t]+/.exec(body.slice(i));
    if (!sep) continue;
    const term = body.slice(0, i).trim();
    const def = body.slice(i + sep[0].length).trim();
    if (term && def) return { term, def };
  }
  return null;
}
const comparablePairText = (text) => text.replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** «Finn parene»: antall par. `null` = ikke tegnet (en linje som ikke er et par, færre enn tre, like par). */
function pairsShape(inner) {
  const pairs = [];
  for (const line of inner.split("\n")) {
    if (line.trim() === "") continue;
    const pair = splitPairLine(line);
    if (!pair) return null;
    pairs.push(pair);
  }
  if (pairs.length < 3) return null;
  const distinct = (values) => new Set(values.map(comparablePairText)).size === values.length;
  if (!distinct(pairs.map((p) => p.term)) || !distinct(pairs.map((p) => p.def))) return null;
  return String(pairs.length);
}

/**
 * #1123: fasiten i «finn feilene» — "01f1" = den andre og fjerde setningen er feil, og den andre har en
 * forklaring. `null` = ikke tegnet (samme regel som splitErrorSentences i contentBlocks.ts: hver linje som
 * ikke er tom, er en setning eller en forklaring; minst tre setninger, minst én feil og minst én som stemmer).
 * En feil som flyttet seg eller mistet forklaringen i en oversettelse, gir en annen form.
 */
function errorsShape(inner) {
  let pattern = "";
  for (const line of inner.split("\n")) {
    if (line.trim() === "") continue;
    const sentence = CHECK_OPTION.exec(line);
    if (sentence) pattern += sentence[1].toLowerCase() === "x" ? "1" : "0";
    else if (pattern !== "" && CHECK_FEEDBACK.test(line)) {
      if (!pattern.endsWith("f")) pattern += "f";
    } else return null;
  }
  const sentences = pattern.replace(/f/g, "");
  const errors = sentences.replace(/0/g, "").length;
  if (sentences.length < 3 || errors === 0 || errors === sentences.length) return null;
  return pattern;
}

/** Antall punkter i sjekklista i «skriv selv». `null` = ikke tegnet (eksempelsvaret er tomt). */
function writeShape(inner) {
  const lines = inner.split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end -= 1;
  let start = end;
  while (start > 0 && WRITE_CHECK_ITEM.test(lines[start - 1])) start -= 1;
  if (lines.slice(0, start).join("\n").trim() === "") return null;
  return String(end - start);
}

/** Steg og repetisjonskort: antall elementer (overskrifter); færre enn to tegnes ikke. */
function itemsShape(inner, read) {
  const items = read.countHeadings(inner);
  return items < 2 ? null : String(items);
}

/**
 * Rammetypene. `words` er markørordene (det engelske er samme ramme). `opener` er hva som står etter
 * markørordet på åpningslinja: "text" (påkrevd — spørsmålet, oppgaven), "optional" (en tittel) eller
 * "none". `shape(inner, read)` gir formen som skal være lik i en oversettelse, som tekst — eller `null`
 * når rammen ikke ville blitt tegnet. `counts` sier hva formen er, til meldinger.
 *
 * ⚠️ Rekkefølgen og ordene følger contentBlocks.ts. Endrer du hvordan en ramme leses der, endre den her.
 */
export const FRAME_KINDS = Object.freeze([
  { kind: "tenk", words: ["tenk", "think"], opener: "text", drawnAs: 'class="content-think"', counts: "the frame itself", shape: () => "" },
  { kind: "sjekk", words: ["sjekk", "check"], opener: "text", drawnAs: 'class="content-check"', counts: "the right option (- [x]) among the options", shape: checkShape },
  { kind: "kort", words: ["kort", "cards"], opener: "none", drawnAs: 'class="content-cards"', counts: "cards (headings)", shape: (inner, read) => String(read.countHeadings(inner)) },
  { kind: "steg", words: ["steg", "steps"], opener: "optional", drawnAs: 'class="content-steps"', counts: "steps (headings)", shape: itemsShape },
  { kind: "skriv", words: ["skriv", "write"], opener: "text", drawnAs: 'class="content-write"', counts: "checklist points (- [ ] at the end)", shape: writeShape },
  { kind: "repetisjon", words: ["repetisjon", "flashcards"], opener: "optional", drawnAs: 'class="content-flash"', counts: "cards (headings)", shape: itemsShape },
  { kind: "par", words: ["par", "pairs"], opener: "optional", drawnAs: 'class="content-pairs"', counts: "pairs (- term = explanation)", shape: pairsShape },
  { kind: "feil", words: ["feil", "errors"], opener: "optional", drawnAs: 'class="content-errors"', counts: "the wrong sentences (- [x]) among the sentences", shape: errorsShape },
]);

/** Åpningslinja, innholdet og lukkelinja for én rammetype — samme uttrykk som tokenizeren i contentBlocks.ts. */
function frameExpression(entry) {
  const words = entry.words.join("|");
  const opening = {
    text: `:::[ \\t]*(?:${words})[ \\t]+[^\\n]*\\S[ \\t]*`,
    optional: `:::[ \\t]*(?:${words})(?:[ \\t]+[^\\n]*?)?[ \\t]*`,
    none: `:::[ \\t]*(?:${words})[ \\t]*`,
  }[entry.opener];
  // `y`: bare akkurat der vi står (en linjestart). `m`: `$` er linjeslutt, som `(?=\r?\n|$)` i tegneren.
  return new RegExp(`^${opening}\\n([\\s\\S]*?)\\n:::[ \\t]*$`, "imy");
}

const EXPRESSIONS = new Map(FRAME_KINDS.map((entry) => [entry, frameExpression(entry)]));

/**
 * Rammene i en tekst, i rekkefølge: `[{ kind, shape }]`. Bare rammer som ville blitt tegnet; en ramme i
 * en kodeblokk er ingen ramme. Windows-linjeskift leses som vanlige.
 *
 * @param {string} text
 * @param {{ countHeadings?: (inner: string) => number }} [options]
 */
export function readFrames(text, options = {}) {
  const read = { countHeadings: options.countHeadings ?? countHeadingLines };
  const src = String(text ?? "").replace(/\r\n?/g, "\n");
  const inFence = fenceTracker();
  const frames = [];
  let at = 0;
  while (at <= src.length) {
    const lineEnd = src.indexOf("\n", at) < 0 ? src.length : src.indexOf("\n", at);
    const line = src.slice(at, lineEnd);
    if (!inFence(line) && line.startsWith(":::")) {
      let matched = null;
      for (const entry of FRAME_KINDS) {
        const expression = EXPRESSIONS.get(entry);
        expression.lastIndex = at;
        const match = expression.exec(src);
        if (!match) continue;
        const shape = entry.shape(match[1], read);
        // Ikke tegnet: tegneren leser da linja som vanlig tekst og går videre til neste linje. Det gjør vi også.
        if (shape !== null) matched = { kind: entry.kind, shape, end: at + match[0].length };
        break;
      }
      if (matched) {
        frames.push({ kind: matched.kind, shape: matched.shape });
        at = matched.end + 1;
        continue;
      }
    }
    at = lineEnd + 1;
  }
  return frames;
}

/** Rammene som tekst, én per ramme: "sjekk:010", "steg:4", "tenk". */
export function frameSignature(text, options = {}) {
  return readFrames(text, options).map(({ kind, shape }) => (shape === "" ? kind : `${kind}:${shape}`));
}

/**
 * Hva en oversettelse har endret i rammene. Tom liste = samme rammer, samme form.
 *
 * - `{ kind, problem: "count", expected, actual }`: et annet antall rammer av typen (en mangler, eller en
 *   er kommet til). Da sammenlignes ikke formen i den typen — rammene kan ikke pares.
 * - `{ kind, problem: "shape", position, expected, actual }`: ramme nr. `position` (fra 1, innen typen)
 *   har en annen form — fasiten flyttet, et steg, kort eller sjekkpunkt forsvant eller kom til.
 *
 * Det engelske markørordet er samme ramme: `:::check` i en engelsk tekst er `:::sjekk`.
 *
 * @param {string} source
 * @param {string} translated
 * @param {{ countHeadings?: (inner: string) => number }} [options]
 */
export function compareFrames(source, translated, options = {}) {
  const before = readFrames(source, options);
  const after = readFrames(translated, options);
  const problems = [];
  for (const { kind } of FRAME_KINDS) {
    const a = before.filter((frame) => frame.kind === kind);
    const b = after.filter((frame) => frame.kind === kind);
    if (a.length !== b.length) {
      problems.push({ kind, problem: "count", expected: a.length, actual: b.length });
      continue;
    }
    a.forEach((frame, index) => {
      if (frame.shape !== b[index].shape) {
        problems.push({ kind, problem: "shape", position: index + 1, expected: frame.shape, actual: b[index].shape });
      }
    });
  }
  return problems;
}

/** Én linje engelsk per avvik, til logg og API-konsumenter uten oversettelsestabell. */
export function describeFrameProblem(problem) {
  const entry = FRAME_KINDS.find((candidate) => candidate.kind === problem.kind);
  const name = `:::${problem.kind}`;
  if (problem.problem === "count") return `${name}: ${problem.expected} frame(s) in the source, ${problem.actual} in the translation`;
  if (problem.problem === "drawn") return `${name}: ${problem.expected} drawn in the source, ${problem.actual} in the translation`;
  // #1112: the source has a frame the platform does not draw (no blank line above it); fix the source.
  if (problem.problem === "sourceNotDrawn") return `${name}: the source has a frame that is not drawn (${problem.expected} drawn, ${problem.actual} in the translation) — add a blank line above it in the source`;
  return `${name} no. ${problem.position}: ${entry?.counts ?? "shape"} differs (${problem.expected} in the source, ${problem.actual} in the translation)`;
}
