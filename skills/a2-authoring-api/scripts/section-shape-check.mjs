// #1126: a section teaches; it is not a catalogue. What can be counted in a section's markdown, and
// was counted on the 106 sections of the 15 stage courses (2026-10-26) before a rule was set:
//
//   summaries     more than one summary heading in a section — «Formål», «Nøkkelpoeng» and «Kort
//                 oppsummering» in the same section. Stage: 16 of 106 sections, in two courses, every
//                 one with all three, and every «Formål» written to the author («Denne seksjonen viser
//                 …»). A whole heading only: «Formål og målgruppe» (a standard's purpose) and
//                 «Sammendrag og utforsking av et dokument» (a feature) are subjects, not summaries.
//                 Always wrong, and the fix is mechanical — keep one — so the skill STOPS on it.
//   callouts      more than one highlighted box (a quote that opens with a bold label) in a section.
//                 Stage, boxes per section: 0 → 35, 1 → 27, 2 → 21, 3 → 13, 4 → 7, 5 → 3 (44 of 106 over
//                 one); «Husk | Tips | Neste steg», «Viktig | Sertifisering», «Hovedpoenget | Viktig |
//                 Hovedpoenget | Husk», «NB | NB! Sjekk talespråket | Viktig | NB!». A NOTE: a box the
//                 source sets apart is kept by the presentation workflow, and only the author can say
//                 which one carries a consequence. The piece of work in a «finn feilene» (a labelled
//                 quote right above the `:::skriv` frame) is the exercise, not a box;
//                 the dated box for a tool's product details («Gjelder per oktober 2026») is not one either.
//   long lists    a list of LIST_MAX_ITEMS + 1 points or more. Stage: 17 lists in 10 sections, 9–13
//                 points — «tid, minne, rettigheter, nettverk, policy, …», a report's 13 chapters, a
//                 nine-step process. A NOTE: a table of contents or a list of objectives may stay.
//   self-description  a sentence where the section describes itself instead of teaching: «Denne
//                 seksjonen viser hvordan …», «This section explains …». Stage: 23 of 106 sections, in
//                 five courses, in all three languages. A NOTE: an overview line may be the author's
//                 choice; the learner is better served by the point itself.
//
// Callouts and lists are read in one language (the translation keeps the shape — the languages check
// counts the boxes); summaries and self-descriptions are words, read in every language. Fenced code is
// left out — a prompt may say anything.
//
// Node stdlib only, pure.

export const CALLOUT_MAX = 1;
export const LIST_MAX_ITEMS = 8;

/** The lines of the markdown with fenced code blocks blanked out (line numbers kept). */
function proseLines(markdown) {
  let fence = null;
  return String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const open = /^\s*(```|~~~)/.exec(line);
    if (open) {
      fence = fence === null ? open[1] : fence === open[1] ? null : fence;
      return "";
    }
    return fence === null ? line : "";
  });
}

// A heading that IS a summary, in nb, nn or en-GB — the whole heading, once its icon, number, bold
// and closing colon are taken off.
const SUMMARY_HEADING = new RegExp(
  "^(?:" +
    [
      "formål", "føremål", "purpose",
      "(?:kort )?oppsummering", "oppsummert", "(?:kort )?sammendrag", "(?:kort )?samandrag", "kort fortalt",
      "nøkkelpoeng(?:ene|a)?", "nøkkelpunkt(?:er|a|ene)?", "hovedpoeng(?:et|ene)?", "hovudpoeng(?:et|a)?",
      "hovedpunkt(?:er|ene)?", "hovudpunkt(?:a)?",
      "det viktigste(?: fra denne seksjonen)?", "det viktigaste(?: frå denne seksjonen)?",
      "(?:brief |short )?summary", "in summary", "in short",
      "(?:the )?key points(?: from this section)?", "key takeaways", "takeaways", "main points",
    ].join("|") +
    ")$",
  "i",
);

function headingText(line) {
  const heading = /^ {0,3}#{1,6}[ \t]+(.*)$/.exec(line);
  if (!heading) return null;
  return heading[1]
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[*_`]/g, "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/[\s:.!]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The summary headings in one text: «Formål», «Nøkkelpoeng», «Kort oppsummering» … in reading order. */
export function summaryHeadings(markdown) {
  const found = [];
  for (const line of proseLines(markdown)) {
    const text = headingText(line);
    if (text && SUMMARY_HEADING.test(text)) found.push(text);
  }
  return found;
}

const FRAME_OPEN = /^:::[ \t]*\S/;
const FRAME_CLOSE = /^:::[ \t]*$/;
const WRITE_FRAME = /^:::[ \t]*(?:skriv|write)\b/i;
// The skill's own callout, as slide-coverage counts it: a quote whose first line opens with bold.
const CALLOUT_START = /^ {0,3}>[ \t]*\*\*([^*\n]+)\*\*/;
// The dated box for a tool's product details («Gjelder per oktober 2026: …») is its own kind — the
// guidance asks for one per tool, beside the one box with a consequence.
const DATED_BOX = /^(?:(?:gjelder|gjeld)\s+(?:nå|no|per|fra|frå)|(?:current\s+)?as\s+of)(?!\p{L})/iu;

/**
 * The highlighted boxes in one text, by label — not the piece of work right above a «finn feilene»,
 * and not the dated box for product details.
 */
export function callouts(markdown) {
  const lines = proseLines(markdown);
  const found = [];
  let inQuote = false;
  for (let at = 0; at < lines.length; at += 1) {
    const quoted = /^ {0,3}>/.test(lines[at]);
    const start = quoted && !inQuote ? CALLOUT_START.exec(lines[at]) : null;
    inQuote = quoted;
    if (!start) continue;
    let next = at + 1;
    while (next < lines.length && (/^ {0,3}>/.test(lines[next]) || lines[next].trim() === "")) next += 1;
    if (next < lines.length && WRITE_FRAME.test(lines[next])) continue;
    const label = start[1].replace(/[\s:]+$/, "").trim();
    if (DATED_BOX.test(label)) continue;
    found.push(label);
  }
  return found;
}

const LIST_ITEM = /^ {0,3}(?:([-*+])|\d{1,3}[.)])[ \t]+\S/;

