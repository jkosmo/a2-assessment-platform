// #1128 / #1129: what the learner reads must not carry the author's leftovers, and a picture must be
// described, not titled. Measured on the 15 stage courses (2026-10-26) before the rules were set.
//
//   alt text   #1128: a picture's alt text (`![alt](asset:…)`) of fewer than ALT_MIN_WORDS words is a
//              title, not a description — «Enhetstest», «Git i en QA-runde». A screen reader gets
//              nothing of the content. Stage: 44 of 121 under 6 words, nearly all titles; 65 had 12 or
//              more. Icons (`icon:`) are exempt: they repeat the heading and have empty alt text.
//   leftovers  #1129: working notes («[Avklaring: …]», «før kurset publiseres», «godkjent
//              læringsseksjon», «godkjente moduler») — 8 on stage; a reference to a section by number
//              («behandles i Seksjon 3b») — the learner sees titles, and a number breaks when the
//              order changes; figures numbered out of order (6 → 8 → 10 → 7).
//
// ONE file for the skill and the platform (`#section-text-check`): the skill stops; the platform shows
// the alt-text rule as a warning. Fenced code is left out — a prompt may say anything.
//
// Node stdlib only, pure.

export const ALT_MIN_WORDS = 6;

const words = (text) => String(text ?? "").match(/[\p{L}\p{N}]+/gu) ?? [];

/** The markdown with fenced code blocks blanked out (line numbers kept). */
function withoutFences(markdown) {
  let fence = null;
  return String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const open = /^\s*(```|~~~)/.exec(line);
    if (open) {
      fence = fence === null ? open[1] : fence === open[1] ? null : fence;
      return "";
    }
    return fence === null ? line : "";
  }).join("\n");
}

/** Pictures whose alt text is a title: [{ alt, words }]. */
export function checkAltTexts(markdown) {
  const findings = [];
  for (const match of withoutFences(markdown).matchAll(/!\[([^\]]*)\]\(asset:[^)]+\)/g)) {
    const count = words(match[1]).length;
    if (count < ALT_MIN_WORDS) findings.push({ alt: match[1], words: count });
  }
  return findings;
}

const NOTES = [
  /\[\s*(?:Avklaring|Clarification)\b[^\]]*\]?/i,
  /\bfør kurset publiseres\b/i,
  /\bbefore the course is published\b/i,
  /\bgodkjente? læringsseksjon(?:er|ar)?\b/i,
  /\bgodkjente modul(?:er|ar)\b/i,
];
const SECTION_NUMBER = /\b(?:seksjon(?:ane|ene)?|section)\s+\d+[a-z]?\b/i;

/** Working notes and section references by number in one text: [{ kind, text }]. */
export function checkLeftovers(markdown) {
  const findings = [];
  const text = withoutFences(markdown);
  for (const pattern of NOTES) {
    const match = pattern.exec(text);
    if (match) findings.push({ kind: "note", text: match[0].slice(0, 80) });
  }
  const reference = SECTION_NUMBER.exec(text);
  if (reference) findings.push({ kind: "section_number", text: reference[0] });
  return findings;
}

const FIGURE_CAPTION = /(?:^|\n)\s*[*_]?(?:Figur|Figure)\s+(\d+)[.:]/gi;

/** Figure captions numbered out of order across the texts, in reading order: [{ expected, actual }]. */
export function checkFigureNumbers(markdowns) {
  const numbers = [];
  for (const markdown of markdowns) {
    for (const match of withoutFences(markdown).matchAll(FIGURE_CAPTION)) numbers.push(Number(match[1]));
  }
  const findings = [];
  numbers.forEach((actual, index) => {
    if (actual !== index + 1) findings.push({ expected: index + 1, actual });
  });
  return findings.length > 0 ? [{ expected: findings[0].expected, actual: findings[0].actual, order: numbers }] : [];
}
