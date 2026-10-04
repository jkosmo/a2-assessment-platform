// #1083: kjører lesbarhetskontrollen på én stor og tett figur og skriver svaret som JSON. Kjøres som
// egen prosess med lav heap-grense (`--max-old-space-size`), fordi det som skal måles er om
// kontrollen bygger et dokument av figuren: gjør den det, går prosessen tom for minne og dør.
import { isSvgReadableAsImage } from "../../src/modules/course/svgSanitizer.js";

const megabyte = Number(process.argv[2] ?? 4);
let innhold = "";
for (let i = 0; innhold.length < megabyte * 1024 * 1024; i++) {
  innhold += `<rect x="${i}" y="1" width="1" height="1"/><text x="1" y="2">Steg ${i}</text>`;
}
const figur = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${innhold}</svg>`;

console.log(JSON.stringify({ figurBytes: figur.length, lesbar: isSvgReadableAsImage(figur) }));
