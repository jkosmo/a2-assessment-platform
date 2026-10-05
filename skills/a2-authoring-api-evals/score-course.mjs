// Teller opp et ferdig kurs mot et testtilfelle: hva ble det av hvert lysark i kilden?
//
// Et testtilfelle (cases/*.json) sier for hvert lysark med faglig innhold hva det ER (flyt, kort,
// skjermbilde av en prompt …), hvilke behandlinger som er riktige, og noen få ord som bare det
// lysarket har. Kurset er pakka skillet lager (a2-authoring-package/v1) eller en eksport fra
// plattformen (a2-content-export/v1). Skriptet trenger ikke presentasjonen.
//
// Det som telles, er valgt fordi det kan telles: et tall som går opp når skillet blir bedre til å
// ta vare på kilden, og ned når det ikke gjør det. Om kurset er GODT, sier tallene ikke — det er
// fortsatt forfatterens blikk, og punktene under `manuellSjekk` i testtilfellet.
//
// Node stdlib, rene funksjoner. Bruk:
//   node score-course.mjs cases/rapportskriving.json kurs.json [--json]
//   import { scoreCourse, readCourse } from "./score-course.mjs"

import { readFileSync } from "node:fs";

/** Behandlinger som i praksis er «innholdet står som tekst i kurset». */
const SOM_TEKST = new Set(["tekst", "læringsmål", "oppgave", "struktur"]);
/** Over denne størrelsen er et rasterbilde for tungt til å ligge i en seksjon (#1079). */
const TUNGT_BILDE = 300 * 1024;

