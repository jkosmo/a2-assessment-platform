// #1083: måler hvor mye minne SVG-rensingen holder igjen per kall. Kjøres som egen prosess med
// `node --expose-gc --import tsx`, fordi det som skal måles er heapen ETTER opprydding, og den får
// man bare bedt om utenfra testkjøreren. Skriver ett JSON-objekt til stdout.
//
// ⚠️ Mellom hvert kall gis kontrollen tilbake til hendelsesløkka, slik det skjer mellom to
// forespørsler på tjeneren. Uten det holder Node på alt som er nådd gjennom en WeakRef til turen er
// over, og en synkron løkke ser ut som en lekkasje også når ingenting holdes igjen. Den første
// målingen av denne feilen ble gjort slik, og «bekreftet» en lekkasje i kode som ikke hadde noen.
import { applySvgTextTranslations, extractSvgTexts, isSvgReadableAsImage, sanitizeSvg } from "../../src/modules/course/svgSanitizer.js";

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error("kjør med --expose-gc");
const pust = () => new Promise<void>((ferdig) => setImmediate(ferdig));
const heapMb = () => { gc(); gc(); return process.memoryUsage().heapUsed / 1024 / 1024; };

// Rundt 5 kB: omtrent som en nytegnet flytfigur med etiketter.
const figur = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 200">${Array.from({ length: 60 }, (_, i) => `<rect x="${i}" y="${i}" width="40" height="20" fill="#eef"/><text x="${i}" y="${i}">Steg ${i}</text>`).join("")}</svg>`;
const renset = sanitizeSvg(figur);

const veier: Record<string, () => void> = {
  sanitizeSvg: () => { sanitizeSvg(figur); },
  isSvgReadableAsImage: () => { isSvgReadableAsImage(renset); },
  extractSvgTexts: () => { extractSvgTexts(renset); },
  applySvgTextTranslations: () => { applySvgTextTranslations(renset, { "Steg 1": "Step 1" }); },
};

const antall = Number(process.argv[2] ?? 60);
const resultat: Record<string, number> = {};
for (const [navn, kjør] of Object.entries(veier)) {
  kjør();
  await pust();
  const før = heapMb();
  for (let i = 0; i < antall; i++) { kjør(); await pust(); }
  await pust();
  resultat[navn] = Math.round(((heapMb() - før) * 1024) / antall);
}
console.log(JSON.stringify({ figurBytes: figur.length, antall, holdtIgjenKbPerKall: resultat }));