/** Lists of more than LIST_MAX_ITEMS points: [{ items, first }]. Not inside a frame (pairs, options). */
export function longLists(markdown) {
  const found = [];
  let run = 0;
  let first = "";
  let kind = null;
  let inFrame = false;
  const flush = () => {
    if (run > LIST_MAX_ITEMS) found.push({ items: run, first });
    run = 0;
    kind = null;
  };
  for (const line of proseLines(markdown)) {
    if (FRAME_CLOSE.test(line)) {
      flush();
      inFrame = false;
      continue;
    }
    if (FRAME_OPEN.test(line)) {
      flush();
      inFrame = true;
      continue;
    }
    if (inFrame) continue;
    const item = LIST_ITEM.exec(line);
    if (item) {
      const itemKind = item[1] ? "bullet" : "number";
      if (kind !== itemKind) flush();
      if (run === 0) first = line.replace(/^ {0,3}(?:[-*+]|\d{1,3}[.)])[ \t]+/, "").trim();
      kind = itemKind;
      run += 1;
      continue;
    }
    // A blank line, or a line indented under the point, keeps the list going.
    if (line.trim() === "" || /^(?: {2,}|\t)\S/.test(line)) continue;
    flush();
  }
  flush();
  return found;
}

// The section as the subject of a verb that describes it, in nb, nn and en-GB. «I denne seksjonen»
// and «Etter denne seksjonen skal du …» are not caught: the section is not what speaks there.
// `(?!\p{L})`, not `\b`: «på» ends in a letter `\b` does not know, so «svarer på» never matched.
const SELF_DESCRIPTION = [
  /\b(?:denne|dette) (?:seksjonen|delen|kapittelet|leksjonen)\s+(?:viser|forklarer|går gjennom|gjennomgår|introduserer|presenterer|sammenligner|beskriver|handler om|tar for seg|ser på|svarer på|konsentrerer seg om|gir (?:deg )?en (?:innføring|oversikt))(?!\p{L})[^.\n]{0,50}/iu,
  /\b(?:denne|dette) (?:seksjonen|delen|kapitlet|leksjonen)\s+(?:viser|forklarar|går gjennom|introduserer|presenterer|samanliknar|skildrar|handlar om|tek for seg|ser på|svarar på|konsentrerer seg om|gir (?:deg )?ei (?:innføring|oversikt))(?!\p{L})[^.\n]{0,50}/iu,
  /\bthis (?:section|part|chapter|lesson)\s+(?:shows|explains|covers|introduces|presents|compares|describes|is about|looks at|answers|concentrates on|focuses on|walks you through|goes through|gives (?:you )?an? (?:introduction|overview))\b[^.\n]{0,50}/i,
];

/** The first sentence where the section describes itself, or null. */
export function selfDescription(markdown) {
  const text = proseLines(markdown).join("\n");
  for (const pattern of SELF_DESCRIPTION) {
    const match = pattern.exec(text);
    if (match) return match[0].trim();
  }
  return null;
}
