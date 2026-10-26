// #1119: varslene fra skillets hint-kontroll (src/modules/adminContent/mcqCueWarnings.ts) som tekst
// på forfatterens språk. Ett sted, så generering, lagring og import sier det likt.
//
// Et varsel er `{ code, question, count? }`. En kode uten tekst i oversettelsene vises ikke — heller
// enn som en rå nøkkel.

/** @returns {string[]} én linje per varsel */
export function describeCueWarnings(warnings, t, tf) {
  if (!Array.isArray(warnings)) return [];
  return warnings
    .map((w) => {
      const key = `mcqCue.${w?.code}`;
      if (t(key) === key) return "";
      return tf(key, { question: w.question ?? "", count: w.count ?? "" });
    })
    .filter(Boolean);
}

/** Kursimport: én linje per test med funn, «Tittel: …». */
export function describePackageCueWarnings(sets, t, tf, titleOf) {
  if (!Array.isArray(sets)) return [];
  return sets
    .map((set) => {
      const lines = describeCueWarnings(set?.warnings, t, tf);
      if (lines.length === 0) return "";
      const title = titleOf(set?.title);
      return title ? `${title}: ${lines.join(" ")}` : lines.join(" ");
    })
    .filter(Boolean);
}
