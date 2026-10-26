// #1121: an exercise whose answer key stands word for word in the text right above it is a copying
// exercise. The learner who copies scores as high as the one who understood — and retrieval only works
// when it costs an effort. The exercise takes ANOTHER situation than the example before it.
//
// Measured on the 15 stage courses (2026-10-26, 27 exercises) before the thresholds were set; every
// hit was real (a «skriv selv» whose example answer is the example six lines up, «finn parene» that
// repeats the table right above it):
//   :::skriv  the example answer: at least SHARE_MAX of its words in runs of WRITE_RUN words from the
//             text above — 2 of 10.
//   :::par    the explanations: on average SHARE_MAX of their words in runs of PAIRS_RUN — 2 of 4.
//             Shorter runs, since an explanation is a few words.
//   :::sjekk  the right option: SHARE_MAX in runs of WRITE_RUN, while no wrong option reaches half
//             of that — 1 of 13. A wrong option that repeats the text too is not a cue.
// "The text above" is the section up to the frame. The same counting as the question check
// (text-overlap.mjs).
//
// Node stdlib only, pure.

import { coveredShare, nGrams, wordsOf } from "./text-overlap.mjs";

export const SHARE_MAX = 0.5;
export const WRITE_RUN = 6;
export const PAIRS_RUN = 4;

const OPENER = /^:::\s*(skriv|write|par|pairs|sjekk|check)\b/i;
const KIND = { skriv: "skriv", write: "skriv", par: "par", pairs: "par", sjekk: "sjekk", check: "sjekk" };

/** Every exercise frame in a section's markdown, with the text above it. Fenced code is skipped. */
export function readExercises(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const found = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const fenceMatch = /^\s*(```|~~~)/.exec(lines[i]);
    if (fenceMatch) {
      fence = fence === null ? fenceMatch[1] : fence === fenceMatch[1] ? null : fence;
      continue;
    }
    if (fence !== null) continue;
    const opener = OPENER.exec(lines[i]);
    if (!opener) continue;
    let end = i + 1;
    while (end < lines.length && lines[end].trim() !== ":::") end++;
    found.push({ kind: KIND[opener[1].toLowerCase()], line: i + 1, opener: lines[i], inner: lines.slice(i + 1, end), above: lines.slice(0, i).join("\n") });
    i = end;
  }
  return found;
}

const percent = (share) => `${Math.round(share * 100)} %`;

/** Findings for one section's markdown: [{ line, kind, detail }]. */
export function checkExerciseCopies(markdown) {
  const findings = [];
  for (const exercise of readExercises(markdown)) {
    const aboveWords = wordsOf(exercise.above);
    if (exercise.kind === "skriv") {
      const answer = exercise.inner.filter((line) => !/^\s*- \[ \]/.test(line)).join("\n");
      const share = coveredShare(answer, nGrams(aboveWords, WRITE_RUN), WRITE_RUN);
      if (share >= SHARE_MAX) {
        findings.push({ line: exercise.line, kind: "skriv", detail: `the example answer of «${exercise.opener.slice(0, 60)}» stands ${percent(share)} word for word in the text above — the learner copies it. Give the task another situation than the example before it.` });
      }
    } else if (exercise.kind === "par") {
      const explanations = exercise.inner.filter((line) => /^\s*-\s.+=/.test(line)).map((line) => line.split("=").slice(1).join("="));
      if (explanations.length === 0) continue;
      const grams = nGrams(aboveWords, PAIRS_RUN);
      const share = explanations.reduce((sum, text) => sum + coveredShare(text, grams, PAIRS_RUN), 0) / explanations.length;
      if (share >= SHARE_MAX) {
        findings.push({ line: exercise.line, kind: "par", detail: `the explanations in «${exercise.opener.slice(0, 60)}» stand ${percent(share)} word for word in the text above — the learner matches the wording, not the meaning. Explain each term in other words, or let the pairs come before the text that lists them.` });
      }
    } else {
      const grams = nGrams(aboveWords, WRITE_RUN);
      const right = exercise.inner.filter((line) => /^- \[x\]/i.test(line)).join("\n");
      const wrong = exercise.inner.filter((line) => /^- \[ \]/.test(line));
      const share = coveredShare(right, grams, WRITE_RUN);
      const wrongShare = Math.max(0, ...wrong.map((line) => coveredShare(line, grams, WRITE_RUN)));
      if (share >= SHARE_MAX && wrongShare < share / 2) {
        findings.push({ line: exercise.line, kind: "sjekk", detail: `the right option of «${exercise.opener.slice(0, 60)}» repeats the text above (${percent(share)}) and the wrong ones do not — the learner recognises the wording. Say it as it would come up in the work.` });
      }
    }
  }
  return findings;
}