const tekstAv = (verdi) => {
  if (verdi && typeof verdi === "object") return String(verdi.nb ?? verdi["en-GB"] ?? Object.values(verdi)[0] ?? "");
  const tekst = String(verdi ?? "");
  if (!tekst.trim().startsWith("{")) return tekst;
  try { return tekstAv(JSON.parse(tekst)); } catch { return tekst; }
};
/** Små bokstaver, ett mellomrom, uten markdown-tegn — og et ord delt med bindestrek over to linjer satt sammen. */
const flat = (tekst) => String(tekst ?? "").toLowerCase().replace(/[*_`#>|]/g, " ").replace(/[‐‑–—]/g, "-").replace(/-\s+/g, "").replace(/\s+/g, " ").trim();
const ordI = (tekst) => flat(tekst).split(" ").filter(Boolean).length;

/** Hva slags figur er dette? Tegneskriptene kan si det selv med `data-figur`; ellers leses formen. */
function figurform(svg) {
  const oppgitt = /data-figur="([^"]+)"/.exec(svg)?.[1];
  if (oppgitt) return oppgitt;
  const antall = (navn) => (svg.match(new RegExp(`<${navn}\\b`, "g")) ?? []).length;
  if (/class="[^"]*\bsteg\b/.test(svg)) return "flyt";
  const former = antall("rect") + antall("circle");
  const streker = antall("line") + antall("polyline");
  if (former >= 3 && streker >= former - 1 && antall("path") === 0) return "flyt";
  return antall("path") > 0 ? "tegning" : "annet";
}

/**
 * Leser kurset til en flat form: all tekst, figurene, tabellene. Godtar begge pakkeformatene.
 * @returns {{ tekst: string, ord: number, seksjoner: number, moduler: number, figurer: Array<object>, tabeller: string[] }}
 */
export function readCourse(pakke) {
  const seksjoner = [];
  const moduler = [];
  // Tre former: svaret fra plattformens eksport ({ envelope }), importfila skillet leverer
  // (konvolutten selv), og pakken skillet arbeider i ({ objects }).
  const konvolutt = pakke?.envelope ?? (pakke?.exportFormat ? pakke : null);
  const kurs = konvolutt?.course?.course ?? konvolutt?.course ?? null;
  if (kurs?.items) {
    for (const el of kurs.items) {
      if (el.section) seksjoner.push(el.section);
      if (el.module) moduler.push({ ...(el.module.module ?? {}), ...(el.module.activeVersion ?? {}) });
    }
  } else {
    for (const objekt of pakke?.objects ?? []) {
      if (objekt.type === "section") seksjoner.push(objekt.payload ?? {});
      if (objekt.type === "module") moduler.push(objekt.payload ?? {});
    }
  }

  const deler = [];
  const figurer = [];
  const tabeller = [];
  // Innholdsblokker i formen skillet skriver dem: kort er en rekke «###»-overskrifter under samme
  // del, en uthevet boks er et sitat som åpner med fet merkelapp, en prompt er en kodeblokk.
  const blokker = [];
  for (const seksjon of seksjoner) {
    const markdown = tekstAv(seksjon.bodyMarkdown);
    deler.push(tekstAv(seksjon.title), markdown);
    for (const blokk of markdown.match(/(?:^\|.*\|[ \t]*\r?\n?)+/gm) ?? []) tabeller.push(flat(blokk));
    const utenKode = markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (kode) => {
      blokker.push(flat(kode));
      return "";
    });
    for (const del of utenKode.split(/^##\s.*$/m)) {
      const kort = del.split(/^(?=###\s)/m).filter((k) => /^###\s/.test(k));
      if (kort.length >= 2) blokker.push(flat(kort.join("\n")));
    }
    for (const sitat of utenKode.match(/(?:^>.*\n?)+/gm) ?? []) if (/^>\s*\*\*/.test(sitat)) blokker.push(flat(sitat));
    const alt = new Map([...markdown.matchAll(/!\[([^\]]*)\]\(asset:([^)\s]+)\)/g)].map((m) => [m[2], m[1]]));
    for (const asset of seksjon.assets ?? []) {
      const erSvg = String(asset.mimeType ?? "").includes("svg");
      const innhold = erSvg ? Buffer.from(String(asset.contentBase64 ?? ""), "base64").toString("utf8") : "";
      // `(?=<)` og ikke `<`: ellers spiser treffet starten på neste element, og den første
      // <tspan> i en <text> blir hoppet over.
      const etiketter = erSvg ? [...innhold.matchAll(/<(?:text|tspan|title|desc)\b[^>]*>([^<]*)(?=<)/g)].map((m) => m[1]).join(" ") : "";
      figurer.push({
        fil: asset.filename ?? "",
        svg: erSvg,
        form: erSvg ? figurform(innhold) : "bilde",
        tekst: flat(`${alt.get(asset.sourceId) ?? ""} ${etiketter} ${asset.filename ?? ""}`),
        smaltOppsett: (asset.layoutVariants ?? []).some((v) => v.layout === "narrow"),
        animert: erSvg && /@keyframes/.test(innhold),
        harTegning: erSvg && /<path\b/.test(innhold),
        byte: Number(asset.sizeBytes ?? Buffer.byteLength(String(asset.contentBase64 ?? ""), "base64")),
      });
    }
  }
  for (const modul of moduler) {
    deler.push(tekstAv(modul.title), tekstAv(modul.description), tekstAv(modul.taskText));
    for (const spørsmål of modul.mcqSet?.questions ?? []) deler.push(tekstAv(spørsmål.stem), ...(spørsmål.options ?? []).map(tekstAv));
  }
  const tekst = flat(deler.join("\n"));
  return { tekst, ord: ordI(deler.join(" ")), seksjoner: seksjoner.length, moduler: moduler.length, figurer, tabeller, blokker };
}

/** Hvor mange av uttrykkene står i teksten? */
const treff = (uttrykk, tekst) => uttrykk.filter((u) => tekst.includes(flat(u))).length;
/** «Dekket» er minst halvparten av uttrykkene, og minst ett. */
const dekket = (uttrykk, tekst) => uttrykk.length > 0 && treff(uttrykk, tekst) >= Math.max(1, Math.ceil(uttrykk.length / 2));

/**
 * @param {object} tilfelle  et testtilfelle fra cases/
 * @param {object} pakke     kurset
 */
export function scoreCourse(tilfelle, pakke) {
  const kurs = readCourse(pakke);
  const altSomKanLeses = `${kurs.tekst} ${kurs.figurer.map((f) => f.tekst).join(" ")}`;

  const lysark = (tilfelle.lysark ?? []).map((ark) => {
    const ord = ark.nøkkelord ?? [];
    const iBilde = ark.bildetekst ?? [];
    const alle = [...ord, ...iBilde];
    // Hvilken form fikk lysarket i kurset? Den første som passer, i denne rekkefølgen.
    const iFigur = kurs.figurer.find((f) => f.svg && treff(alle, f.tekst) >= Math.min(2, alle.length));
    const iTabell = kurs.tabeller.find((t) => treff(alle, t) >= Math.min(2, alle.length));
    const iBlokk = kurs.blokker.find((b) => treff(alle, b) >= Math.min(2, alle.length));
    const iBildefil = kurs.figurer.find((f) => !f.svg && treff(alle, f.tekst) >= 1);
    const bildetekstGjengitt = iBilde.length > 0 && dekket(iBilde, kurs.tekst);
    const innholdMed = dekket(alle, altSomKanLeses);

    const funnet = iFigur ? "figur" : iTabell ? "tabell" : iBildefil ? "bilde" : iBlokk ? "innholdsblokk" : bildetekstGjengitt ? "prompt-som-tekst" : innholdMed ? "tekst" : "borte";
    const forventet = ark.forventet ?? [];
    const somForventet =
      forventet.includes(funnet) ||
      (funnet === "tekst" && forventet.some((f) => SOM_TEKST.has(f))) ||
      (funnet === "borte" && forventet.includes("utelatt")) ||
      // En prompt som er gjengitt som tekst, kan samtidig stå i en tabell eller figur.
      (bildetekstGjengitt && forventet.includes("prompt-som-tekst"));
    return {
      nr: ark.nr, form: ark.form, forventet, funnet, somForventet, valgfri: ark.valgfri === true, innholdMed,
      nøkkelord: `${treff(ord, altSomKanLeses)}/${ord.length}`,
      bildetekst: iBilde.length ? `${treff(iBilde, kurs.tekst)}/${iBilde.length}` : null,
      figur: iFigur ? { fil: iFigur.fil, form: iFigur.form } : null,
    };
  });

  const teller = lysark.filter((l) => !l.valgfri);
  const svg = kurs.figurer.filter((f) => f.svg);
  const raster = kurs.figurer.filter((f) => !f.svg);
  const bildeuttrykk = (tilfelle.lysark ?? []).flatMap((l) => l.bildetekst ?? []);
  return {
    navn: tilfelle.navn,
    lysark,
    sum: {
      lysarkMedInnhold: teller.length,
      innholdMed: teller.filter((l) => l.innholdMed).length,
      somForventet: teller.filter((l) => l.somForventet).length,
      // Lysark som skulle blitt en innholdsblokk og ble noe annet. Skillet skriver blokkene som
      // kort («###»), sitat med fet merkelapp og kodeblokk til plattformen har egne (#1079).
      venterPåInnholdsblokker: teller.filter((l) => !l.somForventet && l.forventet.includes("innholdsblokk")).length,
      figurer: svg.length,
      figurformer: [...new Set(svg.map((f) => f.form))].sort(),
      figurerMedSmaltOppsett: svg.filter((f) => f.smaltOppsett).length,
      figurerMedTegning: svg.filter((f) => f.harTegning).length,
      ikonerIKilden: tilfelle.ikonerIKilden ?? 0,
      tabeller: kurs.tabeller.length,
      rasterbilder: raster.length,
      rasterKB: Math.round(raster.reduce((s, f) => s + f.byte, 0) / 1024),
      tungeBilder: raster.filter((f) => f.byte > TUNGT_BILDE).map((f) => `${f.fil} (${Math.round(f.byte / 1024)} kB)`),
      tekstFraBilder: `${treff(bildeuttrykk, kurs.tekst)}/${bildeuttrykk.length}`,
      seksjoner: kurs.seksjoner,
      moduler: kurs.moduler,
      ord: kurs.ord,
    },
  };
}

/** Resultatet som tekst et menneske kan lese. */
export function formatScore(resultat) {
  const s = resultat.sum;
  const linjer = [
    `${resultat.navn}`,
    `  Lysark med innholdet i kurset:       ${s.innholdMed} av ${s.lysarkMedInnhold}`,
    `  Lysark som fikk forventet behandling: ${s.somForventet} av ${s.lysarkMedInnhold}${s.venterPåInnholdsblokker ? `   (${s.venterPåInnholdsblokker} skulle vært kort, uthevet boks eller prompt-boks)` : ""}`,
    `  Figurer: ${s.figurer} · former: ${s.figurformer.join(", ") || "ingen"} · med smalt oppsett: ${s.figurerMedSmaltOppsett} · med tegning/ikon: ${s.figurerMedTegning} (kilden har ${s.ikonerIKilden} ikoner)`,
    `  Tabeller: ${s.tabeller} · rasterbilder: ${s.rasterbilder} (${s.rasterKB} kB)${s.tungeBilder.length ? ` · FOR TUNGE: ${s.tungeBilder.join(", ")}` : ""}`,
    `  Tekst som bare sto i bilder, gjengitt som tekst: ${s.tekstFraBilder}`,
    `  Kurset: ${s.seksjoner} seksjoner, ${s.moduler} tester, ${s.ord} ord`,
    "",
    "  nr  form                      i kilden → i kurset   forventet                    ord    i bilde",
  ];
  for (const l of resultat.lysark) {
    linjer.push(`  ${String(l.nr).padStart(2)}  ${l.form.padEnd(24)}  ${(l.somForventet ? "✓ " : "✗ ") + l.funnet.padEnd(18)}  ${l.forventet.join(" | ").padEnd(27)}  ${l.nøkkelord.padEnd(5)}  ${l.bildetekst ?? "–"}${l.valgfri ? "  (valgfri)" : ""}`);
  }
  return linjer.join("\n");
}

const erHoved = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (erHoved) {
  const [tilfelleFil, kursFil, flagg] = process.argv.slice(2);
  if (!tilfelleFil || !kursFil) {
    console.error("bruk: node score-course.mjs cases/<tilfelle>.json <kurs.json> [--json]");
    process.exitCode = 2;
  } else {
    const resultat = scoreCourse(JSON.parse(readFileSync(tilfelleFil, "utf8")), JSON.parse(readFileSync(kursFil, "utf8")));
    console.log(flagg === "--json" ? JSON.stringify(resultat, null, 2) : formatScore(resultat));
  }
}
